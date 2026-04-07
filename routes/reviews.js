/**
 * Review history routes
 *
 * GET /reviews/:projectId  — list reviews for a project (most recent first)
 * DELETE /reviews/:reviewId — delete a single review record
 */

const express = require('express');
const { db }  = require('../firebase');
const { requireAuth } = require('../middleware/auth');
const logger  = require('../logger');

const router = express.Router();

// ─── GET /reviews/:projectId ──────────────────────────────────────────────────

router.get('/:projectId', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not available' });

  const { projectId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

  try {
    // Verify the project belongs to this user first
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Query by projectId only (single-field index — no composite index needed).
    // We then filter by userId in-memory and sort by createdAt desc.
    // This avoids requiring a Firestore composite index that must be manually deployed.
    const snap = await db
      .collection('reviews')
      .where('projectId', '==', projectId)
      .get();

    const reviews = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id:            doc.id,
          projectId:     d.projectId,
          pr_url:        d.pr_url,
          pr_title:      d.pr_title      || null,
          summary:       d.summary       || '',
          issues_count:  d.issues_count  ?? (d.issues?.length || 0),
          issues_high:   d.issues_high   ?? 0,
          issues_medium: d.issues_medium ?? 0,
          issues_low:    d.issues_low    ?? 0,
          confidence_score: d.confidence_score ?? null,
          verdict:       d.verdict       || null,
          status:        d.status        || 'completed',
          triggered_by:  d.triggered_by  || 'manual',
          userId:        d.userId        || null,
          createdAt:     d.createdAt?.toDate?.()?.toISOString() || null,
        };
      })
      // Security: only return this user's records
      .filter((r) => r.userId === req.userId)
      // Sort most recent first
      .sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .slice(0, limit)
      // Strip internal userId from response
      .map(({ userId: _u, ...rest }) => rest);

    res.json({ reviews });
  } catch (err) {
    logger.error('reviews.list_failed', { projectId, userId: req.userId, error: err.message });
    res.status(500).json({ error: 'Failed to fetch review history' });
  }
});

// ─── DELETE /reviews/:reviewId ────────────────────────────────────────────────

router.delete('/:reviewId', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not available' });

  const { reviewId } = req.params;

  try {
    const doc = await db.collection('reviews').doc(reviewId).get();
    if (!doc.exists || doc.data().userId !== req.userId) {
      return res.status(404).json({ error: 'Review not found' });
    }

    await db.collection('reviews').doc(reviewId).delete();
    res.json({ success: true });
  } catch (err) {
    logger.error('reviews.delete_failed', { reviewId, error: err.message });
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

module.exports = router;
