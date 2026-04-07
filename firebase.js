const admin = require('firebase-admin');

if (!admin.apps.length) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Newlines in .env private keys are stored as literal \n — convert back
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
