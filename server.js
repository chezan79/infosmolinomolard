
const express = require('express');
const path = require('path');
const { mountPublicFiles } = require('./public-files');
const { createPlanningWorkbook, safeFilename } = require('./planning-export');
const { initializeFirebase, getAuth } = require('./firebase-server-config');
const { mountFirebaseClientConfig } = require('./firebase-client-config-route');
const { createDirectoryRuntime } = require('./employee-directory');
const { createElectionRuntime } = require('./election-engine');
const { mountElectionMonitoring } = require('./election-engine/monitoring');
const { validateProductionConfig } = require('./production-config');

const app = express();
const runtimeConfig = validateProductionConfig(process.env);
app.set('trust proxy', runtimeConfig.trustProxyHops);

app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok' });
});

if (runtimeConfig.production) {
  app.use((req, res, next) => {
    if (req.get('host') !== new URL(runtimeConfig.canonicalOrigin).host ||
        req.protocol !== 'https') {
      return res.status(421).json({ error: 'CANONICAL_ORIGIN_REQUIRED' });
    }
    return next();
  });
}

// Inizializza Firebase se la configurazione è disponibile
let firebaseDb = null;
let firebaseAuth = null;
let firebaseBucket = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const { db, bucket } = initializeFirebase();
    firebaseDb = db;
    firebaseBucket = bucket;
    firebaseAuth = getAuth();
  } catch (error) {
    if (runtimeConfig.production) throw new Error('Firebase Admin initialization failed');
    console.warn('Firebase Admin initialization failed; server-managed durable features are unavailable');
  }
} else {
  if (runtimeConfig.production) throw new Error('Firebase Admin configuration is required');
  console.warn('Firebase Admin is not configured; server-managed durable features are unavailable');
}

const employeeDirectory = createDirectoryRuntime({
  env: process.env,
  firebaseDb,
  firebaseAuth,
  firebaseBucket,
});
const electionRuntime = createElectionRuntime({
  env: process.env,
  firebaseDb,
  directoryService: employeeDirectory.service,
});
electionRuntime.mount(app);
app.use(express.json());
employeeDirectory.mount(app);
mountElectionMonitoring(app, { env: process.env, firebaseDb, firebaseAuth });
mountFirebaseClientConfig(app, process.env);

app.get(
  ['/administration', '/administration.html'],
  employeeDirectory.authorizeAdministrationPage,
  (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'private-pages', 'administration.html'));
  },
);

app.get(
  ['/gestion-photos-collaborateurs', '/gestion-photos-collaborateurs.html'],
  employeeDirectory.authorizeAdministrationPage,
  (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'private-pages', 'gestion-photos-collaborateurs.html'));
  },
);

// Middleware per servire file statici
mountPublicFiles(app, __dirname);

app.get('/api/v1/operations/election-readiness', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const report = electionRuntime.readiness();
  return res.status(report.ready ? 200 : 503).json(report);
});

app.get('/readyz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const election = electionRuntime.readiness();
  const ready = election.ready && employeeDirectory.administrationConfigured &&
    (!runtimeConfig.production || Boolean(firebaseBucket));
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    checks: {
      administration: employeeDirectory.administrationConfigured,
      durableStorage: Boolean(firebaseBucket),
      election: election.ready,
    },
  });
});

const unsafeLegacyPrefixes = [
  '/api/save-planning',
  '/api/get-planning/',
  '/api/process-planning',
  '/api/download-google-sheets',
  '/api/sync-sheets-to-firebase',
  '/api/training/',
];
app.use((req, res, next) => {
  if (runtimeConfig.production && unsafeLegacyPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  return next();
});

// Route per la home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/collaborateur-du-mois', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'collaborateur-du-mois.html'));
});

// API per salvare planning su Firebase
app.post('/api/save-planning', async (req, res) => {
  try {
    const { planningData, week, department } = req.body;
    
    // Qui integrerai Firebase Admin SDK per salvare i dati
    // Per ora restituisco un placeholder
    const docId = `planning_${week}_${department}_${Date.now()}`;
    
    res.json({
      success: true,
      message: 'Planning salvato con successo',
      docId: docId,
      timestamp: new Date().toISOString()
    });
    
  } catch {
    console.error('planning_save_failed');
    res.status(500).json({ error: 'Errore nel salvare il planning su Firebase' });
  }
});

