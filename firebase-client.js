
// Funzioni client-side per Firebase
import { db } from './firebase-config.js';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc 
} from 'firebase/firestore';

// Salva planning su Firebase
export async function savePlanningToFirebase(planningData, week, department) {
  try {
    const planningRef = collection(db, 'planning');
    const docRef = await addDoc(planningRef, {
      data: planningData,
      week: week,
      department: department,
      timestamp: new Date(),
      createdBy: 'admin' // Puoi aggiornare con l'utente autenticato
    });
    
    console.log('Planning salvato con ID: ', docRef.id);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Errore nel salvare il planning:', error);
    return { success: false, error: error.message };
  }
}

// Recupera planning da Firebase
export async function getPlanningFromFirebase(week, department) {
  try {
    const planningRef = collection(db, 'planning');
    const q = query(
      planningRef, 
      where('week', '==', week),
      where('department', '==', department),
      orderBy('timestamp', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const plannings = [];
    
    querySnapshot.forEach((doc) => {
      plannings.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, data: plannings };
  } catch (error) {
    console.error('Errore nel recuperare il planning:', error);
    return { success: false, error: error.message };
  }
}

// Aggiorna planning esistente
export async function updatePlanningInFirebase(planningId, newData) {
  try {
    const planningRef = doc(db, 'planning', planningId);
    await updateDoc(planningRef, {
      data: newData,
      lastUpdated: new Date()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Errore nell\'aggiornare il planning:', error);
    return { success: false, error: error.message };
  }
}

// Elimina planning
export async function deletePlanningFromFirebase(planningId) {
  try {
    await deleteDoc(doc(db, 'planning', planningId));
    return { success: true };
  } catch (error) {
    console.error('Errore nell\'eliminare il planning:', error);
    return { success: false, error: error.message };
  }
}

// Sincronizza dati da Google Sheets a Firebase
export async function syncSheetsToFirebase(sheetsData, week, department) {
  try {
    const result = await savePlanningToFirebase(sheetsData, week, department);
    return result;
  } catch (error) {
    console.error('Errore nella sincronizzazione:', error);
    return { success: false, error: error.message };
  }
}
