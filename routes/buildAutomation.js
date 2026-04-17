/**
 * Flutter CI build automation
 *
 * POST /setup-build-workflow — push flutter-build.yml + store Firestore config
 *
 * GET build status: see GET /auth/github/build-status (routes/auth.js)
 */

const express = require('express');
const axios   = require('axios');

const { requireAuth, resolveGitHubToken } = require('../middleware/auth');
const { db } = require('../firebase');
const logger = require('../logger');
const {
  generateFlutterBuildWorkflow,
  WORKFLOW_FILE,
  WORKFLOW_NAME,
} = require('../lib/flutterBuildWorkflow');

const router = express.Router();

function normaliseSlug(raw) {
  if (!raw) return null;
  return raw
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':  'AI-Code-Review-Tool/1.0',
  };
}

function buildHint(status, err) {
  const msg = err?.response?.data?.message || err?.message || '';
  if (status === 403 && /workflow/i.test(msg) && /scope/i.test(msg)) {
    return 'Connected GitHub token is missing workflow scope. Reconnect GitHub and grant workflow access.';
  }
  if (status === 401) return 'GitHub token is invalid or expired. Reconnect your GitHub account.';
  if (status === 403) return 'Your token lacks write access to this repository.';
  if (status === 404) return 'Repository not found or not accessible.';
  return msg || 'Unknown error.';
}

function buildDetails(status, err, slug) {
  const msg = err?.response?.data?.message || err?.message || '';
  if (status === 403 && /workflow/i.test(msg) && /scope/i.test(msg)) {
    return [
      'GitHub rejected workflow file updates because the token is missing workflow scope.',
      'Disconnect and reconnect GitHub from the app, then allow requested permissions.',
      `Try again for ${slug}.`,
    ];
  }
  if (status === 404) {
    return [
      `The connected GitHub account cannot access ${slug}, or the repository path is wrong.`,
      'Open Overview tab and confirm the repo URL.',
      'Ensure the connected GitHub user has access to this repository.',
    ];
  }
  if (status === 403) {
    return [
      `The connected GitHub account can see ${slug} but cannot push workflow files.`,
      'Grant write/admin permission to that account in the repository.',
      'If this is an organization repo, ensure org access is approved for the OAuth app.',
    ];
  }
  if (msg) return [msg];
  return [];
}

async function verifyRepoWriteAccess({ headers, owner, repoName }) {
  const slug = `${owner}/${repoName}`;
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}`,
      { headers, timeout: 12000 }
    );

    const perms = data.permissions || {};
    // permissions can be absent depending on token type / org policy;
    // only hard-fail when GitHub explicitly reports no write/admin/maintain.
    const hasPermissionsObject = Object.keys(perms).length > 0;
    const hasWrite = !!(perms.push || perms.admin || perms.maintain);
    if (hasPermissionsObject && !hasWrite) {
      return {
        ok: false,
        reason: 'Connected GitHub account has read access but not write access to this repository.',
        details: buildDetails(403, { response: { data: { message: 'Missing repository write access' } } }, slug),
        defaultBranch: data.default_branch || 'main',
      };
    }

    return { ok: true, defaultBranch: data.default_branch || 'main' };
  } catch (err) {
    // Best effort check only. Don't block setup flow on precheck failures;
    // direct push / fallback PR attempt gives a more reliable answer.
    const status = err.response?.status;
    return {
      ok: null,
      reason: buildHint(status, err),
      details: buildDetails(status, err, slug),
      defaultBranch: 'main',
    };
  }
}

async function createWorkflowPrFallback({
  owner,
  repoName,
  headers,
  filePath,
  yaml,
  existingSha,
  defaultBranch,
  autoMerge,
}) {
  const branchName = `ai-build-workflow-${Date.now()}`;

  // Create branch from default branch head
  const baseRef = await axios.get(
    `https://api.github.com/repos/${owner}/${repoName}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { headers, timeout: 12000 }
  );
  const baseSha = baseRef.data.object.sha;

  await axios.post(
    `https://api.github.com/repos/${owner}/${repoName}/git/refs`,
    { ref: `refs/heads/${branchName}`, sha: baseSha },
    { headers, timeout: 12000 }
  );

  // Write workflow on fallback branch
  const fileApi = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(filePath)}`;
  const putBody = {
    message: existingSha
      ? 'chore(ci): update Flutter build workflow'
      : 'chore(ci): add Flutter build workflow',
    content: Buffer.from(yaml, 'utf8').toString('base64'),
    branch: branchName,
    ...(existingSha && { sha: existingSha }),
  };
  await axios.put(fileApi, putBody, { headers, timeout: 20000 });

  const prBody = [
    '## Build automation fallback PR',
    '',
    'Direct push to the default branch failed, so this PR was created automatically.',
    '',
    `- Workflow file: \`${filePath}\``,
    `- Base branch: \`${defaultBranch}\``,
    '',
    'Review and merge to enable Flutter build automation.',
  ].join('\n');

  const prRes = await axios.post(
    `https://api.github.com/repos/${owner}/${repoName}/pulls`,
    {
      title: 'chore(ci): add Flutter build workflow',
      head: branchName,
      base: defaultBranch,
      body: prBody,
    },
    { headers, timeout: 15000 }
  );

  let mergeResult = null;
  if (autoMerge) {
    try {
      const mergeRes = await axios.put(
        `https://api.github.com/repos/${owner}/${repoName}/pulls/${prRes.data.number}/merge`,
        {
          merge_method: 'squash',
          commit_title: 'chore(ci): add Flutter build workflow',
        },
        { headers, timeout: 15000 }
      );
      mergeResult = {
        merged: true,
        sha: mergeRes.data.sha || null,
        message: mergeRes.data.message || 'PR merged successfully.',
      };
    } catch (mergeErr) {
      mergeResult = {
        merged: false,
        message: mergeErr?.response?.data?.message || mergeErr.message || 'Auto-merge failed.',
      };
    }
  }

  return {
    pr: {
      number: prRes.data.number,
      url: prRes.data.html_url,
      branch: branchName,
      base: defaultBranch,
    },
    merge: mergeResult,
  };
}

