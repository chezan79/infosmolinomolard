
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

// ==================== FUNZIONI PER GESTIONE FORMAZIONI ====================

// Iscrive un collaboratore a una formazione
export async function enrollUserToTraining(trainingId, userData) {
  try {
    const enrollmentRef = collection(db, 'enrollments');
    const docRef = await addDoc(enrollmentRef, {
      trainingId: trainingId,
      userId: userData.userId || `user_${Date.now()}`,
      firstName: userData.firstName,
      lastName: userData.lastName,
      department: userData.department,
      enrollmentDate: new Date(),
      completed: false,
      progress: 0,
      completionDate: null
    });
    
    console.log('Iscrizione salvata con ID:', docRef.id);
    return { success: true, enrollmentId: docRef.id };
  } catch (error) {
    console.error('Errore nell\'iscrizione:', error);
    return { success: false, error: error.message };
  }
}

// Recupera le iscrizioni di un utente
export async function getUserEnrollments(userId) {
  try {
    const enrollmentRef = collection(db, 'enrollments');
    const q = query(enrollmentRef, where('userId', '==', userId));
    
    const querySnapshot = await getDocs(q);
    const enrollments = [];
    
    querySnapshot.forEach((doc) => {
      enrollments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, data: enrollments };
  } catch (error) {
    console.error('Errore nel recuperare le iscrizioni:', error);
    return { success: false, error: error.message };
  }
}

// Aggiorna il progresso di una formazione
export async function updateTrainingProgress(enrollmentId, progress) {
  try {
    const enrollmentRef = doc(db, 'enrollments', enrollmentId);
    await updateDoc(enrollmentRef, {
      progress: progress,
      lastUpdated: new Date()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Errore nell\'aggiornare il progresso:', error);
    return { success: false, error: error.message };
  }
}

// Completa una formazione
export async function completeTraining(enrollmentId) {
  try {
    const enrollmentRef = doc(db, 'enrollments', enrollmentId);
    await updateDoc(enrollmentRef, {
      completed: true,
      progress: 100,
      completionDate: new Date(),
      lastUpdated: new Date()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Errore nel completare la formazione:', error);
    return { success: false, error: error.message };
  }
}

// Recupera tutte le formazioni disponibili
export async function getAvailableTrainings() {
  try {
    const trainingsRef = collection(db, 'trainings');
    const querySnapshot = await getDocs(trainingsRef);
    const trainings = [];
    
    querySnapshot.forEach((doc) => {
      trainings.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, data: trainings };
  } catch (error) {
    console.error('Errore nel recuperare le formazioni:', error);
    return { success: false, error: error.message };
  }
}

// Salva una nuova formazione
export async function saveTraining(trainingData) {
  try {
    const trainingsRef = collection(db, 'trainings');
    const docRef = await addDoc(trainingsRef, {
      title: trainingData.title,
      description: trainingData.description,
      department: trainingData.department,
      duration: trainingData.duration,
      videoUrl: trainingData.videoUrl || null,
      documentUrl: trainingData.documentUrl || null,
      createdAt: new Date(),
      active: true
    });
    
    console.log('Formazione salvata con ID:', docRef.id);
    return { success: true, trainingId: docRef.id };
  } catch (error) {
    console.error('Errore nel salvare la formazione:', error);
    return { success: false, error: error.message };
  }
}
