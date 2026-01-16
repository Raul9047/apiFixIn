// config/firebase.js
const admin = require('firebase-admin');
require('dotenv').config();

// --- INICIO DEL FIX PARA RENDER ---
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (privateKey) {
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  
  privateKey = privateKey.replace(/\\n/g, '\n');
}

try {
  const serviceAccount = require('./firebase-key.json'); 
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK inicializado.');
} catch (error) {
  console.error('Error Firebase:', error.message);
}

module.exports = admin;