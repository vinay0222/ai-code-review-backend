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
  if (status === 401) return 'GitHub token is invalid or expired. Reconnect your GitHub account.';
  if (status === 403) return 'Your token lacks write access to this repository.';
  if (status === 404) return 'Repository not found or not accessible.';
  return err?.response?.data?.message || err?.message || 'Unknown error.';
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
        file_path: filePath,
        workflow_yaml: yaml,
      });
    }
  }

  const firestorePayload = {
    enabled:              enabled !== false,
    branches:             Array.isArray(branches) && branches.length ? branches : ['main'],
    android,
    windows,
    workflow_path:        filePath,
    workflow_name:        WORKFLOW_NAME,
    updated_at:           new Date().toISOString(),
  };

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
    });
    } catch (err) {
      logger.error('build_automation.put_failed', { slug, status: err.response?.status });
      // 200 + success:false so the client can show YAML copy UI like setup-workflow
      return res.json({
        success:       false,
        push_failed:   true,
        reason:        buildHint(err.response?.status, err),
        file_path:     filePath,
        workflow_yaml: yaml,
        build_automation: firestorePayload,
      });
    }
});

// GET /build-status moved to GET /auth/github/build-status (see routes/auth.js + lib/githubFlutterBuildStatus.js)

module.exports = router;
