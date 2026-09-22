const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { cert, deleteApp, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const {
  MAX_EXPORT_COLUMNS,
  MAX_EXPORT_ROWS,
  createPlanningWorkbook,
  safeFilename,
} = require('../planning-export');

const root = path.join(__dirname, '..');

test('planning export remains an XLSX download without the vulnerable SheetJS package', async () => {
  const bytes = await createPlanningWorkbook([
    { Name: 'Example', Shift: '09:00-17:00', Note: '=1+1' },
  ]);
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.getWorksheet('Planning');
  assert.equal(worksheet.getRow(1).values[1], 'Name');
  assert.equal(worksheet.getRow(2).getCell(3).value, '=1+1');
  assert.equal(worksheet.getRow(2).getCell(3).type, ExcelJS.ValueType.String);
});

test('planning export bounds data and sanitizes response filenames', async () => {
  assert.equal(safeFilename('../../planning\\r\\nInjected: yes'), 'planning-r-nInjected-yes');
  assert.equal(safeFilename(''), 'planning');
  await assert.rejects(
    createPlanningWorkbook(Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ({}))),
    /INVALID_EXPORT_DATA/,
  );
  await assert.rejects(
    createPlanningWorkbook([Object.fromEntries(Array.from({ length: MAX_EXPORT_COLUMNS + 1 }, (_, i) => [`c${i}`, i]))]),
    /INVALID_EXPORT_DATA/,
  );
});

test('security-sensitive browser libraries use fixed releases and vulnerable npm packages are absent', () => {
  const manifest = require('../package.json');
  for (const name of ['xlsx', 'jspdf', 'jspdf-autotable']) {
    assert.equal(Object.hasOwn(manifest.dependencies, name), false);
  }
  const html = fs.readdirSync(root)
    .filter((name) => name.endsWith('.html'))
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(html, /xlsx\/0\.18\.5|jspdf\/2\.5\.1/);
  assert.match(html, /xlsx-0\.20\.3/);
  assert.match(html, /jspdf\/4\.2\.1/);
});

test('server logs only bounded operational fields for employee and Sheets workflows', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const logLines = source.split('\n').filter((line) => /console\.(?:log|warn|error)/.test(line));
  for (const privateIdentifier of [
    'enrollmentData',
    'enrollmentId',
    'userId',
    'sheetUrl',
    'sheetId',
  ]) {
    assert.equal(
      logLines.some((line) => line.includes(privateIdentifier)),
      false,
      `logs must not include ${privateIdentifier}`,
    );
  }
  assert.equal(logLines.some((line) => /csvText\.(?:slice|substring)|jsonData\.(?:slice|at)/.test(line)), false);
});

test('Firebase Admin signs an Administration-scoped custom token with the installed auth dependencies', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const app = initializeApp({
    credential: cert({
      projectId: 'security-smoke-project',
      clientEmail: 'security-smoke@example.test',
      privateKey,
    }),
  }, `security-smoke-${process.pid}`);
  try {
    const token = await getAuth(app).createCustomToken('security-smoke-user', { siteId: 'molard' });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    assert.equal(header.alg, 'RS256');
    assert.equal(payload.uid, 'security-smoke-user');
    assert.equal(payload.claims.siteId, 'molard');
    assert.equal(
      crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
      ),
      true,
    );
  } finally {
    await deleteApp(app);
  }
});