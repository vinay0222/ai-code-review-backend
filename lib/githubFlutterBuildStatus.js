/**
 * Shared GitHub Actions status for the Flutter build workflow (read-only).
 * Used by GET /auth/github/build-status so it works without routes/buildAutomation.js on the server.
 */

const axios = require('axios');
const { db } = require('../firebase');
const { resolveGitHubToken } = require('../middleware/auth');
const logger = require('../logger');

// Keep in sync with `lib/flutterBuildWorkflow.js`
const WORKFLOW_FILE = '.github/workflows/flutter-build.yml';
const WORKFLOW_NAME = 'Flutter Build';

function normaliseSlug(raw) {
  if (!raw) return null;
  return String(raw)
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function ghHeaders(token) {
  return {
    Authorization:        `Bearer ${token}`,
    Accept:               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':         'AI-Code-Review-Tool/1.0',
  };
}

function buildHint(status, err) {
  if (status === 401) return 'GitHub token is invalid or expired. Reconnect your GitHub account.';
  if (status === 403) return 'Your token lacks access to this repository.';
  if (status === 404) return 'Repository not found or not accessible.';
  return err?.response?.data?.message || err?.message || 'Unknown error.';
}

async function assertProjectOwned(projectId, userId) {
  if (!projectId || !db) return;
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
}

/**
 * @param {object} q
 * @param {string} [q.repo]
 * @param {string} [q.project_id]
 * @param {string} q.userId
 * @returns {Promise<{ status: number, body: object }>}
 */
async function buildFlutterBuildStatusResponse(q) {
  const slug = normaliseSlug(q.repo);
  const project_id = q.project_id || null;

  if (!slug || !slug.includes('/')) {
    return { status: 400, body: { error: 'repo query param required (owner/repo)' } };
  }

  try {
    if (project_id && db) await assertProjectOwned(project_id, q.userId);
  } catch (e) {
    return { status: e.status || 500, body: { error: e.message } };
  }

  const { token } = await resolveGitHubToken(q.userId);
  if (!token) {
    return { status: 401, body: { error: 'GitHub account not connected' } };
  }

  const [owner, repoName] = slug.split('/');
  const headers = ghHeaders(token);

  let projectBuild = null;
  if (project_id && db) {
    const p = await db.collection('projects').doc(project_id).get();
    if (p.exists) projectBuild = p.data().build_automation || null;
  }

  try {
    const wfListUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows`;
    const { data: wfList } = await axios.get(wfListUrl, {
      headers,
      params: { per_page: 100 },
      timeout: 12000,
    });

    const flutterWf = (wfList.workflows || []).find(
      (w) => w.path === WORKFLOW_FILE || w.name === WORKFLOW_NAME
    );

    const workflow_installed = !!flutterWf;

    let latest = null;
    if (flutterWf) {
      const runsUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${flutterWf.id}/runs`;
      const { data: runsData } = await axios.get(runsUrl, {
        headers,
        params: { per_page: 10 },
        timeout: 15000,
      });
      latest = (runsData.workflow_runs || [])[0] || null;
    }

    if (!latest) {
      const fallbackUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/runs`;
      const { data: runsData } = await axios.get(fallbackUrl, {
        headers,
        params: { per_page: 30 },
        timeout: 15000,
      });
      const workflowRuns = (runsData.workflow_runs || []).filter(
        (r) =>
          r.name === WORKFLOW_NAME ||
          (typeof r.path === 'string' && r.path.includes('flutter-build.yml'))
      );
      latest = workflowRuns[0] || null;
    }

    let artifacts = [];
    if (latest) {
      try {
        const artUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/runs/${latest.id}/artifacts`;
        const { data: artData } = await axios.get(artUrl, {
          headers,
          params: { per_page: 30 },
          timeout: 12000,
        });
        artifacts = (artData.artifacts || []).map((a) => ({
          name:                 a.name,
          size_in_bytes:        a.size_in_bytes,
          expired:              a.expired,
          archive_download_url: a.archive_download_url || null,
        }));
      } catch (ae) {
        logger.warn('flutter_build_status.artifacts_failed', { runId: latest.id, err: ae.message });
      }
    }

    const shortSha = latest?.head_sha ? latest.head_sha.slice(0, 7) : null;

    return {
      status: 200,
      body: {
        repo:               slug,
        workflow_file:      WORKFLOW_FILE,
        workflow_name:      WORKFLOW_NAME,
        workflow_installed: workflow_installed,
        stored_config:      projectBuild,
        latest: latest
          ? {
              id:             latest.id,
              status:         latest.status,
              conclusion:     latest.conclusion,
              html_url:       latest.html_url,
              run_number:     latest.run_number,
              head_branch:    latest.head_branch,
              head_sha:       latest.head_sha,
              head_sha_short: shortSha,
              created_at:     latest.created_at,
              display_title:  latest.display_title || latest.name,
              event:          latest.event,
            }
          : null,
        artifacts,
        hint: !latest
          ? `No runs found for "${WORKFLOW_NAME}". Push to a configured branch or run workflow manually.`
          : null,
      },
    };
  } catch (err) {
    logger.warn('flutter_build_status.failed', { slug, status: err.response?.status });
    return {
      status: err.response?.status || 502,
      body:   { error: buildHint(err.response?.status, err) },
    };
  }
}

module.exports = {
  buildFlutterBuildStatusResponse,
};
