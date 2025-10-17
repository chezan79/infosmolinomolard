
// Configurazione Firebase per Node.js (Server-side)
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

let app;
let db;

function initializeFirebase() {
  try {
    // Legge la configurazione dalle variabili d'ambiente
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    
    console.log('✅ Firebase inizializzato con successo');
    return { app, db };
  } catch (error) {
    console.error('❌ Errore nell\'inizializzazione Firebase:', error);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  getApp: () => app,
  getDb: () => db
};
