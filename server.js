
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

// Avvia il server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server avviato su http://0.0.0.0:${PORT}`);
});
