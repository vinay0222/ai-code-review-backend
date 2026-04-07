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
 *      → we redirect the browser to FRONTEND_URL with ?github=connected
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

const router = express.Router();

// ─── Config ────────────────────────────────────────────────────────────────────

const GH_CLIENT_ID     = () => process.env.GITHUB_CLIENT_ID;
const GH_CLIENT_SECRET = () => process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL     = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const CALLBACK_URL     = () => process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/auth/github/callback';
const STATE_TTL_MS     = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Save a state nonce in Firestore and return it. */
async function createStateNonce(userId) {
  const nonce = uuidv4();
  await db.collection('oauth_states').doc(nonce).set({
    userId,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    expiresAt:  new Date(Date.now() + STATE_TTL_MS),
  });
  return nonce;
}

/**
 * Consume a state nonce — verifies it exists, isn't expired, then deletes it.
 * Returns userId on success, throws on failure.
 */
async function consumeStateNonce(nonce) {
  if (!nonce) throw new Error('Missing state parameter');

  const ref = db.collection('oauth_states').doc(nonce);
  const doc = await ref.get();

  if (!doc.exists) throw new Error('Invalid or already-used state parameter');

  const { userId, expiresAt } = doc.data();
  const expired = expiresAt.toDate ? expiresAt.toDate() < new Date() : expiresAt < new Date();

  // Always delete — one-time use
  await ref.delete();

  if (expired) throw new Error('OAuth state expired — please try again');
  return userId;
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
    const state = await createStateNonce(req.userId);
    logger.info('auth.github.url_issued', { userId: req.userId });

    const params = new URLSearchParams({
      client_id:    GH_CLIENT_ID(),
      redirect_uri: CALLBACK_URL(),
      scope:        'repo read:user user:email',
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
    const state = await createStateNonce(req.userId);
    logger.info('auth.github.redirect', { userId: req.userId });

    const params = new URLSearchParams({
      client_id:    GH_CLIENT_ID(),
      redirect_uri: CALLBACK_URL(),
      scope:        'repo read:user user:email',
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

  // User denied access
  if (ghError) {
    logger.warn('auth.github.denied', { error: ghError });
    return res.redirect(`${FRONTEND_URL()}?github=denied&reason=${encodeURIComponent(ghError)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL()}?github=error&reason=missing_code_or_state`);
  }

  let userId;
  try {
    userId = await consumeStateNonce(state);
  } catch (err) {
    logger.warn('auth.github.invalid_state', { error: err.message });
    return res.redirect(`${FRONTEND_URL()}?github=error&reason=${encodeURIComponent(err.message)}`);
  }

  let token, ghUser;
  try {
    token  = await exchangeCodeForToken(code);
    ghUser = await fetchGitHubUser(token);
  } catch (err) {
    logger.error('auth.github.exchange_failed', { userId, error: err.message });
    return res.redirect(`${FRONTEND_URL()}?github=error&reason=token_exchange_failed`);
  }

  try {
    await saveGitHubCredentials(userId, token, ghUser.login, ghUser.email);
    logger.info('auth.github.connected', { userId, githubUsername: ghUser.login });
  } catch (err) {
    logger.error('auth.github.save_failed', { userId, error: err.message });
    return res.redirect(`${FRONTEND_URL()}?github=error&reason=save_failed`);
  }

  // Success — redirect back to the dashboard
  res.redirect(`${FRONTEND_URL()}?github=connected&username=${encodeURIComponent(ghUser.login)}`);
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

module.exports = router;
