const {
  bearerToken,
  createAdministrationAuthorization,
  createAdministrationSessionAuthorization,
  createAdministrationPageAuthorization,
  requireSameOrigin,
} = require('./auth');
const { FirestoreDirectoryStore } = require('./firestore-store');
const { GoogleSheetsDirectorySource } = require('./google-sheets-source');
const { EmployeeDirectoryService } = require('./service');
const { FirestorePhotoStore } = require('./photo-store');
const { EmployeePhotoService, MAX_UPLOAD_BYTES, PhotoError } = require('./photo-service');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createDirectoryRuntime({ env, firebaseDb, firebaseAuth, firebaseBucket, logger = console, photoStore: suppliedPhotoStore = null }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const administratorUid = String(env.MOLARD_ADMIN_FIREBASE_UID || '').trim();
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
  const photoStore = suppliedPhotoStore || (firebaseDb && firebaseBucket && siteId
    ? new FirestorePhotoStore(firebaseDb, firebaseBucket, siteId)
    : null);
  const photos = new EmployeePhotoService({
    directoryService: service,
    store: photoStore,
    photoUrlSecret: env.EMPLOYEE_PHOTO_URL_SECRET || env.ELECTION_GRANT_SECRET || env.SESSION_SECRET || '',
  });
  service.resolvePhotoUrl = (employeeId, fallback) => photos.resolvePhotoUrl(employeeId, fallback);

  let interval = null;
  async function start() {
    await service.initialize({ refresh: Boolean(source) });
    await photos.initialize();
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
    app.get('/api/v1/public/organization', (_req, res) => {
      res.set('Cache-Control', 'no-store');
      const organization = service.getPublicOrganization();
      if (!organization) {
        return res.status(503).json({ error: 'DIRECTORY_UNAVAILABLE' });
      }
      return res.json(organization);
    });

    app.get('/api/v1/employee-photos/:employeeId', async (req, res) => {
      try {
        const bytes = await photos.read(req.params.employeeId, req.query);
        if (!bytes) return res.status(404).end();
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'private, max-age=600, immutable');
        res.set('X-Content-Type-Options', 'nosniff');
        return res.send(bytes);
      } catch {
        return res.status(404).end();
      }
    });

    if (!firebaseAuth || !siteId || !administratorUid) return;
    const authorizeAdministrator = createAdministrationAuthorization({
      firebaseAuth,
      siteId,
      administratorUid,
    });
    const authorizeAdministratorSession = createAdministrationSessionAuthorization({
      firebaseAuth,
      siteId,
      administratorUid,
    });
    app.post('/api/v1/management/session', authorizeAdministrator, async (req, res) => {
      try {
        const sessionCookie = await firebaseAuth.createSessionCookie(bearerToken(req), {
          expiresIn: 8 * 60 * 60 * 1000,
        });
        res.set('Cache-Control', 'no-store');
        res.cookie('__session', sessionCookie, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 8 * 60 * 60 * 1000,
          path: '/',
        });
        return res.status(204).end();
      } catch {
        return res.status(401).json({ error: 'INVALID_AUTH' });
      }
    });
    app.delete('/api/v1/management/session', requireSameOrigin, (_req, res) => {
      res.clearCookie('__session', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      res.set('Cache-Control', 'no-store');
      return res.status(204).end();
    });
    app.get('/api/v1/management/employee-directory/status', authorizeAdministratorSession, (_req, res) => {
      res.set('Cache-Control', 'no-store');
      return res.json(service.getStatus());
    });
    app.post('/api/v1/management/employee-directory/refresh', requireSameOrigin, authorizeAdministratorSession, async (_req, res) => {
      try {
        const status = await service.refresh();
        res.set('Cache-Control', 'no-store');
        return res.json(status);
      } catch (error) {
        const code = error.validationErrors ? 'DIRECTORY_INVALID' : 'DIRECTORY_SOURCE_UNAVAILABLE';
        return res.status(503).json({ error: code, status: service.getStatus() });
      }
    });
    app.get('/api/v1/management/employee-photos', authorizeAdministratorSession, (_req, res) => {
      res.set('Cache-Control', 'no-store');
      try { return res.json(photos.list()); } catch (error) {
        return res.status(error.status || 503).json({ error: error.code || 'PHOTO_SERVICE_UNAVAILABLE' });
      }
    });
    const imageBody = require('express').raw({ type: () => true, limit: MAX_UPLOAD_BYTES });
    app.put('/api/v1/management/employee-photos/:employeeId', requireSameOrigin, authorizeAdministratorSession, imageBody, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        return res.json(await photos.upload(req.params.employeeId, req.body, req.get('content-type') || ''));
      } catch (error) {
        const known = error instanceof PhotoError;
        return res.status(known ? error.status : 503).json({ error: known ? error.code : 'PHOTO_SERVICE_UNAVAILABLE' });
      }
    });
    app.delete('/api/v1/management/employee-photos/:employeeId', requireSameOrigin, authorizeAdministratorSession, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try { return res.json(await photos.remove(req.params.employeeId)); } catch (error) {
        const known = error instanceof PhotoError;
        return res.status(known ? error.status : 503).json({ error: known ? error.code : 'PHOTO_SERVICE_UNAVAILABLE' });
      }
    });
  }

  const authorizeAdministrationPage = firebaseAuth && siteId && administratorUid
    ? createAdministrationPageAuthorization({ firebaseAuth, siteId, administratorUid })
    : (_req, res) => res.status(503).send('Administration authentication unavailable');
  return {
    service,
    photos,
    start,
    stop,
    mount,
    authorizeAdministrationPage,
    administrationConfigured: Boolean(firebaseAuth && siteId && administratorUid),
  };
}

module.exports = { createDirectoryRuntime };