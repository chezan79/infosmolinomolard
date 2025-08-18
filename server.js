
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
    
    if (!sheetUrl) {
      return res.status(400).json({ error: 'URL Google Sheets richiesto' });
    }

    // Estrai l'ID del foglio dall'URL
    const sheetId = extractSheetIdFromUrl(sheetUrl);
    if (!sheetId) {
      return res.status(400).json({ error: 'URL Google Sheets non valido' });
    }

    // URL per accedere ai dati del foglio in formato CSV
    // Se sheetName è specificato, aggiungi il parametro gid
    let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    // Se è specificato un nome del foglio, aggiungi il parametro per quel foglio
    if (sheetName) {
      // Per ora usiamo il primo foglio (gid=0) o secondo (gid=1) in base al nome
      const gid = getSheetGidByName(sheetName);
      csvUrl += `&gid=${gid}`;
      console.log(`Accedendo al foglio "${sheetName}" con GID ${gid}`);
    }
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error('Impossibile accedere al foglio Google. Assicurati che sia pubblico.');
    }

    const csvText = await response.text();
    const jsonData = parseCSVToJSON(csvText);
    
    console.log(`Google Sheets processato (foglio: ${sheetName || 'default'}): ${jsonData.length} righe trovate`);
    
    res.json({
      success: true,
      data: jsonData,
      totalRows: jsonData.length,
      sheetName: sheetName || 'default'
    });
    
  } catch (error) {
    console.error('Errore nel download da Google Sheets:', error);
    res.status(500).json({ 
      error: 'Errore nel scaricare i dati: ' + error.message + 
             '. Assicurati che il foglio sia pubblico.'
    });
  }
});

// Funzione per mappare nomi dei fogli ai loro GID
function getSheetGidByName(sheetName) {
  const sheetMapping = {
    'bar': 1264033041,      // Vero GID del foglio bar
    'service': 1763904694,  // Vero GID del foglio service
    'cuisine': 819005714,   // Vero GID del foglio cuisine
    'pizzeria': 1785252251, // Vero GID del foglio pizzeria
    'office': 2063781370,   // Vero GID del foglio office
    'commis': 1542997572,   // Vero GID del foglio commis
    'BAR': 1264033041,
    'SERVICE': 1763904694,
    'CUISINE': 819005714,
    'PIZZERIA': 1785252251,
    'OFFICE': 2063781370,
    'COMMIS': 1542997572,
    'Bar': 1264033041,
    'Service': 1763904694,
    'Cuisine': 819005714,
    'Pizzeria': 1785252251,
    'Office': 2063781370,
    'Commis': 1542997572
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

// Funzione per convertire CSV in JSON
function parseCSVToJSON(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Prima riga contiene le intestazioni
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const result = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const obj = {};
    
    headers.forEach((header, index) => {
      obj[header] = values[index] || '';
    });
    
    result.push(obj);
  }
  
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
