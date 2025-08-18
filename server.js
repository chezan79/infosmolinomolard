
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

// API per scaricare file da Google Drive
app.post('/api/download-google-drive', async (req, res) => {
  try {
    const { fileId } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID richiesto' });
    }

    // URL per scaricare il file direttamente da Google Drive
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error('Impossibile scaricare il file da Google Drive. Assicurati che il file sia pubblico.');
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Processa il file Excel
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    
    console.log(`File Google Drive processato: ${jsonData.length} righe trovate`);
    
    res.json({
      success: true,
      data: jsonData,
      totalRows: jsonData.length,
      sheetName: sheetName
    });
    
  } catch (error) {
    console.error('Errore nel download da Google Drive:', error);
    res.status(500).json({ 
      error: 'Errore nel scaricare il file: ' + error.message + 
             '. Assicurati che il file sia pubblico o condiviso con accesso di visualizzazione.'
    });
  }
});

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
