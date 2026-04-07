/**
 * Workflow setup routes
 *
 * POST /setup-workflow        — push ai-review.yml to a repo
 * GET  /setup-workflow/status — check if ai-review.yml already exists in a repo
 */

const express = require('express');
const axios   = require('axios');

const { requireAuth, resolveGitHubToken } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

const FILE_PATH = '.github/workflows/ai-review.yml';

// ─── Workflow template ────────────────────────────────────────────────────────

/**
 * Generate the workflow YAML.
 *
 * @param {string} backendUrl  — deployed backend URL embedded in the curl call
 * @param {string} projectId   — Firestore project ID, embedded so auto-triggered
 *                               reviews are linked to the correct project in history
 */
function generateWorkflow(backendUrl, projectId) {
  const projectIdLine = projectId
    ? `\n              "project_id": "${projectId}",`
    : '';

  return `name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  ai-review:
    name: Run AI Review
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Call AI Review API
        run: |
          RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST "${backendUrl}/review" \\
            -H "Content-Type: application/json" \\
            -d '{${projectIdLine}
              "pr_url": "\${{ github.event.pull_request.html_url }}",
              "triggered_by": "github_action"
            }')

          HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
          BODY=$(echo "$RESPONSE" | head -n -1)

          echo "Status: $HTTP_CODE"
          echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

          if [ "$HTTP_CODE" != "200" ]; then
            echo "::warning::AI review returned HTTP $HTTP_CODE"
          fi

          SKIPPED=$(echo "$BODY" | jq -r '.skipped_duplicate // false' 2>/dev/null)
          if [ "$SKIPPED" = "true" ]; then
            echo "::notice::Duplicate review detected — skipped."
          fi
        continue-on-error: true
`;
}

// ─── Shared helper: normalise slug ───────────────────────────────────────────

function normaliseSlug(raw) {
  if (!raw) return null;
  return raw
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

// ─── Shared helper: GitHub headers ───────────────────────────────────────────

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github.v3+json',
    'User-Agent':  'AI-Code-Review-Tool/1.0',
  };
}

// ─── GET /setup-workflow/status ───────────────────────────────────────────────
//
// Query:  repo=owner/repo  [required]
//         project_id=xxx   [optional — used to compare content]
//
// Returns {
//   exists:     bool,
//   is_current: bool | null,   // null when file doesn't exist or compare failed
//   file_url:   string | null,
// }
//
// is_current === true  → existing file matches the workflow we'd generate now
// is_current === false → file exists but is outdated (different backend URL or project_id)

router.get('/status', requireAuth, async (req, res) => {
  const slug       = normaliseSlug(req.query.repo);
  const project_id = req.query.project_id || null;

  if (!slug || !slug.includes('/')) {
    return res.status(400).json({ error: 'repo query param required (owner/repo)' });
  }

  const { token } = await resolveGitHubToken(req.userId);
  if (!token) {
    return res.status(401).json({ error: 'GitHub account not connected' });
  }

  const [owner, repoName] = slug.split('/');
  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${FILE_PATH}`;

  try {
    const { data } = await axios.get(apiUrl, { headers: ghHeaders(token), timeout: 8000 });

    // Decode existing file content
    let isCurrent = null;
    try {
      const existingContent = Buffer.from(
        data.content.replace(/\n/g, ''),
        'base64'
      ).toString('utf-8');

      const backendUrl = process.env.BACKEND_URL || `https://${req.headers.host}`;
      const expectedContent = generateWorkflow(backendUrl, project_id);

      // Normalise line endings before comparing
      isCurrent = existingContent.replace(/\r\n/g, '\n').trim() ===
                  expectedContent.replace(/\r\n/g, '\n').trim();
    } catch (compareErr) {
      logger.warn('setup_workflow.compare_error', { slug, error: compareErr.message });
    }

    return res.json({
      exists:     true,
      is_current: isCurrent,
      file_url:   data.html_url || null,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({ exists: false, is_current: null, file_url: null });
    }
    logger.warn('setup_workflow.status_error', { slug, status: err.response?.status });
    return res.json({
      exists:     false,
      is_current: null,
      file_url:   null,
      error:      err.response?.data?.message,
    });
  }
});

// ─── POST /setup-workflow ─────────────────────────────────────────────────────
//
// Body: { repo: "owner/repo", project_id?: string }

router.post('/', requireAuth, async (req, res) => {
  const { repo, project_id } = req.body;

  if (!repo) {
    return res.status(400).json({ error: 'repo is required' });
  }

  const slug = normaliseSlug(repo);
  if (!slug || !slug.includes('/')) {
    return res.status(400).json({ error: 'repo must be "owner/repo" format' });
  }

  const [owner, repoName] = slug.split('/');

  // ── Resolve GitHub token ──────────────────────────────────────────────────
  const { token } = await resolveGitHubToken(req.userId);
  if (!token) {
    return res.status(401).json({ error: 'GitHub account not connected. Connect GitHub first.' });
  }

  const headers = ghHeaders(token);

  // ── Backend URL embedded in the workflow ──────────────────────────────────
  const backendUrl = process.env.BACKEND_URL || `https://${req.headers.host}`;

  // ── Generate the workflow (with project_id embedded if available) ─────────
  const workflowContent = generateWorkflow(backendUrl, project_id || null);
  const contentBase64   = Buffer.from(workflowContent).toString('base64');

  const workflowMeta = { file_path: FILE_PATH, workflow_yaml: workflowContent };

  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${FILE_PATH}`;

  // ── Check if file already exists (need SHA to update) ────────────────────
  let existingSha;
  try {
    const existing = await axios.get(apiUrl, { headers, timeout: 10000 });
    existingSha = existing.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) {
      const hint = buildHint(err.response?.status, err);
      logger.error('setup_workflow.check_failed', { owner, repo: repoName, status: err.response?.status });
      return res.json({ success: false, push_failed: true, reason: hint, ...workflowMeta });
    }
  }

  // ── Create or update ──────────────────────────────────────────────────────
  try {
    const putBody = {
      message: existingSha
        ? 'chore: update AI code review workflow'
        : 'chore: add AI code review workflow',
      content: contentBase64,
      ...(existingSha && { sha: existingSha }),
    };

    const result = await axios.put(apiUrl, putBody, { headers, timeout: 15000 });

    logger.info('setup_workflow.success', {
      userId: req.userId, owner, repo: repoName,
      action: existingSha ? 'updated' : 'created',
      project_id: project_id || null,
    });

    return res.json({
      success:    true,
      action:     existingSha ? 'updated' : 'created',
      file_url:   result.data.content?.html_url  || null,
      commit_url: result.data.commit?.html_url   || null,
      message:    existingSha
        ? 'Workflow updated in your repository.'
        : 'Workflow created — AI reviews will now run automatically on new PRs.',
      ...workflowMeta,
    });
  } catch (err) {
    const hint = buildHint(err.response?.status, err);
    logger.error('setup_workflow.put_failed', { owner, repo: repoName, status: err.response?.status });
    return res.json({ success: false, push_failed: true, reason: hint, ...workflowMeta });
  }
});

function buildHint(status, err) {
  if (status === 401) return 'GitHub token is invalid or expired. Reconnect your GitHub account.';
  if (status === 403) return 'Your token lacks write access to this repository. Make sure the connected GitHub account has push access.';
  if (status === 404) return 'Repository not found. Check the repo URL in the Overview tab and make sure your GitHub account has access to it.';
  return err?.response?.data?.message || err?.message || 'Unknown error.';
}

module.exports = router;
