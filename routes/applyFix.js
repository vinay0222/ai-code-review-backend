/**
 * POST /apply-fix
 *
 * Fetches changed files from a GitHub PR, asks OpenAI to fix the issues found
 * in the most recent review, then:
 *   1. Generates a unified diff per file (patch preview)
 *   2. Creates a new branch: ai-fix-{pull_number}-{timestamp}
 *   3. Commits the fixed files using the GitHub Git Tree API
 *   4. Opens a new PR against the original PR's base branch
 *
 * Body: { pr_url: string, project_id?: string }
 *
 * Returns:
 *   success: true  → { pr_url, branch, overall_summary, patches[], files_fixed }
 *   success: false → { message, patches: [] }
 *   error          → { error, patches? }
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const Diff    = require('diff');
const OpenAI  = require('openai');
const crypto  = require('crypto');

const logger  = require('../logger');
const { requireAuth, resolveGitHubToken } = require('../middleware/auth');
const { parsePrUrl } = require('../github');
const { db }  = require('../firebase');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 30_000;
const MAX_FILES      = 6;
const CONTENT_BYTES_PER_FILE = 8_000;   // chars sent to OpenAI per file

const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|woff2?|ttf|eot|otf|bin|lock|map|min\.js|min\.css)$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ghHeaders(token) {
  return {
    Authorization:  `Bearer ${token}`,
    Accept:         'application/vnd.github.v3+json',
    'User-Agent':   'ai-code-review-bot',
  };
}

async function fetchFileContent(owner, repo, path, ref, token) {
  const res = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    { headers: ghHeaders(token), params: { ref } }
  );
  if (res.data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding: ${res.data.encoding}`);
  }
  return Buffer.from(res.data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
}

// ─── Fix prompt ───────────────────────────────────────────────────────────────

function buildFixSystemPrompt() {
  return `You are an expert software engineer applying targeted code fixes.
You will receive file contents from a GitHub PR and a list of known issues.
Fix ONLY the identified issues — do NOT rewrite the file or change unrelated code.

Return ONLY a valid JSON object — no markdown fences, no prose:
{
  "fixes": [
    {
      "path": "<exact filename>",
      "fixed_content": "<complete corrected file content>",
      "changes": ["<one-line description of each individual change>"]
    }
  ],
  "overall_summary": "<1–2 sentences describing all fixes applied>"
}

Rules:
- Only include files where you actually made changes
- Preserve all existing formatting, indentation, and comments
- Do NOT add, remove, or reformat code unrelated to the listed issues
- If a file has no fixable issues, omit it from fixes[]`;
}

function buildFixUserPrompt(files, issues, rules, prDetails) {
  const parts = [];

  parts.push(`PR: "${prDetails.title}" by @${prDetails.user?.login}`);
  parts.push(`Repository: ${prDetails.base.repo.full_name}  |  Base branch: ${prDetails.base.ref}`);

  if (issues.length > 0) {
    parts.push('\n## Issues to fix (from AI review):');
    issues.slice(0, 20).forEach((issue, i) => {
      const sev = (issue.severity || 'medium').toUpperCase();
      parts.push(`${i + 1}. [${sev}] ${issue.file || 'general'} — ${issue.issue}`);
      if (issue.suggestion) parts.push(`   → Fix: ${issue.suggestion}`);
    });
  } else {
    parts.push('\n## No prior issues found — fix any obvious bugs, security issues, or code quality problems you detect.');
  }

  if (rules.length > 0) {
    parts.push('\n## Project rules to respect:');
    rules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
  }

  parts.push('\n## Files to fix:');
  for (const f of files) {
    const snippet = f.content.length > CONTENT_BYTES_PER_FILE
      ? f.content.substring(0, CONTENT_BYTES_PER_FILE) + '\n// [...file truncated...]'
      : f.content;
    parts.push(`\n### ${f.path}\n\`\`\`\n${snippet}\n\`\`\``);
  }

  return parts.join('\n');
}

// ─── Route: POST /apply-fix ───────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  const { pr_url, project_id } = req.body;
  const requestId = crypto.randomUUID();

  if (!pr_url?.trim()) {
    return res.status(400).json({ error: 'pr_url is required', request_id: requestId });
  }

  // ── 1. Resolve GitHub token ──────────────────────────────────────────────────
  const { token: githubToken } = await resolveGitHubToken(req.userId);
  if (!githubToken) {
    return res.status(401).json({
      error: 'GitHub account not connected. Connect GitHub before applying fixes.',
      request_id: requestId,
    });
  }

  // ── 2. Parse PR URL ──────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parsePrUrl(pr_url);
  } catch (err) {
    return res.status(400).json({ error: err.message, request_id: requestId });
  }
  const { owner, repo, pull_number } = parsed;

  logger.info('apply-fix.start', { requestId, owner, repo, pull_number, userId: req.userId });

  // ── 3. Fetch PR metadata ─────────────────────────────────────────────────────
  let prDetails;
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
      { headers: ghHeaders(githubToken) }
    );
    prDetails = r.data;
  } catch (err) {
    const hint = err.response?.status === 404
      ? ' — PR not found or token lacks repo access'
      : ` — ${err.response?.data?.message || err.message}`;
    return res.status(502).json({ error: `Failed to fetch PR${hint}`, request_id: requestId });
  }

  const baseBranch = prDetails.base.ref;
  const headSha    = prDetails.head.sha;

  if (prDetails.state === 'closed') {
    return res.status(400).json({
      error: 'This PR is already closed. Apply fixes can only run on open PRs.',
      request_id: requestId,
    });
  }

  // ── 4. Fetch list of changed files ───────────────────────────────────────────
  let prFiles;
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/files`,
      { headers: ghHeaders(githubToken) }
    );
    prFiles = r.data;
  } catch (err) {
    return res.status(502).json({
      error: `Failed to fetch PR files: ${err.response?.data?.message || err.message}`,
      request_id: requestId,
    });
  }

  const eligible = prFiles
    .filter(f => f.status !== 'removed' && !SKIP_EXT.test(f.filename) && f.changes > 0)
    .slice(0, MAX_FILES);

  if (eligible.length === 0) {
    return res.status(400).json({
      error: 'No eligible source files found in this PR (all files are binary, deleted, or unchanged).',
      request_id: requestId,
    });
  }

  // ── 5. Fetch file contents ───────────────────────────────────────────────────
  const filesWithContent = [];
  for (const file of eligible) {
    try {
      const content = await fetchFileContent(owner, repo, file.filename, headSha, githubToken);
      if (content.length > MAX_FILE_BYTES) {
        logger.info('apply-fix.skip_large', { requestId, path: file.filename, bytes: content.length });
        continue;
      }
      filesWithContent.push({ path: file.filename, content });
    } catch (err) {
      logger.warn('apply-fix.fetch_file_failed', { requestId, path: file.filename, error: err.message });
    }
  }

  if (filesWithContent.length === 0) {
    return res.status(400).json({
      error: 'Could not fetch any file contents from GitHub (files may be too large or binary).',
      request_id: requestId,
    });
  }

  // ── 6. Load prior review issues + project rules for context ──────────────────
  let recentIssues = [];
  let projectRules = [];

  if (project_id && db) {
    try {
      // Most recent review for this exact PR URL
      const snap = await db.collection('reviews')
        .where('projectId', '==', project_id)
        .get();

      const matching = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(d => d.pr_url === prDetails.html_url || d.pr_url === pr_url)
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });

      if (matching.length > 0) recentIssues = matching[0].issues || [];

      const projDoc = await db.collection('projects').doc(project_id).get();
      if (projDoc.exists) projectRules = projDoc.data().rules || [];
    } catch (err) {
      logger.warn('apply-fix.context_failed', { requestId, error: err.message });
    }
  }

  logger.info('apply-fix.context', {
    requestId,
    files:          filesWithContent.map(f => f.path),
    issues_loaded:  recentIssues.length,
    rules_loaded:   projectRules.length,
  });

  // ── 7. Ask OpenAI to generate fixes ─────────────────────────────────────────
  let aiResult;
  try {
    logger.info('apply-fix.ai_start', { requestId });

    const completion = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages: [
        { role: 'system', content: buildFixSystemPrompt() },
        { role: 'user',   content: buildFixUserPrompt(filesWithContent, recentIssues, projectRules, prDetails) },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.1,
    });

    aiResult = JSON.parse(completion.choices[0].message.content);
    logger.info('apply-fix.ai_done', { requestId, fixes: aiResult.fixes?.length ?? 0 });
  } catch (err) {
    logger.error('apply-fix.ai_failed', { requestId, error: err.message });
    return res.status(500).json({ error: `AI fix generation failed: ${err.message}`, request_id: requestId });
  }

  if (!aiResult.fixes?.length) {
    return res.json({
      success:         false,
      message:         'AI found no changes to apply — the code may already be correct or the issues are non-trivial to auto-fix.',
      overall_summary: aiResult.overall_summary || '',
      patches:         [],
      request_id:      requestId,
    });
  }

  // ── 8. Generate unified diffs (patch preview) ────────────────────────────────
  const patches = aiResult.fixes.map((fix) => {
    const original = filesWithContent.find(f => f.path === fix.path);
    const diff = Diff.createPatch(
      fix.path,
      original ? original.content : '',
      fix.fixed_content || '',
      'original',
      'ai-fixed',
    );
    return {
      path:    fix.path,
      diff,
      changes: fix.changes || [],
    };
  });

  // ── 9. GitHub commit flow ────────────────────────────────────────────────────
  const branchName = `ai-fix-${pull_number}-${Date.now()}`;

  try {
    // Get current tip of base branch
    const refRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
      { headers: ghHeaders(githubToken) }
    );
    const baseSha = refRes.data.object.sha;

    // Get base commit to find tree SHA
    const commitRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseSha}`,
      { headers: ghHeaders(githubToken) }
    );
    const baseTreeSha = commitRes.data.tree.sha;

    // Create a blob for each fixed file
    const treeItems = [];
    for (const fix of aiResult.fixes) {
      const blobRes = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
        { content: fix.fixed_content, encoding: 'utf-8' },
        { headers: ghHeaders(githubToken) }
      );
      treeItems.push({
        path: fix.path,
        mode: '100644',
        type: 'blob',
        sha:  blobRes.data.sha,
      });
    }

    // Create new tree on top of base
    const treeRes = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/trees`,
      { base_tree: baseTreeSha, tree: treeItems },
      { headers: ghHeaders(githubToken) }
    );

    // Create commit
    const commitMsg = [
      `🤖 AI Patch Fix for PR #${pull_number}`,
      '',
      aiResult.overall_summary || 'Applied AI-generated fixes.',
      '',
      `Files changed (${aiResult.fixes.length}):`,
      ...aiResult.fixes.map(f => `  - ${f.path}`),
      '',
      `Generated by AI Code Review | Original PR: ${prDetails.html_url}`,
    ].join('\n');

    const newCommitRes = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/commits`,
      { message: commitMsg, tree: treeRes.data.sha, parents: [baseSha] },
      { headers: ghHeaders(githubToken) }
    );

    // Create branch ref
    await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${branchName}`, sha: newCommitRes.data.sha },
      { headers: ghHeaders(githubToken) }
    );

    // Build PR body
    const prBody = [
      `## 🤖 AI Patch Fix`,
      '',
      `> Auto-generated fixes for PR #${pull_number}: [${prDetails.title}](${prDetails.html_url})`,
      '',
      `**Summary:** ${aiResult.overall_summary || 'Applied AI-generated fixes.'}`,
      '',
      '### Changes by file',
      ...aiResult.fixes.flatMap(fix => [
        `#### \`${fix.path}\``,
        ...(fix.changes || []).map(c => `- ${c}`),
        '',
      ]),
      '---',
      '*This PR was auto-generated by [AI Code Review](https://github.com/vinay0222/ai-code-review-frontend). Please review the changes carefully before merging.*',
    ].join('\n');

    const newPrRes = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        title: `🤖 AI Patch Fix for #${pull_number} — ${prDetails.title}`,
        body:  prBody,
        head:  branchName,
        base:  baseBranch,
      },
      { headers: ghHeaders(githubToken) }
    );

    logger.info('apply-fix.done', {
      requestId,
      branch:      branchName,
      new_pr_url:  newPrRes.data.html_url,
      files_fixed: aiResult.fixes.length,
    });

    return res.json({
      success:         true,
      pr_url:          newPrRes.data.html_url,
      pr_number:       newPrRes.data.number,
      branch:          branchName,
      overall_summary: aiResult.overall_summary || '',
      patches,
      files_fixed:     aiResult.fixes.length,
      request_id:      requestId,
    });

  } catch (err) {
    const hint = err.response?.data?.message || err.message;
    logger.error('apply-fix.github_failed', { requestId, error: hint, status: err.response?.status });

    // Return patches even if GitHub operations failed so user can see the diffs
    return res.status(502).json({
      error:           `GitHub operation failed: ${hint}`,
      patches,
      overall_summary: aiResult.overall_summary || '',
      request_id:      requestId,
    });
  }
});

module.exports = router;
