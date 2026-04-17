/**
 * GitHub OAuth routes
 *
 * Flow:
 *   1. Frontend sends Firebase ID token to GET /auth/github
 *      → we verify it, create a short-lived state nonce in Firestore
 *      → we redirect the browser to GitHub's OAuth authorize page
 *
 *   2. GitHub redirects back to GET /auth/github/callback?code=&state=
 *      → we verify the state nonce (expiry + ownership)
 *      → we exchange the code for a GitHub access_token
 *      → we fetch the user's GitHub username
 *      → we store { githubToken, githubUsername } in Firestore users/{userId}
 *      → we redirect the browser to the app (see post-OAuth redirect below)
 *
 *   3. GET /auth/github/status  — returns connection status for the logged-in user
 *   4. DELETE /auth/github      — removes the stored token (disconnect)
 */

const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');

const { admin, db }    = require('../firebase');
const { requireAuth }  = require('../middleware/auth');
const logger           = require('../logger');
const { buildFlutterBuildStatusResponse } = require('../lib/githubFlutterBuildStatus');

const router = express.Router();

// ─── Config ────────────────────────────────────────────────────────────────────

const GH_CLIENT_ID     = () => process.env.GITHUB_CLIENT_ID;
const GH_CLIENT_SECRET = () => process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL     = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const CALLBACK_URL     = () => process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/auth/github/callback';
const STATE_TTL_MS     = 10 * 60 * 1000; // 10 minutes

// Same parsing as server.js — used to tie OAuth return redirect to an allowed browser origin.
function parseAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * When the user starts OAuth from fetch(), the browser sends `Origin`.
 * If that origin is in ALLOWED_ORIGINS, we remember it so the callback can
 * redirect back to local dev (http://localhost:5173) even when FRONTEND_URL
 * on Render points at production.
 */
function postOAuthRedirectFromRequest(req) {
  const origin = req.get('Origin');
  if (!origin) return null;
  return parseAllowedOrigins().includes(origin) ? origin : null;
}

function resolvePostOAuthBase(postOAuthRedirect) {
  const raw = (postOAuthRedirect && String(postOAuthRedirect).trim()) || FRONTEND_URL();
  return raw.replace(/\/$/, '');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Save a state nonce in Firestore and return it. */
async function createStateNonce(userId, postOAuthRedirect) {
  const nonce = uuidv4();
  await db.collection('oauth_states').doc(nonce).set({
    userId,
    postOAuthRedirect: postOAuthRedirect || null,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    expiresAt:  new Date(Date.now() + STATE_TTL_MS),
  });
  return nonce;
}

/**
 * Consume a state nonce — verifies it exists, isn't expired, then deletes it.
 * Returns { userId, postOAuthRedirect } on success, throws on failure.
 */
async function consumeStateNonce(nonce) {
  if (!nonce) throw new Error('Missing state parameter');

  const ref = db.collection('oauth_states').doc(nonce);
  const doc = await ref.get();

  if (!doc.exists) throw new Error('Invalid or already-used state parameter');

  const { userId, expiresAt, postOAuthRedirect } = doc.data();
  const expired = expiresAt.toDate ? expiresAt.toDate() < new Date() : expiresAt < new Date();

  // Always delete — one-time use
  await ref.delete();

  if (expired) throw new Error('OAuth state expired — please try again');
  return { userId, postOAuthRedirect: postOAuthRedirect || null };
}

/** Exchange GitHub OAuth code for an access token. */
async function exchangeCodeForToken(code) {
  const res = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id:     GH_CLIENT_ID(),
      client_secret: GH_CLIENT_SECRET(),
      code,
    },
    {
      headers: { Accept: 'application/json' },
      timeout: 10000,
    }
  );

  const { access_token, error, error_description } = res.data;

  if (error || !access_token) {
    throw new Error(`GitHub token exchange failed: ${error_description || error || 'no token returned'}`);
  }

  return access_token;
}

/** Fetch the authenticated user's GitHub login + other profile fields. */
async function fetchGitHubUser(token) {
  const res = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/vnd.github.v3+json',
      'User-Agent':  'AI-Code-Review-Tool/1.0',
    },
    timeout: 10000,
  });
  return res.data;
}

