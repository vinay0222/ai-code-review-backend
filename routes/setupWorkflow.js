/**
 * POST /setup-workflow
 *
 * Pushes an AI review GitHub Actions workflow file to a given repository.
 * Uses the authenticated user's GitHub token so it has write access.
 *
 * Body:
 *   repo  string  — "owner/repo"
 */

const express = require('express');
const axios   = require('axios');

const { requireAuth, resolveGitHubToken } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// ─── Workflow template ────────────────────────────────────────────────────────

function generateWorkflow(backendUrl) {
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
            -d '{
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

// ─── Route ────────────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  const { repo } = req.body;

  if (!repo) {
    return res.status(400).json({ error: 'repo is required' });
  }

  // Strip any URL prefix and .git suffix the frontend may have left in
  const slug = repo
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

  if (!slug.includes('/')) {
    return res.status(400).json({ error: 'repo must be "owner/repo" format' });
  }

  const [owner, repoName] = slug.split('/');

  // ── Resolve GitHub token ──────────────────────────────────────────────────
  const { token } = await resolveGitHubToken(req.userId);
  if (!token) {
    return res.status(401).json({
      error: 'GitHub account not connected. Connect GitHub first.',
    });
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github.v3+json',
    'User-Agent':  'AI-Code-Review-Tool/1.0',
  };

  // ── Determine backend URL to embed in the workflow ────────────────────────
  const backendUrl =
    process.env.BACKEND_URL ||
    `https://${req.headers.host}`;

  const workflowContent = generateWorkflow(backendUrl);
  const contentBase64   = Buffer.from(workflowContent).toString('base64');

  // Always return the YAML so the frontend can show a copy/download fallback
  const workflowMeta = {
    file_path:     '.github/workflows/ai-review.yml',
    workflow_yaml: workflowContent,
  };

  const filePath = '.github/workflows/ai-review.yml';
  const apiUrl   = `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`;

  // ── Check if the file already exists (to get its SHA for updates) ─────────
  let existingSha;
  try {
    const existing = await axios.get(apiUrl, { headers: ghHeaders, timeout: 10000 });
    existingSha = existing.data.sha;
    logger.info('setup_workflow.file_exists', { owner, repo: repoName, sha: existingSha });
  } catch (err) {
    if (err.response?.status !== 404) {
      const status = err.response?.status;
      const hint =
        status === 401 ? 'GitHub token is invalid or expired. Reconnect your GitHub account.'
        : status === 403 ? 'Your token lacks read access to this repository.'
        : status === 404 ? 'Repository not found. Check the repo URL in the Overview tab.'
        : err.response?.data?.message || err.message;

      logger.error('setup_workflow.check_failed', { owner, repo: repoName, status, error: err.message });
      return res.json({
        success:     false,
        push_failed: true,
        reason:      hint,
        ...workflowMeta,
      });
    }
    // 404 = file doesn't exist yet — that's fine
  }

  // ── Create or update the file ─────────────────────────────────────────────
  try {
    const putBody = {
      message: existingSha
        ? 'chore: update AI code review workflow'
        : 'chore: add AI code review workflow',
      content: contentBase64,
      ...(existingSha && { sha: existingSha }),
    };

    const result = await axios.put(apiUrl, putBody, {
      headers: ghHeaders,
      timeout: 15000,
    });

    logger.info('setup_workflow.success', {
      userId: req.userId,
      owner,
      repo:    repoName,
      action:  existingSha ? 'updated' : 'created',
    });

    logger.info('setup_workflow.success', {
      userId: req.userId,
      owner,
      repo:    repoName,
      action:  existingSha ? 'updated' : 'created',
    });

    res.json({
      success:    true,
      action:     existingSha ? 'updated' : 'created',
      file_url:   result.data.content?.html_url  || null,
      commit_url: result.data.commit?.html_url   || null,
      message:    existingSha
        ? 'Workflow file updated in your repository.'
        : 'Workflow file created. AI reviews will now run automatically on new PRs.',
      ...workflowMeta,
    });
  } catch (err) {
    const status = err.response?.status;
    const hint =
      status === 401 ? 'GitHub token is invalid or expired. Reconnect your GitHub account.'
      : status === 403 ? 'Your token lacks write access to this repository. Make sure the connected GitHub account has push access.'
      : status === 404 ? 'Repository not found. Check the repo URL in the Overview tab and make sure your GitHub account has access to it.'
      : err.response?.data?.message || err.message;

    logger.error('setup_workflow.put_failed', {
      owner, repo: repoName, status, error: err.message,
    });

    // Return 200 with push_failed=true + the YAML so the frontend can
    // show a manual-copy fallback rather than just an error banner
    res.json({
      success:     false,
      push_failed: true,
      reason:      hint,
      ...workflowMeta,
    });
  }
});

module.exports = router;
