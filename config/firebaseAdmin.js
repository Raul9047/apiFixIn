// config/firebase.js
const admin = require('firebase-admin');

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