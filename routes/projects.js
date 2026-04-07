const express = require('express');
const { db } = require('../firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All project routes require authentication
router.use(requireAuth);

const COLLECTION = 'projects';

const DEFAULT_CONFIG = {
  check_edge_cases:     true,
  check_code_structure: true,
  check_performance:    false,
  check_security:       true,
  check_best_practices: true,
  check_unit_tests:     false,
  strictness:           'medium',
};

/** Convert a Firestore doc snapshot to a plain JS object. */
function docToProject(doc) {
  const data = doc.data();
  return {
    id:            doc.id,
    name:          data.name,
    repo_url:      data.repo_url      || '',
    rules:         data.rules         || [],
    docs:          data.docs          || '',
    review_config: data.review_config || { ...DEFAULT_CONFIG },
    created_at:    data.created_at?.toDate?.()?.toISOString() ?? data.created_at,
  };
}

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    const snapshot = await db
      .collection(COLLECTION)
      .where('userId', '==', req.userId)
      .get();

    // Sort newest-first in memory — avoids needing a composite index while it builds
    const projects = snapshot.docs
      .map(docToProject)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(projects);
  } catch (err) {
    console.error('GET /projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /projects/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    const doc = await db.collection(COLLECTION).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Project not found' });

    const project = docToProject(doc);
    // Ensure the project belongs to the requesting user
    if (doc.data().userId !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /projects ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  const { name, repo_url } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const now = new Date();
    const data = {
      userId:        req.userId,
      name:          name.trim(),
      repo_url:      repo_url?.trim() || '',
      rules:         [],
      docs:          '',
      review_config: { ...DEFAULT_CONFIG },
      created_at:    now,
    };

    const ref = await db.collection(COLLECTION).add(data);
    res.status(201).json({
      id:         ref.id,
      ...data,
      created_at: now.toISOString(),
    });
  } catch (err) {
    console.error('POST /projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /projects/:id ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ error: 'Project not found' });
    if (doc.data().userId !== req.userId) return res.status(403).json({ error: 'Access denied' });

    // Only allow updating safe fields
    const { name, repo_url, rules, docs, review_config } = req.body;
    const patch = {};

    if (name          !== undefined) patch.name          = name.trim();
    if (repo_url      !== undefined) patch.repo_url      = repo_url.trim();
    if (rules         !== undefined) patch.rules         = rules;
    if (docs          !== undefined) patch.docs          = docs;
    if (review_config !== undefined) {
      // Deep merge review_config with existing
      patch.review_config = { ...doc.data().review_config, ...review_config };
    }

    await ref.update(patch);

    const updated = await ref.get();
    res.json(docToProject(updated));
  } catch (err) {
    console.error('PUT /projects/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /projects/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ error: 'Project not found' });
    if (doc.data().userId !== req.userId) return res.status(403).json({ error: 'Access denied' });

    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
