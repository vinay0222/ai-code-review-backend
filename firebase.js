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

if (!admin.apps.length) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      '❌  Firebase Admin not initialised — set FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env'
    );
  } else {
    // Sanity-check the key shape before handing to Firebase SDK
    const keyOk = privateKey.includes('-----BEGIN') && privateKey.includes('-----END');
    if (!keyOk) {
      console.error(
        '❌  FIREBASE_PRIVATE_KEY does not look like a valid PEM key.\n' +
        `   First 60 chars: ${privateKey.slice(0, 60)}\n` +
        '   Make sure you pasted the full key WITHOUT surrounding quotes.'
      );
    }

    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      console.log(`   Firebase Admin: ✅ initialised (project: ${projectId})`);
    } catch (err) {
      console.error('❌  Firebase Admin initializeApp failed:', err.message);
      console.error(
        '   Key diagnostic — starts with:',
        JSON.stringify(privateKey.slice(0, 50)),
        '| line count:', privateKey.split('\n').length
      );
      // Re-throw so the process exits with a clear error rather than silently failing
      throw err;
    }
  }
}

const db = admin.apps.length ? admin.firestore() : null;

module.exports = { admin, db };
