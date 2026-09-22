const ExcelJS = require('exceljs');

const MAX_EXPORT_ROWS = 5000;
const MAX_EXPORT_COLUMNS = 100;

function safeFilename(value) {
  const normalized = String(value || 'planning')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  return normalized || 'planning';
}

async function createPlanningWorkbook(data) {
  if (!Array.isArray(data) || data.length > MAX_EXPORT_ROWS) {
    const error = new Error('INVALID_EXPORT_DATA');
    error.code = 'INVALID_EXPORT_DATA';
    throw error;
  }
  const columns = [...new Set(data.flatMap((row) => (
    row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : []
  )))];
  if (columns.length > MAX_EXPORT_COLUMNS || data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    const error = new Error('INVALID_EXPORT_DATA');
    error.code = 'INVALID_EXPORT_DATA';
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Planning');
  worksheet.columns = columns.map((key) => ({ header: key, key }));
  for (const row of data) {
    worksheet.addRow(Object.fromEntries(columns.map((key) => [key, row[key] == null ? '' : String(row[key])])));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = {
  MAX_EXPORT_COLUMNS,
  MAX_EXPORT_ROWS,
  createPlanningWorkbook,
  safeFilename,
};