// API per recuperare planning da Firebase
app.get('/api/get-planning/:week/:department', async (req, res) => {
  try {
    const { week, department } = req.params;
    
    // Qui integrerai Firebase Admin SDK per recuperare i dati
    // Per ora restituisco dati mock
    const mockData = [
      { Nome: "Mario Rossi", Lu: "9-17", Ma: "9-17", Me: "Riposo" },
      { Nome: "Luigi Bianchi", Lu: "14-22", Ma: "14-22", Me: "9-17" }
    ];
    
    res.json({
      success: true,
      data: mockData,
      week: week,
      department: department
    });
    
  } catch {
    console.error('planning_load_failed');
    res.status(500).json({ error: 'Errore nel recuperare i dati da Firebase' });
  }
});

// API per esportare dati in Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const { data, filename } = req.body;
    const excelBuffer = await createPlanningWorkbook(data);
    
    // Imposta gli headers per il download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.xlsx"`);
    
    // Invia il file
    res.send(excelBuffer);
    
  } catch {
    console.error('planning_export_failed');
    res.status(400).json({ error: 'Errore nell\'esportazione del file Excel' });
  }
});

// API per processare dati Google Sheets
app.post('/api/process-planning', (req, res) => {
  try {
    const { planningData, filters } = req.body;
    
    // Applica filtri se necessario
    let filteredData = planningData;
    
    if (filters && filters.department) {
      filteredData = planningData.filter(person => 
        person.Dipartimento === filters.department
      );
    }
    
    if (filters && filters.week) {
      // Logica per filtrare per settimana specifica
      // Questo dipende da come strutturi i tuoi dati
    }
    
    res.json({
      success: true,
      data: filteredData,
      totalPersons: filteredData.length
    });
    
  } catch {
    console.error('planning_process_failed');
    res.status(500).json({ error: 'Errore nel processamento dei dati' });
  }
});

// API per scaricare dati da Google Sheets
app.post('/api/download-google-sheets', async (req, res) => {
  try {
    const { sheetUrl, sheetName } = req.body;
    
    console.log('google_sheets_download_started');
    
    if (!sheetUrl) {
      return res.status(400).json({ error: 'URL Google Sheets richiesto' });
    }

    // Verifica se l'URL contiene 'spreadsheets'
    if (!sheetUrl.includes('spreadsheets')) {
      console.error('google_sheets_url_rejected');
      return res.status(400).json({ 
        error: 'URL deve essere di un Google Sheets (contenere "spreadsheets")',
        receivedUrl: sheetUrl
      });
    }

    // Estrai l'ID del foglio dall'URL con controlli migliorati
    const sheetId = extractSheetIdFromUrl(sheetUrl);
    if (!sheetId) {
      console.error('google_sheets_url_rejected');
      return res.status(400).json({ error: 'URL Google Sheets non valido' });
    }


    // URL per accedere ai dati del foglio in formato CSV
    let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    // Se è specificato un nome del foglio, aggiungi il parametro per quel foglio
    if (sheetName) {
      const gid = getSheetGidByName(sheetName);
      csvUrl += `&gid=${gid}`;
    }
    
    // Aggiungi headers per migliorare la compatibilità
    const response = await fetch(csvUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoogleSheetsBot/1.0)',
        'Accept': 'text/csv,text/plain,*/*',
        'Cache-Control': 'no-cache'
      }
    });
    
    console.log(`google_sheets_response status=${response.status}`);
    
    if (!response.ok) {
      await response.text();
      console.error(`google_sheets_upstream_failed status=${response.status}`);
      throw new Error(`Errore ${response.status}: ${response.statusText}. Verifica che il foglio sia pubblico e accessibile.`);
    }

    const csvText = await response.text();
    
    if (!csvText || csvText.trim() === '') {
      throw new Error('Il foglio Google è vuoto o non accessibile');
    }

    const jsonData = parseCSVToJSON(csvText);
    
    console.log(`google_sheets_download_completed rows=${jsonData.length}`);
    
    res.json({
      success: true,
      data: jsonData,
      totalRows: jsonData.length,
      sheetName: sheetName || 'default',
      debug: {
        sheetId: sheetId,
        csvUrl: csvUrl,
        csvLength: csvText.length
      }
    });
    
  } catch {
    console.error('google_sheets_download_failed');
    res.status(500).json({ 
      error: 'Errore nel scaricare i dati. Verifica che il foglio Google sia pubblico e accessibile.'
    });
  }
});

