const { admin, db } = require('../firebase');
const logger        = require('../logger');

/**
 * requireAuth
 *
 * Verifies the Firebase ID token sent in:
 *   Authorization: Bearer <id_token>
 *
 * On success, attaches req.userId and req.userEmail.
 * On failure, returns 401.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  if (!admin.apps.length) {
    return res.status(500).json({ error: 'Firebase Admin is not initialised on the server' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId    = decoded.uid;
    req.userEmail = decoded.email || null;
    next();
  } catch (err) {
    logger.warn('auth.token_invalid', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * optionalAuth
 *
 * Like requireAuth, but never rejects the request.
 * If a valid Firebase token is present it populates req.userId / req.userEmail.
 * If the header is absent or the token is invalid, the request proceeds
 * anonymously (req.userId === undefined).
 *
 * Use this on routes that support both authenticated users and GitHub Actions
 * (which have no Firebase session).
 */
async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !admin.apps.length) {
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId    = decoded.uid;
    req.userEmail = decoded.email || null;
  } catch (err) {
    // Log but do not block — caller handles missing userId
    logger.warn('auth.optional_token_invalid', { error: err.message });
  }

  next();
}

/**
 * resolveGitHubToken
 *
 * Priority:
 *   1. User's personal GitHub token stored in Firestore (per-user OAuth)
 *   2. Server-level GITHUB_TOKEN env var (GitHub Actions / fallback)
 *   3. null — caller should return a 401/403
 *
 * Returns: { token: string|null, source: 'user'|'server'|null }
 */
async function resolveGitHubToken(userId) {
  if (userId && db) {
    try {
      const doc = await db.collection('users').doc(userId).get();
      const ghToken = doc.data()?.githubToken;
      if (ghToken) {
        return { token: ghToken, source: 'user' };
      }
    } catch (err) {
      logger.warn('auth.resolve_github_token_failed', { userId, error: err.message });
    }
  }

  if (process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, source: 'server' };
  }

  return { token: null, source: null };
}

module.exports = { requireAuth, optionalAuth, resolveGitHubToken };
