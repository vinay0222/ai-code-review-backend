const express = require('express');
const crypto  = require('crypto');
const OpenAI  = require('openai');

const logger = require('../logger');
const {
  parsePrUrl,
  fetchPrData,
  isDuplicateReview,
  postReviewToGitHub,
} = require('../github');
const { optionalAuth, resolveGitHubToken } = require('../middleware/auth');
const { db } = require('../firebase');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Valid trigger types ───────────────────────────────────────────────────────

const VALID_TRIGGERS = new Set(['manual', 'label', 'comment', 'github_action', 'webhook']);

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are an expert senior software engineer performing a thorough code review.
Analyse the PR diff provided and respond ONLY with a valid JSON object matching this exact schema:

{
  "summary": "<1–3 sentence overview of what the PR does and overall quality>",
  "confidence_score": <integer 0-100 representing your confidence in this review>,
  "issues": [
    {
      "file": "<filename relative to repo root, or 'general'>",
      "line": <integer line number in the new file, or null>,
      "severity": "high" | "medium" | "low",
      "issue": "<clear description of the problem>",
      "suggestion": "<actionable fix or recommendation>"
    }
  ]
}

Rules:
- Return ONLY JSON — no markdown fences, no prose outside the JSON
- If the PR looks clean, return an empty issues array and a positive summary
- Be specific and actionable in every suggestion
- Use the exact file path as it appears in the diff header (e.g. "src/utils/auth.js")
- Line numbers must refer to lines in the NEW version of the file (right side of diff)`;
}

function buildUserPrompt(diff, rules, docs, config, prDetails) {
  const checks = [];
  if (config?.check_edge_cases)     checks.push('edge cases and boundary conditions');
  if (config?.check_code_structure) checks.push('code structure and organisation');
  if (config?.check_performance)    checks.push('performance bottlenecks');
  if (config?.check_security)       checks.push('security vulnerabilities');
  if (config?.check_best_practices) checks.push('best practices and code quality');
  if (config?.check_unit_tests)     checks.push('unit test coverage gaps');

  const parts = [];

  if (prDetails) {
    parts.push(`PR: "${prDetails.title}" by @${prDetails.user?.login}`);
    if (prDetails.body?.trim()) {
      parts.push(`PR Description: ${prDetails.body.trim().substring(0, 500)}`);
    }
  }

  parts.push(
    `Strictness level: ${config?.strictness || 'medium'} (low = critical only, medium = balanced, high = exhaustive)`
  );

  if (checks.length) parts.push(`Focus areas: ${checks.join(', ')}`);

  if (rules?.length) {
    parts.push(`\nProject-specific rules:\n${rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`);
  }

  if (docs?.trim()) {
    parts.push(`\nProject documentation / context:\n${docs.trim()}`);
  }

  const trimmedDiff =
    diff.length > 14000
      ? diff.substring(0, 14000) + '\n\n[...diff truncated for length...]'
      : diff;

  parts.push(`\nPR diff:\n\`\`\`diff\n${trimmedDiff}\n\`\`\``);
  return parts.join('\n');
}

// ─── Route: POST /review ───────────────────────────────────────────────────────
//
// Body:
//   pr_url        string   — required
//   triggered_by  string   — "manual" | "label" | "comment" | "github_action" | "webhook"
//                            Defaults to "manual"
//   auto_post     boolean  — Post comment to GitHub automatically?
//                            Defaults to true when triggered_by !== "manual"
//   rules         string[] — Project rules to enforce
//   docs          string   — Project documentation context
//   config        object   — Review configuration checkboxes + strictness
//
// GitHub token resolution (highest priority first):
//   1. Authenticated user's personal GitHub token stored in Firestore
//   2. Server-level GITHUB_TOKEN env var (GitHub Actions / unauthenticated callers)
//   3. No token → 401