// Funzione per mappare nomi dei fogli ai loro GID
function getSheetGidByName(sheetName) {
  // ⚠️ IMPORTANTE: Aggiorna questi GID con quelli reali dei tuoi fogli Google Sheets
  // Per trovare il GID: apri il foglio → guarda l'URL → cerca "#gid=NUMERO"
  const sheetMapping = {
    'bar': 1264033041,      // ⚠️ Aggiorna con GID reale del foglio bar
    'service': 1763904694,  // ⚠️ Aggiorna con GID reale del foglio service  
    'cuisine': 819005714,   // ⚠️ Aggiorna con GID reale del foglio cuisine
    'pizzeria': 1785252251, // ⚠️ Aggiorna con GID reale del foglio pizzeria
    'office': 2063781370,   // ⚠️ Aggiorna con GID reale del foglio office
    'commis': 1542997572,   // ⚠️ Aggiorna con GID reale del foglio commis
    'respo': 487125612,     // ⚠️ Aggiorna con GID reale del foglio respo
    'BAR': 1264033041,
    'SERVICE': 1763904694,
    'CUISINE': 819005714,
    'PIZZERIA': 1785252251,
    'OFFICE': 2063781370,
    'COMMIS': 1542997572,
    'RESPO': 487125612,
    'Bar': 1264033041,
    'Service': 1763904694,
    'Cuisine': 819005714,
    'Pizzeria': 1785252251,
    'Office': 2063781370,
    'Commis': 1542997572,
    'Respo': 487125612
  };
  
  return sheetMapping[sheetName] || 0; // Default al primo foglio
}

// Funzione per estrarre l'ID del foglio dall'URL
function extractSheetIdFromUrl(url) {
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Funzione per convertire CSV in JSON con gestione migliorata
function parseCSVToJSON(csvText) {
  try {
    console.log(`csv_parse_started bytes=${csvText.length}`);
    
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      console.log('csv_parse_empty');
      return [];
    }
    
    
    // Prima riga contiene le intestazioni con gestione migliorata delle virgolette
    const headers = parseCSVLine(lines[0]);
    
    const result = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const obj = {};
      
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      
      // Solo aggiungi righe che hanno almeno un valore non vuoto
      const hasContent = Object.values(obj).some(val => val && val.trim());
      if (hasContent) {
        result.push(obj);
      }
    }
    
    console.log(`csv_parse_completed rows=${result.length}`);
    return result;
    
  } catch {
    console.error('csv_parse_failed');
    return [];
  }
}

// Funzione helper per parsare una riga CSV gestendo le virgolette
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// API per sincronizzare Google Sheets con Firebase
app.post('/api/sync-sheets-to-firebase', async (req, res) => {
  try {
    const { sheetsData, week, department } = req.body;
    
    // Qui implementerai la logica per salvare i dati da Google Sheets a Firebase
    console.log('planning_sync_started');
    
    res.json({
      success: true,
      message: 'Dati sincronizzati con Firebase',
      recordsProcessed: sheetsData.length
    });
    
  } catch {
    console.error('planning_sync_failed');
    res.status(500).json({ error: 'Errore nella sincronizzazione con Firebase' });
  }
});

// ==================== API PER GESTIONE FORMAZIONI ====================

// Storage in memoria per iscrizioni (da sostituire con Firebase)
const enrollmentsDB = new Map();
let enrollmentCounter = 1;

// API per iscrivere un utente a una formazione
app.post('/api/training/enroll', async (req, res) => {
  try {
    const { trainingId, userData } = req.body;
    
    if (!trainingId || !userData || !userData.firstName || !userData.lastName) {
      return res.status(400).json({ error: 'Dati mancanti per l\'iscrizione' });
    }
    
    const enrollmentId = `enrollment_${enrollmentCounter++}_${Date.now()}`;
    const enrollmentData = {
      id: enrollmentId,
      trainingId,
      userId: userData.userId || `user_${Date.now()}`,
      firstName: userData.firstName,
      lastName: userData.lastName,
      department: userData.department,
      enrollmentDate: new Date().toISOString(),
      completed: false,
      progress: 0,
      completionDate: null
    };
    
    // Salva in Firebase se disponibile, altrimenti in memoria
    if (firebaseDb) {
      await firebaseDb.collection('enrollments').doc(enrollmentId).set(enrollmentData);
      console.log('training_enrollment_saved storage=firebase');
    } else {
      enrollmentsDB.set(enrollmentId, enrollmentData);
      console.log('training_enrollment_saved storage=memory');
    }
    
    res.json({
      success: true,
      message: 'Iscrizione completata con successo',
      enrollment: enrollmentData
    });
    
  } catch {
    console.error('training_enrollment_failed');
    res.status(500).json({ error: 'Errore nell\'iscrizione alla formazione' });
  }
});

