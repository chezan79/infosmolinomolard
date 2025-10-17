
// Configurazione Firebase Admin SDK per Node.js (Server-side)
const admin = require('firebase-admin');

let db;

function initializeFirebase() {
  try {
    // Legge le credenziali del service account dalle variabili d'ambiente
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    // Inizializza Firebase Admin
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || "https://tuo-progetto.firebaseio.com"
    });
    
    db = admin.firestore();
    
    console.log('✅ Firebase Admin inizializzato con successo');
    return { app: admin.app(), db };
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
  admin
};