router.post('/', optionalAuth, async (req, res) => {
  const {
    pr_url,
    project_id,
    triggered_by = 'manual',
    auto_post,
    rules  = [],
    docs   = '',
    config = {},
  } = req.body;

  const trigger       = VALID_TRIGGERS.has(triggered_by) ? triggered_by : 'manual';
  const shouldAutoPost = auto_post ?? (trigger !== 'manual');
  const requestId     = crypto.randomUUID();

  logger.info('review.start', {
    requestId,
    pr_url,
    trigger,
    shouldAutoPost,
    userId:      req.userId || null,
    tokenSource: null, // populated below
  });

  // ── 1. Validate basic inputs ─────────────────────────────────────────────────
  if (!pr_url?.trim()) {
    logger.warn('review.bad_request', { requestId, reason: 'missing pr_url' });
    return res.status(400).json({ error: 'pr_url is required', request_id: requestId });
  }

  if (!process.env.OPENAI_API_KEY) {
    logger.error('review.missing_config', { requestId, reason: 'OPENAI_API_KEY not set' });
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server', request_id: requestId });
  }

  // ── 2. Resolve GitHub token ──────────────────────────────────────────────────
  const { token: githubToken, source: tokenSource } = await resolveGitHubToken(req.userId);

  if (!githubToken) {
    const hint = req.userId
      ? 'Connect your GitHub account at GET /auth/github before running reviews.'
      : 'Set GITHUB_TOKEN on the server or connect your GitHub account.';
    logger.warn('review.no_github_token', { requestId, userId: req.userId || null });
    return res.status(401).json({ error: `GitHub account not connected. ${hint}`, request_id: requestId });
  }

  logger.info('review.token_resolved', { requestId, tokenSource });

  // ── 3. Parse PR URL ──────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parsePrUrl(pr_url);
  } catch (err) {
    logger.warn('review.invalid_url', { requestId, pr_url, error: err.message });
    return res.status(400).json({ error: err.message, request_id: requestId });
  }

  const { owner, repo, pull_number } = parsed;

  // ── 4. Duplicate detection (only when auto-posting) ──────────────────────────
  if (shouldAutoPost) {
    const isDupe = await isDuplicateReview(owner, repo, pull_number, githubToken);
    if (isDupe) {
      logger.info('review.skipped_duplicate', { requestId, owner, repo, pull_number });
      return res.json({
        skipped:           true,
        skipped_duplicate: true,
        triggered_by:      trigger,
        request_id:        requestId,
        message:           'An AI review was already posted for this PR in the last 5 minutes — skipping to avoid duplicates.',
      });
    }
  }

  // ── 5. Fetch diff + PR metadata from GitHub ──────────────────────────────────
  let prDetails, diff;
  try {
    ({ prDetails, diff } = await fetchPrData(owner, repo, pull_number, githubToken));
    logger.info('review.diff_fetched', {
      requestId, owner, repo, pull_number,
      diff_bytes:  diff?.length,
      commit_sha:  prDetails.head?.sha?.slice(0, 8),
      pr_title:    prDetails.title,
    });
  } catch (err) {
    const status = err.response?.status;
    const hint =
      status === 401 ? ' — GitHub token is invalid or expired'
      : status === 403 ? ' — token may lack repo:read access'
      : status === 404 ? ' — PR not found; verify the URL and token permissions'
      : '';

    logger.error('review.github_fetch_failed', { requestId, owner, repo, pull_number, status, error: err.message });
    return res.status(502).json({
      error:      `GitHub API error${hint}: ${err.response?.data?.message || err.message}`,
      request_id: requestId,
    });
  }

  if (!diff?.trim()) {
    logger.warn('review.empty_diff', { requestId, owner, repo, pull_number });
    return res.status(400).json({ error: 'The PR diff is empty — nothing to review.', request_id: requestId });
  }

  // ── 6. Run AI review ─────────────────────────────────────────────────────────
  let aiResult;
  try {
    logger.info('review.ai_start', { requestId, model: 'gpt-4o', diff_bytes: diff.length });

    const completion = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: buildUserPrompt(diff, rules, docs, config, prDetails) },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.2,
    });

    try {
      aiResult = JSON.parse(completion.choices[0].message.content);
    } catch {
      logger.error('review.ai_parse_error', { requestId });
      return res.status(500).json({ error: 'OpenAI returned invalid JSON', request_id: requestId });
    }

    logger.info('review.ai_done', {
      requestId,
      issues_count:     aiResult.issues?.length ?? 0,
      confidence_score: aiResult.confidence_score,
    });
  } catch (err) {
    logger.error('review.ai_failed', { requestId, error: err.message });
    return res.status(500).json({
      error:      err.message || 'OpenAI request failed',
      request_id: requestId,
    });
  }

  // ── 7. Normalise AI response ─────────────────────────────────────────────────
  aiResult.issues           = aiResult.issues           || [];
  aiResult.summary          = aiResult.summary          || 'Review complete.';
  aiResult.confidence_score = aiResult.confidence_score ?? 80;

  const commitSha = prDetails.head?.sha;

  // ── 8. Auto-post to GitHub ───────────────────────────────────────────────────
  let autoPostResult = null;
  let autoPostError  = null;

  if (shouldAutoPost) {
    try {
      autoPostResult = await postReviewToGitHub({
        owner,
        repo,
        pull_number,
        commit_sha:       commitSha,
        pr_title:         prDetails.title,
        summary:          aiResult.summary,
        confidence_score: aiResult.confidence_score,
        issues:           aiResult.issues,
        triggered_by:     trigger,
        token:            githubToken,
      });

      logger.info('review.comment_posted', {
        requestId,
        owner, repo, pull_number,
        comment_url:    autoPostResult.general_comment_url,
        inline_posted:  autoPostResult.inline_posted,
        inline_skipped: autoPostResult.inline_skipped,
      });
    } catch (err) {
      autoPostError = err.message;
      logger.error('review.comment_post_failed', { requestId, error: err.message });
    }
  }

  // ── 9. Build and return response ─────────────────────────────────────────────
  const response = {
    summary:          aiResult.summary,
    confidence_score: aiResult.confidence_score,
    issues:           aiResult.issues,

    pr_meta: {
      owner,
      repo,
      pull_number,
      commit_sha: commitSha,
      pr_title:   prDetails.title,
      pr_url:     prDetails.html_url,
    },

    triggered_by:      trigger,
    token_source:      tokenSource,
    auto_posted:       !!autoPostResult,
    skipped_duplicate: false,
    request_id:        requestId,

    ...(autoPostResult && {
      comment_url:    autoPostResult.general_comment_url,
      inline_posted:  autoPostResult.inline_posted,
      inline_skipped: autoPostResult.inline_skipped,
    }),

    ...(autoPostError && { auto_post_error: autoPostError }),
  };

  const issuesHigh   = aiResult.issues.filter(i => i.severity === 'high').length;
  const issuesMedium = aiResult.issues.filter(i => i.severity === 'medium').length;
  const issuesLow    = aiResult.issues.filter(i => i.severity === 'low').length;

  logger.info('review.complete', {
    requestId,
    trigger,
    tokenSource,
    owner, repo, pull_number,
    issues_high:   issuesHigh,
    issues_medium: issuesMedium,
    issues_low:    issuesLow,
    auto_posted:   !!autoPostResult,
  });

  // ── 10. Persist review record ─────────────────────────────────────────────
  //
  // When triggered by GitHub Actions there is no authenticated user, so
  // req.userId is null.  If a project_id was provided, look up the project
  // to get the owner's userId — without it the history query (which filters
  // by userId) would never return this record.
  let saveUserId = req.userId || null;
  if (!saveUserId && project_id && db) {
    try {
      const projectDoc = await db.collection('projects').doc(project_id).get();
      if (projectDoc.exists) {
        saveUserId = projectDoc.data().userId || null;
        logger.info('review.resolved_owner', { requestId, project_id, saveUserId });
      }
    } catch (err) {
      logger.warn('review.owner_lookup_failed', { requestId, project_id, error: err.message });
    }
  }

  if (db && (project_id || saveUserId)) {
    try {
      await db.collection('reviews').add({
        projectId:        project_id || null,
        userId:           saveUserId,
        pr_url:           prDetails.html_url || pr_url,
        pr_title:         prDetails.title || null,
        summary:          aiResult.summary,
        issues:           aiResult.issues,
        issues_count:     aiResult.issues.length,
        issues_high:      issuesHigh,
        issues_medium:    issuesMedium,
        issues_low:       issuesLow,
        confidence_score: aiResult.confidence_score,
        status:           'completed',
        triggered_by:     trigger,
        auto_posted:      !!autoPostResult,
        request_id:       requestId,
        createdAt:        require('firebase-admin').firestore.FieldValue.serverTimestamp(),
      });
      logger.info('review.saved', { requestId, project_id: project_id || null });
    } catch (err) {
      // Non-fatal — review result is already computed, just log the failure
      logger.warn('review.save_failed', { requestId, error: err.message });
    }
  }

  res.json(response);
});

module.exports = router;
