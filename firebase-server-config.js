
// Configurazione Firebase Admin SDK per Node.js (Server-side)
const admin = require('firebase-admin');

let db;

function normalizeStorageBucket(value) {
  let bucket = String(value || '').trim().replace(/^["']|["']$/g, '');
  bucket = bucket
    .replace(/^gs:\/\//i, '')
    .replace(/^https:\/\/storage\.googleapis\.com\//i, '')
    .replace(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//i, '');
  return bucket.split(/[/?#]/)[0];
}

function initializeFirebase() {
  try {
    // Legge le credenziali del service account dalle variabili d'ambiente
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    // Inizializza Firebase Admin
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://tuo-progetto.firebaseio.com",
        storageBucket: normalizeStorageBucket(process.env.storageBucket || process.env.FIREBASE_STORAGE_BUCKET)
      });
    }
    
    db = admin.firestore();
    
    console.log('✅ Firebase Admin inizializzato con successo');
    const app = admin.app();
    return { app, db, bucket: app.options.storageBucket ? admin.storage().bucket() : null };
  } catch (error) {
    console.error('❌ Errore nell\'inizializzazione Firebase Admin:', error);
    throw error;
  }
}

function getApp() {
  return admin.app();
}

function getDb() {
  return db;
}

function getAuth() {
  return admin.auth();
}

module.exports = {
  initializeFirebase,
  getApp,
  getDb,
  getAuth,
  admin,
  normalizeStorageBucket,
};
