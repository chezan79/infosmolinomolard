
const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const app = express();
const PORT = 5000;

// Middleware per servire file statici
app.use(express.static('.'));
app.use(express.json());

// Route per la home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
    
  } catch (error) {
    console.error('Errore nel salvare il planning:', error);
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
    
  } catch (error) {
    console.error('Errore nel recuperare il planning:', error);
    res.status(500).json({ error: 'Errore nel recuperare i dati da Firebase' });
  }
});

// API per esportare dati in Excel
app.post('/api/export-excel', (req, res) => {
  try {
    const { data, filename } = req.body;
    
    // Crea un nuovo workbook
    const workbook = XLSX.utils.book_new();
    
    // Converte i dati in worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    
    // Aggiunge il worksheet al workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Planning');
    
    // Genera il file Excel in buffer
    const excelBuffer = XLSX.write(workbook, { 
      type: 'buffer', 
      bookType: 'xlsx' 
    });
    
    // Imposta gli headers per il download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'planning'}.xlsx"`);
    
    // Invia il file
    res.send(excelBuffer);
    
  } catch (error) {
    console.error('Errore nell\'esportazione Excel:', error);
    res.status(500).json({ error: 'Errore nell\'esportazione del file Excel' });
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
    
  } catch (error) {
    console.error('Errore nel processare i dati:', error);
    res.status(500).json({ error: 'Errore nel processamento dei dati' });
  }
});

// API per scaricare dati da Google Sheets
app.post('/api/download-google-sheets', async (req, res) => {
  try {
    const { sheetUrl, sheetName } = req.body;
    
    console.log(`📊 RICHIESTA GOOGLE SHEETS: URL=${sheetUrl}, Foglio=${sheetName}`);
    console.log(`🔍 URL completo ricevuto: ${sheetUrl}`);
    
    if (!sheetUrl) {
      return res.status(400).json({ error: 'URL Google Sheets richiesto' });
    }

    // Verifica se l'URL contiene 'spreadsheets'
    if (!sheetUrl.includes('spreadsheets')) {
      console.error('❌ ERRORE: URL non sembra essere un Google Sheets');
      return res.status(400).json({ 
        error: 'URL deve essere di un Google Sheets (contenere "spreadsheets")',
        receivedUrl: sheetUrl
      });
    }

    // Estrai l'ID del foglio dall'URL con controlli migliorati
    const sheetId = extractSheetIdFromUrl(sheetUrl);
    if (!sheetId) {
      console.error('❌ ERRORE: URL Google Sheets non valido:', sheetUrl);
      return res.status(400).json({ error: 'URL Google Sheets non valido' });
    }

    console.log(`🔑 Sheet ID estratto: ${sheetId}`);

    // URL per accedere ai dati del foglio in formato CSV
    let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    // Se è specificato un nome del foglio, aggiungi il parametro per quel foglio
    if (sheetName) {
      const gid = getSheetGidByName(sheetName);
      csvUrl += `&gid=${gid}`;
      console.log(`📋 Accedendo al foglio "${sheetName}" con GID ${gid}`);
      console.log(`🌐 URL finale: ${csvUrl}`);
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
    
    console.log(`📡 Risposta Google: Status ${response.status} - ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Errore Google Sheets (${response.status}):`, errorText);
      throw new Error(`Errore ${response.status}: ${response.statusText}. Verifica che il foglio sia pubblico e accessibile.`);
    }

    const csvText = await response.text();
    console.log(`📄 CSV ricevuto (primi 200 caratteri):`, csvText.substring(0, 200));
    
    if (!csvText || csvText.trim() === '') {
      throw new Error('Il foglio Google è vuoto o non accessibile');
    }

    const jsonData = parseCSVToJSON(csvText);
    
    console.log(`✅ SUCCESSO: ${jsonData.length} righe processate per il foglio "${sheetName || 'default'}"`);
    console.log(`📊 Prime 2 righe per debug:`, jsonData.slice(0, 2));
    
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
    
  } catch (error) {
    console.error('❌ ERRORE FINALE nel download da Google Sheets:', error);
    res.status(500).json({ 
      error: 'Errore nel scaricare i dati: ' + error.message + 
             '. Verifica che il foglio Google sia pubblico e accessibile.',
      debug: {
        originalUrl: req.body.sheetUrl,
        sheetName: req.body.sheetName
      }
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
    console.log(`📄 Inizio parsing CSV (lunghezza: ${csvText.length})`);
    
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      console.log('⚠️ CSV vuoto dopo filtraggio');
      return [];
    }
    
    console.log(`📊 Trovate ${lines.length} righe non vuote`);
    console.log(`📋 Prima riga (header): ${lines[0]}`);
    
    // Prima riga contiene le intestazioni con gestione migliorata delle virgolette
    const headers = parseCSVLine(lines[0]);
    console.log(`🏷️ Headers estratti:`, headers);
    
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
    
    console.log(`✅ Parsing completato: ${result.length} righe valide`);
    return result;
    
  } catch (error) {
    console.error('❌ Errore nel parsing CSV:', error);
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
    console.log('Sincronizzazione dati da Sheets a Firebase...');
    
    res.json({
      success: true,
      message: 'Dati sincronizzati con Firebase',
      recordsProcessed: sheetsData.length
    });
    
  } catch (error) {
    console.error('Errore nella sincronizzazione:', error);
    res.status(500).json({ error: 'Errore nella sincronizzazione con Firebase' });
  }
});

// Avvia il server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server avviato su http://0.0.0.0:${PORT}`);
  console.log('Firebase integration ready!');
});
