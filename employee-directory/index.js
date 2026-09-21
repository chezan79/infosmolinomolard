const { createManagerAuthorization } = require('./auth');
const { FirestoreDirectoryStore } = require('./firestore-store');
const { GoogleSheetsDirectorySource } = require('./google-sheets-source');
const { EmployeeDirectoryService } = require('./service');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createDirectoryRuntime({ env, firebaseDb, firebaseAuth, logger = console }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const spreadsheetId = env.EMPLOYEE_DIRECTORY_SHEET_ID || '';
  const range = env.EMPLOYEE_DIRECTORY_SHEET_RANGE || 'Employees!A:J';
  const pepper = env.EMPLOYEE_DIRECTORY_PEPPER || '';
  const allowedPhotoOrigins = (env.EMPLOYEE_DIRECTORY_PHOTO_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const refreshMs = parsePositiveInteger(env.EMPLOYEE_DIRECTORY_REFRESH_MS, 15 * 60 * 1000);

  const store = firebaseDb && siteId ? new FirestoreDirectoryStore(firebaseDb, siteId) : null;
  let source = null;
  if (store && siteId && spreadsheetId && pepper && env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    source = new GoogleSheetsDirectorySource({
      serviceAccount,
      spreadsheetId,
      range,
      timeoutMs: parsePositiveInteger(env.EMPLOYEE_DIRECTORY_TIMEOUT_MS, 10000),
    });
  }
  const service = new EmployeeDirectoryService({
    source,
    store,
    siteId,
    pepper,
    allowedPhotoOrigins,
  });

  let interval = null;
  async function start() {
    await service.initialize({ refresh: Boolean(source) });
    if (source) {
      interval = setInterval(() => {
        service.refresh().catch(() => logger.warn('Employee directory refresh failed; last-known-good snapshot retained'));
      }, refreshMs);
      interval.unref();
    }
  }

  function stop() {
    if (interval) clearInterval(interval);
  }

  function mount(app) {
    app.get('/api/v1/employee-directory/candidates', (_req, res) => {
      if (!service.snapshot) return res.status(503).json({ error: 'DIRECTORY_UNAVAILABLE' });
      res.set('Cache-Control', 'private, max-age=60');
      return res.json({ candidates: service.getCandidates() });
    });

    if (!firebaseAuth || !siteId) return;
    const authorizeManager = createManagerAuthorization({ firebaseAuth, siteId });
    app.get('/api/v1/management/employee-directory/status', authorizeManager, (_req, res) => {
      res.set('Cache-Control', 'no-store');
      return res.json(service.getStatus());
    });
    app.post('/api/v1/management/employee-directory/refresh', authorizeManager, async (_req, res) => {
      try {
        const status = await service.refresh();
        res.set('Cache-Control', 'no-store');
        return res.json(status);
      } catch (error) {
        const code = error.validationErrors ? 'DIRECTORY_INVALID' : 'DIRECTORY_SOURCE_UNAVAILABLE';
        return res.status(503).json({ error: code, status: service.getStatus() });
      }
    });
  }

  return { service, start, stop, mount };
}

module.exports = { createDirectoryRuntime };