/** Store the GitHub token + username in Firestore users/{userId}. */
async function saveGitHubCredentials(userId, token, username, email) {
  await db.collection('users').doc(userId).set(
    {
      githubToken:          token,
      githubUsername:       username,
      githubEmail:          email || null,
      githubConnectedAt:    admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true } // don't overwrite other user fields
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /auth/github/url
 *
 * Requires Firebase auth (via Authorization header).
 * Returns { url } — the GitHub OAuth authorization URL the frontend should
 * redirect to. Using a JSON response lets the frontend call this via fetch
 * with proper auth headers before issuing the browser redirect.
 */
router.get('/url', requireAuth, async (req, res) => {
  if (!GH_CLIENT_ID() || !GH_CLIENT_SECRET()) {
    return res.status(500).json({
      error: 'GitHub OAuth is not configured on this server (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)',
    });
  }

  try {
    const postOAuthRedirect = postOAuthRedirectFromRequest(req);
    const state = await createStateNonce(req.userId, postOAuthRedirect);
    logger.info('auth.github.url_issued', { userId: req.userId });

    const params = new URLSearchParams({
      client_id:    GH_CLIENT_ID(),
      redirect_uri: CALLBACK_URL(),
      scope:        'repo workflow read:user user:email',
      state,
    });

    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  } catch (err) {
    logger.error('auth.github.url_failed', { userId: req.userId, error: err.message });
    res.status(500).json({ error: 'Failed to generate GitHub OAuth URL' });
  }
});

/**
 * GET /auth/github
 *
 * Requires Firebase auth. Creates a state nonce, then redirects the browser
 * to GitHub's OAuth authorization page.
 */
router.get('/', requireAuth, async (req, res) => {
  if (!GH_CLIENT_ID() || !GH_CLIENT_SECRET()) {
    logger.error('auth.github.missing_config', { userId: req.userId });
    return res.status(500).json({
      error: 'GitHub OAuth is not configured on this server (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)',
    });
  }

  try {
    const postOAuthRedirect = postOAuthRedirectFromRequest(req);
    const state = await createStateNonce(req.userId, postOAuthRedirect);
    logger.info('auth.github.redirect', { userId: req.userId });

    const params = new URLSearchParams({
      client_id:    GH_CLIENT_ID(),
      redirect_uri: CALLBACK_URL(),
      scope:        'repo workflow read:user user:email',
      state,
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  } catch (err) {
    logger.error('auth.github.redirect_failed', { userId: req.userId, error: err.message });
    res.status(500).json({ error: 'Failed to initiate GitHub OAuth' });
  }
});

/**
 * GET /auth/github/callback
 *
 * GitHub redirects here after user authorises (or denies) the app.
 * No Firebase auth header here — the userId comes from the state nonce.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error: ghError, error_description } = req.query;

  /** Best-effort: recover where to send the user using the OAuth state doc. */
  async function redirectBaseFromState() {
    if (!state) return resolvePostOAuthBase(null);
    try {
      const { postOAuthRedirect } = await consumeStateNonce(state);
      return resolvePostOAuthBase(postOAuthRedirect);
    } catch {
      return resolvePostOAuthBase(null);
    }
  }

  // User denied access (GitHub usually still returns `state`)
  if (ghError) {
    logger.warn('auth.github.denied', { error: ghError });
    const base = await redirectBaseFromState();
    return res.redirect(`${base}?github=denied&reason=${encodeURIComponent(ghError)}`);
  }

  if (!code || !state) {
    const base = state ? await redirectBaseFromState() : resolvePostOAuthBase(null);
    return res.redirect(`${base}?github=error&reason=missing_code_or_state`);
  }

  let userId;
  let postOAuthRedirect;
  try {
    ({ userId, postOAuthRedirect } = await consumeStateNonce(state));
  } catch (err) {
    logger.warn('auth.github.invalid_state', { error: err.message });
    const base = resolvePostOAuthBase(null);
    return res.redirect(`${base}?github=error&reason=${encodeURIComponent(err.message)}`);
  }

  const base = resolvePostOAuthBase(postOAuthRedirect);

  let token, ghUser;
  try {
    token  = await exchangeCodeForToken(code);
    ghUser = await fetchGitHubUser(token);
  } catch (err) {
    logger.error('auth.github.exchange_failed', { userId, error: err.message });
    return res.redirect(`${base}?github=error&reason=token_exchange_failed`);
  }

  try {
    await saveGitHubCredentials(userId, token, ghUser.login, ghUser.email);
    logger.info('auth.github.connected', { userId, githubUsername: ghUser.login });
  } catch (err) {
    logger.error('auth.github.save_failed', { userId, error: err.message });
    return res.redirect(`${base}?github=error&reason=save_failed`);
  }

  // Success — redirect back to the dashboard
  res.redirect(`${base}?github=connected&username=${encodeURIComponent(ghUser.login)}`);
});

/**
 * GET /auth/github/status
 *
 * Returns whether the logged-in user has connected their GitHub account.
 * Safe to poll from the frontend — never exposes the token.
 */
router.get('/status', requireAuth, async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    const doc = await db.collection('users').doc(req.userId).get();
    const data = doc.data() || {};

    res.json({
      connected:       !!data.githubToken,
      githubUsername:  data.githubUsername || null,
      connectedAt:     data.githubConnectedAt?.toDate?.()?.toISOString() || null,
    });
  } catch (err) {
    logger.error('auth.github.status_failed', { userId: req.userId, error: err.message });
    res.status(500).json({ error: 'Failed to fetch GitHub connection status' });
  }
});

/**
 * DELETE /auth/github
 *
 * Removes the stored GitHub token (disconnect).
 */
