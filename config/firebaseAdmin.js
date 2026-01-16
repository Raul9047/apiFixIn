const admin = require('firebase-admin');
require('dotenv').config();

let privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (privateKey) {
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n');
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
  console.log("✅ Firebase Admin inicializado correctamente.");
} catch (error) {
  console.error("❌ Error inicializando Firebase:", error);
}

module.exports = admin;