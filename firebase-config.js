
// Configurazione Firebase
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Sostituisci con le tue credenziali Firebase
const firebaseConfig = {
  apiKey: "la-tua-api-key",
  authDomain: "il-tuo-progetto.firebaseapp.com",
  projectId: "il-tuo-project-id",
  storageBucket: "il-tuo-progetto.appspot.com",
  messagingSenderId: "123456789",
  appId: "la-tua-app-id"
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Firestore
export const db = getFirestore(app);

// Inizializza Auth
export const auth = getAuth(app);

export default app;
