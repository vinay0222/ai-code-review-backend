const admin = require('firebase-admin');

/**
 * Parse the Firebase private key robustly.
 *
 * Render and other platforms handle FIREBASE_PRIVATE_KEY in inconsistent ways:
 *
 *   Case A — Real newlines:   key already has ASCII-10 newlines → works as-is
 *   Case B — Literal \n:      Render stores the two-char sequence (\)(n)
 *                              → must replace with real newlines
 *   Case C — Double-escaped:  some serialisers write (\\)(n), four chars
 *                              → must replace with real newlines
 *   Case D — Quoted value:    dashboard may wrap the value in " or '
 *                              → strip before anything else
 *
 * The replacement `replace(/\\n/g, '\n')` only matches the TWO-character
 * sequence backslash + n.  Because PEM base64 bodies never contain a
 * backslash, applying this unconditionally is safe even when real newlines
 * are already present.
 */
function parsePrivateKey(raw) {
  if (!raw) return null;

  // 1. Trim outer whitespace
  let key = raw.trim();

  // 2. Strip any leading/trailing quote characters (", ' — possibly nested)
  key = key.replace(/^["']+|["']+$/g, '');

  // 3. Convert double-escaped \\n (4 chars) → real newline
  key = key.replace(/\\\\n/g, '\n');

  // 4. Convert literal \n (2 chars: backslash + n) → real newline
  //    Safe to do unconditionally — base64 body never contains backslash
  key = key.replace(/\\n/g, '\n');

  // 5. Normalise Windows line endings just in case
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return key;
}

// ─── Initialise ───────────────────────────────────────────────────────────────
// NOTE: Errors here are logged but do NOT crash the server.
// Routes that need Firestore check `db !== null` and return a clean 503.
// This means the /health endpoint, GitHub OAuth flow, and AI review still
// respond even when Firebase credentials are misconfigured.

let db = null;

if (!admin.apps.length) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      '⚠️  Firebase Admin NOT initialised — FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must all be set.\n' +
      '   Server will start but Firestore-dependent routes will return 503.'
    );
  } else {
    // Quick sanity-check: a valid PEM key always has these markers
    const keyOk = privateKey.includes('-----BEGIN') && privateKey.includes('-----END');
    if (!keyOk) {
      console.error(
        '⚠️  FIREBASE_PRIVATE_KEY does not look like a valid PEM key.\n' +
        `   First 60 chars: ${JSON.stringify(privateKey.slice(0, 60))}\n` +
        '   Paste the raw key value WITHOUT surrounding quotes into Render.'
      );
    }

    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      db = admin.firestore();
      console.log(`   Firebase Admin: ✅ initialised (project: ${projectId})`);
    } catch (err) {
      console.error('⚠️  Firebase Admin initializeApp failed:', err.message);
      console.error(
        '   Key diagnostic:',
        `starts="${JSON.stringify(privateKey.slice(0, 40))}"`,
        `lines=${privateKey.split('\n').length}`,
        `hasBegin=${privateKey.includes('-----BEGIN')}`,
        `hasEnd=${privateKey.includes('-----END')}`
      );
      console.error('   Server will start without Firestore support.');
      // Do NOT re-throw — let the server start so /health stays green
    }
  }
}

// If initializeApp succeeded, db was set above; otherwise stays null.
// (Re-read in case admin.apps.length was already >0 on hot-reload)
if (!db && admin.apps.length) {
  try { db = admin.firestore(); } catch (_) { /* already logged */ }
}

module.exports = { admin, db };
