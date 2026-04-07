const express = require('express');
const crypto  = require('crypto');

const logger = require('../logger');
const { postReviewToGitHub } = require('../github');
const { optionalAuth, resolveGitHubToken } = require('../middleware/auth');

const router = express.Router();

// ─── Route: POST /comment ──────────────────────────────────────────────────────
//
// Used by the dashboard's "Post Review to GitHub" button after a manual review.
// For automated (GitHub Actions) flows, use POST /review with triggered_by set —
// it handles posting in one step.
//
// GitHub token resolution (highest priority first):
//   1. Authenticated user's personal GitHub token stored in Firestore
//   2. Server-level GITHUB_TOKEN env var
//   3. No token → 401
//
// Body:
//   pr_meta  { owner, repo, pull_number, commit_sha, pr_title }
//   result   { summary, confidence_score, issues }

router.post('/', optionalAuth, async (req, res) => {
  const requestId = crypto.randomUUID();
  const { pr_meta, result } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!pr_meta || !result) {
    logger.warn('comment.bad_request', { requestId, reason: 'pr_meta and result are required' });
    return res.status(400).json({ error: 'pr_meta and result are required', request_id: requestId });
  }

  const { owner, repo, pull_number, commit_sha, pr_title } = pr_meta;

  if (!owner || !repo || !pull_number) {
    logger.warn('comment.bad_request', { requestId, reason: 'pr_meta missing owner/repo/pull_number' });
    return res.status(400).json({
      error:      'pr_meta must contain owner, repo, and pull_number',
      request_id: requestId,
    });
  }

  // ── Resolve GitHub token ─────────────────────────────────────────────────────
  const { token: githubToken, source: tokenSource } = await resolveGitHubToken(req.userId);

  if (!githubToken) {
    const hint = req.userId
      ? 'Connect your GitHub account at GET /auth/github.'
      : 'Set GITHUB_TOKEN on the server or connect your GitHub account.';
    logger.warn('comment.no_github_token', { requestId, userId: req.userId || null });
    return res.status(401).json({ error: `GitHub account not connected. ${hint}`, request_id: requestId });
  }

  logger.info('comment.start', { requestId, owner, repo, pull_number, tokenSource });

  // ── Post to GitHub ───────────────────────────────────────────────────────────
  let postResult;
  try {
    postResult = await postReviewToGitHub({
      owner,
      repo,
      pull_number,
      commit_sha,
      pr_title,
      summary:          result.summary,
      confidence_score: result.confidence_score,
      issues:           result.issues,
      triggered_by:     'manual',
      token:            githubToken,
    });
  } catch (err) {
    logger.error('comment.post_failed', { requestId, owner, repo, pull_number, error: err.message });
    return res.status(502).json({ error: err.message, request_id: requestId });
  }

  logger.info('comment.complete', {
    requestId,
    owner, repo, pull_number,
    tokenSource,
    comment_url:    postResult.general_comment_url,
    inline_posted:  postResult.inline_posted,
    inline_skipped: postResult.inline_skipped,
  });

  res.json({
    success:             true,
    general_comment_url: postResult.general_comment_url,
    inline_posted:       postResult.inline_posted,
    inline_skipped:      postResult.inline_skipped,
    token_source:        tokenSource,
    request_id:          requestId,
    message:
      postResult.inline_posted > 0
        ? `Posted general comment + ${postResult.inline_posted} inline comment(s) to GitHub.`
        : 'Posted general comment to GitHub. Inline comments were skipped (no valid diff positions).',
  });
});

module.exports = router;
