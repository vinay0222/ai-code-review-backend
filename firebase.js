const admin = require('firebase-admin');

/**
 * Parse the Firebase private key robustly.
 *
 * Render / Vercel / dotenv all handle the FIREBASE_PRIVATE_KEY value
 * differently depending on whether you paste it with quotes, with literal \n,
 * or with real newlines. This function normalises all cases:
 *   • strips surrounding " or ' added by some .env parsers
 *   • converts literal \n sequences to real newlines (only when needed)
 */
function parsePrivateKey(raw) {
  if (!raw) return null;
  // 1. Strip surrounding quotes that some paste workflows add
  let key = raw.replace(/^["']|["']$/g, '');
  // 2. If the key has no real newlines yet, convert literal \n → newline
  if (!key.includes('\n')) {
    key = key.replace(/\\n/g, '\n');
  }
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
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    console.log(`   Firebase Admin: ✅ initialised (project: ${projectId})`);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

module.exports = { admin, db };