router.delete('/', requireAuth, async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore not available' });

  try {
    await db.collection('users').doc(req.userId).update({
      githubToken:       admin.firestore.FieldValue.delete(),
      githubUsername:    admin.firestore.FieldValue.delete(),
      githubEmail:       admin.firestore.FieldValue.delete(),
      githubConnectedAt: admin.firestore.FieldValue.delete(),
    });
    logger.info('auth.github.disconnected', { userId: req.userId });
    res.json({ success: true, message: 'GitHub account disconnected' });
  } catch (err) {
    logger.error('auth.github.disconnect_failed', { userId: req.userId, error: err.message });
    res.status(500).json({ error: 'Failed to disconnect GitHub account' });
  }
});

/**
 * GET /auth/github/repos
 *
 * Returns all GitHub repos accessible to the logged-in user:
 * - Their own personal repos
 * - Repos from every organisation they belong to
 *
 * Results are sorted by last-push date (most recently active first).
 * The actual token is never returned — only repo metadata.
 */
router.get('/repos', requireAuth, async (req, res) => {
  const { resolveGitHubToken } = require('../middleware/auth');
  const { token } = await resolveGitHubToken(req.userId);

  if (!token) {
    return res.status(401).json({
      error: 'GitHub account not connected. Connect GitHub first to browse repositories.',
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github.v3+json',
    'User-Agent':  'AI-Code-Review-Tool/1.0',
  };

  try {
    // Fetch up to 100 repos the authenticated user can access
    // type=all covers: owned, member (collaborator), and org repos
    const { data } = await axios.get('https://api.github.com/user/repos', {
      headers,
      params: {
        type:      'all',
        sort:      'pushed',
        direction: 'desc',
        per_page:  100,
      },
      timeout: 15000,
    });

    const repos = data.map((r) => ({
      id:             r.id,
      name:           r.name,
      full_name:      r.full_name,
      html_url:       r.html_url,
      description:    r.description || null,
      private:        r.private,
      owner:          r.owner.login,
      owner_type:     r.owner.type,   // 'User' | 'Organization'
      default_branch: r.default_branch,
      pushed_at:      r.pushed_at,
      language:       r.language || null,
    }));

    logger.info('auth.github.repos_fetched', {
      userId:   req.userId,
      count:    repos.length,
      personal: repos.filter((r) => r.owner_type === 'User').length,
      org:      repos.filter((r) => r.owner_type === 'Organization').length,
    });

    res.json({ repos });
  } catch (err) {
    const status = err.response?.status;
    const hint =
      status === 401 ? ' — GitHub token expired, please reconnect'
      : status === 403 ? ' — token lacks repo access'
      : '';
    logger.error('auth.github.repos_failed', { userId: req.userId, status, error: err.message });
    res.status(502).json({ error: `Failed to fetch GitHub repositories${hint}` });
  }
});

/**
 * GET /auth/github/branches
 *
 * Query: repo=owner/repo (or full github.com URL)
 * Returns { branches: string[] } for Build Automation and similar UIs.
 */
router.get('/branches', requireAuth, async (req, res) => {
  const raw = req.query.repo;
  const slug = raw
    ? String(raw)
        .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
    : '';
  if (!slug || !slug.includes('/')) {
    return res.status(400).json({ error: 'repo query param required (owner/repo)' });
  }

  const { resolveGitHubToken } = require('../middleware/auth');
  const { token } = await resolveGitHubToken(req.userId);
  if (!token) {
    return res.status(401).json({ error: 'GitHub account not connected' });
  }

  const [owner, repoName] = slug.split('/');
  const headers = {
    Authorization:        `Bearer ${token}`,
    Accept:               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':         'AI-Code-Review-Tool/1.0',
  };

  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}/branches`,
      { headers, params: { per_page: 100 }, timeout: 15000 }
    );
    const branches = (data || []).map((b) => b.name).filter(Boolean);
    logger.info('auth.github.branches_fetched', { userId: req.userId, owner, repo: repoName, count: branches.length });
    res.json({ branches });
  } catch (err) {
    const status = err.response?.status;
    const msg =
      status === 404 ? 'Repository not found or not accessible.'
        : err.response?.data?.message || err.message || 'Failed to list branches';
    logger.warn('auth.github.branches_failed', { userId: req.userId, status, error: err.message });
    res.status(status && status < 500 ? status : 502).json({ error: msg });
  }
});

/**
 * GET /auth/github/build-status
 *
 * Flutter CI: latest Actions run + artifacts (same payload as legacy GET /build-status).
 * Mounted under /auth/github so it works when buildAutomation routes are not deployed.
 */
router.get('/build-status', requireAuth, async (req, res) => {
  const { status, body } = await buildFlutterBuildStatusResponse({
    repo:       req.query.repo,
    project_id: req.query.project_id || null,
    userId:     req.userId,
  });
  return res.status(status).json(body);
});

module.exports = router;