/** Verify project belongs to user and return ref */
async function assertProjectOwned(projectId, userId) {
  if (!projectId || !db) return null;
  const ref = db.collection('projects').doc(projectId);
  const doc = await ref.get();
  if (!doc.exists) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }
  if (doc.data().userId !== userId) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }
  return ref;
}

// ─── POST /setup-build-workflow ───────────────────────────────────────────────
//
// Body:
// {
//   "repo": "owner/repo",
//   "project_id": "optional",
//   "enabled": true,
//   "branches": ["main", "develop"],
//   "android": { "apk_name_format": "app-{run}-{branch}" },
//   "windows": { "enabled": false, "exe_name_format": "..." }
// }

router.post('/setup-build-workflow', requireAuth, async (req, res) => {
  const {
    repo,
    project_id,
    enabled = true,
    branches,
    android: androidIn,
    windows: windowsIn,
    fallback_on_push_failure = false,
    auto_merge_fallback_pr = false,
  } = req.body || {};

  if (!repo) {
    return res.status(400).json({ error: 'repo is required' });
  }

  const slug = normaliseSlug(repo);
  if (!slug || !slug.includes('/')) {
    return res.status(400).json({ error: 'repo must be "owner/repo" or a github.com URL' });
  }

  let projectRef = null;
  try {
    if (project_id) projectRef = await assertProjectOwned(project_id, req.userId);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }

  const { token } = await resolveGitHubToken(req.userId);
  if (!token) {
    return res.status(401).json({ error: 'GitHub account not connected. Connect GitHub first.' });
  }

  const android = {
    apk_name_format: (androidIn && androidIn.apk_name_format) || 'app-{run}-{branch}',
  };
  const windows = {
    enabled: !!(windowsIn && windowsIn.enabled),
    exe_name_format: (windowsIn && windowsIn.exe_name_format) || 'app-{run}-{branch}',
  };

  const { yaml, filePath } = generateFlutterBuildWorkflow({
    enabled: enabled !== false,
    branches: Array.isArray(branches) ? branches : ['main'],
    android,
    windows,
  });

  const [owner, repoName] = slug.split('/');
  const headers = ghHeaders(token);
  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(filePath)}`;

  const firestorePayload = {
    enabled:              enabled !== false,
    branches:             Array.isArray(branches) && branches.length ? branches : ['main'],
    android,
    windows,
    fallback: {
      on_push_failure: !!fallback_on_push_failure,
      auto_merge_pr: !!(fallback_on_push_failure && auto_merge_fallback_pr),
    },
    workflow_path:        filePath,
    workflow_name:        WORKFLOW_NAME,
    updated_at:           new Date().toISOString(),
  };

  const access = await verifyRepoWriteAccess({ headers, owner, repoName });
  if (access.ok === false) {
    return res.json({
      success: false,
      push_failed: true,
      reason: access.reason,
      details: access.details,
      file_path: filePath,
      workflow_yaml: yaml,
      build_automation: firestorePayload,
    });
  }
  const defaultBranch = access.defaultBranch || 'main';

  const contentBase64 = Buffer.from(yaml, 'utf8').toString('base64');

  let existingSha;
  try {
    const existing = await axios.get(apiUrl, { headers, timeout: 12000 });
    existingSha = existing.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) {
      logger.error('build_automation.read_failed', { slug, status: err.response?.status });
      return res.json({
        success: false,
        push_failed: true,
        reason: buildHint(err.response?.status, err),
        details: buildDetails(err.response?.status, err, slug),
        file_path: filePath,
        workflow_yaml: yaml,
        build_automation: firestorePayload,
      });
    }
  }

  try {
    const putBody = {
      message: existingSha
        ? 'chore(ci): update Flutter build workflow'
        : 'chore(ci): add Flutter build workflow',
      content: contentBase64,
      ...(existingSha && { sha: existingSha }),
    };

    const result = await axios.put(apiUrl, putBody, { headers, timeout: 20000 });

    if (projectRef) {
      await projectRef.update({ build_automation: firestorePayload });
    }

    logger.info('build_automation.pushed', {
      userId: req.userId,
      slug,
      project_id: project_id || null,
      action: existingSha ? 'updated' : 'created',
    });

    return res.json({
      success:    true,
      action:     existingSha ? 'updated' : 'created',
      file_url:   result.data.content?.html_url || null,
      commit_url: result.data.commit?.html_url || null,
      file_path:  filePath,
      message:    existingSha
        ? 'Flutter build workflow updated in your repository.'
        : 'Flutter build workflow created. Add repository secrets (see docs) before running.',
      build_automation: firestorePayload,
      workflow_yaml:    yaml,
      fallback: {
        enabled: !!fallback_on_push_failure,
        used: false,
      },
    });
  } catch (err) {
      logger.error('build_automation.put_failed', {
        slug,
        status: err.response?.status,
        fallback_on_push_failure: !!fallback_on_push_failure,
      });

      // Optional fallback: create PR (and optionally merge) if direct push fails.
      if (fallback_on_push_failure) {
        try {
          const fallback = await createWorkflowPrFallback({
            owner,
            repoName,
            headers,
            filePath,
            yaml,
            existingSha,
            defaultBranch,
            autoMerge: !!auto_merge_fallback_pr,
          });

          if (projectRef) {
            await projectRef.update({ build_automation: firestorePayload });
          }

          const merged = !!fallback.merge?.merged;
          return res.json({
            success: true,
            action: merged ? 'fallback_pr_merged' : 'fallback_pr_created',
            message: merged
              ? 'Direct push failed, but fallback PR was created and auto-merged.'
              : 'Direct push failed, but a fallback PR was created successfully.',
            reason: buildHint(err.response?.status, err),
            details: buildDetails(err.response?.status, err, slug),
            file_path: filePath,
            build_automation: firestorePayload,
            workflow_yaml: yaml,
            fallback: {
              enabled: true,
              used: true,
              pr_url: fallback.pr.url,
              pr_number: fallback.pr.number,
              branch: fallback.pr.branch,
              base: fallback.pr.base,
              auto_merge_requested: !!auto_merge_fallback_pr,
              auto_merge: fallback.merge,
            },
          });
        } catch (fallbackErr) {
          logger.error('build_automation.fallback_failed', {
            slug,
            status: fallbackErr.response?.status,
            error: fallbackErr.message,
          });
        }
      }

      // 200 + success:false so the client can show YAML copy UI like setup-workflow
      return res.json({
        success:       false,
        push_failed:   true,
        reason:        buildHint(err.response?.status, err),
        details:       buildDetails(err.response?.status, err, slug),
        file_path:     filePath,
        workflow_yaml: yaml,
        build_automation: firestorePayload,
        fallback: {
          enabled: !!fallback_on_push_failure,
          used: false,
        },
      });
  }
});

// GET /build-status moved to GET /auth/github/build-status (see routes/auth.js + lib/githubFlutterBuildStatus.js)

module.exports = router;