// API per recuperare le iscrizioni di un utente
app.get('/api/training/enrollments/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    let userEnrollments = [];
    
    if (firebaseDb) {
      const snapshot = await firebaseDb.collection('enrollments')
        .where('userId', '==', userId)
        .get();
      
      snapshot.forEach(doc => {
        userEnrollments.push(doc.data());
      });
      
      console.log(`training_enrollments_loaded storage=firebase count=${userEnrollments.length}`);
    } else {
      userEnrollments = Array.from(enrollmentsDB.values())
        .filter(e => e.userId === userId);
      
      console.log(`training_enrollments_loaded storage=memory count=${userEnrollments.length}`);
    }
    
    res.json({
      success: true,
      data: userEnrollments
    });
    
  } catch {
    console.error('training_enrollments_load_failed');
    res.status(500).json({ error: 'Errore nel recuperare le iscrizioni' });
  }
});

// API per recuperare tutte le iscrizioni (per admin)
app.get('/api/training/enrollments/all', async (req, res) => {
  try {
    let allEnrollments = [];
    
    if (firebaseDb) {
      const snapshot = await firebaseDb.collection('enrollments').get();
      snapshot.forEach(doc => {
        allEnrollments.push(doc.data());
      });
      console.log(`training_enrollments_admin_loaded storage=firebase count=${allEnrollments.length}`);
    } else {
      allEnrollments = Array.from(enrollmentsDB.values());
      console.log(`training_enrollments_admin_loaded storage=memory count=${allEnrollments.length}`);
    }
    
    res.json({
      success: true,
      data: allEnrollments
    });
    
  } catch {
    console.error('training_enrollments_admin_load_failed');
    res.status(500).json({ error: 'Errore nel recuperare le iscrizioni' });
  }
});

// API per aggiornare il progresso di una formazione
app.put('/api/training/progress/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { progress } = req.body;
    
    const enrollment = enrollmentsDB.get(enrollmentId);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Iscrizione non trovata' });
    }
    
    enrollment.progress = progress;
    enrollment.lastUpdated = new Date().toISOString();
    enrollmentsDB.set(enrollmentId, enrollment);
    
    console.log('training_progress_updated');
    
    res.json({
      success: true,
      message: 'Progresso aggiornato con successo',
      enrollment
    });
    
  } catch {
    console.error('training_progress_update_failed');
    res.status(500).json({ error: 'Errore nell\'aggiornare il progresso' });
  }
});

// API per completare una formazione
app.post('/api/training/complete/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    
    const enrollment = enrollmentsDB.get(enrollmentId);
    
    if (!enrollment) {
      return res.status(404).json({ error: 'Iscrizione non trovata' });
    }
    
    enrollment.completed = true;
    enrollment.progress = 100;
    enrollment.completionDate = new Date().toISOString();
    enrollmentsDB.set(enrollmentId, enrollment);
    
    console.log('training_completed');
    
    res.json({
      success: true,
      message: 'Formazione completata con successo',
      enrollment
    });
    
  } catch {
    console.error('training_completion_failed');
    res.status(500).json({ error: 'Errore nel completare la formazione' });
  }
});

// API per recuperare tutte le formazioni disponibili
app.get('/api/training/available', async (req, res) => {
  try {
    const trainings = [
      {
        id: 'cuisine-pasta',
        title: 'Techniques de base - Préparation "Pasta Fresca"',
        description: 'Impara le tecniche fondamentali per la preparazione della pasta fresca artigianale.',
        department: 'Cuisine',
        duration: '2 ore'
      },
      {
        id: 'cuisine-haccp',
        title: 'Procèdures HACCP en Cuisine',
        description: 'Procedure di sicurezza alimentare e normative HACCP in cucina.',
        department: 'Cuisine',
        duration: '1.5 ore'
      }
    ];
    
    res.json({
      success: true,
      data: trainings
    });
    
  } catch {
    console.error('trainings_load_failed');
    res.status(500).json({ error: 'Errore nel recuperare le formazioni' });
  }
});

// Avvia il server dopo aver caricato l'ultima directory valida disponibile.
async function startServer() {
  try {
    await employeeDirectory.start();
  } catch (error) {
    if (runtimeConfig.production) throw error;
    console.warn('Employee directory unavailable at startup');
  }
  return app.listen(runtimeConfig.port, runtimeConfig.host, () => {
    console.log(`Server avviato su ${runtimeConfig.host}:${runtimeConfig.port}`);
    console.log('Firebase integration ready!');
    console.log('Training system API ready!');
  });
}

startServer().catch(() => {
  console.error('Production startup failed');
  process.exitCode = 1;
});

module.exports = { app, runtimeConfig, startServer };
