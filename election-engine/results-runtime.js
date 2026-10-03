const { OAuth2Client } = require('google-auth-library');
const { createAdministrationSessionAuthorization, requireSameOrigin } = require('../employee-directory/auth');
const { FirestoreResultsStore } = require('./results-store');
const { ElectionResultsService } = require('./results-service');
const { WinnerPhotos } = require('./results-photos');
const { ResultError } = require('./results-contract');
const { previewResultsBinding, PreviewResultsStatus } = require('./preview-results-status');

function resultsBinding(env, firebaseDb) {
  const binding = {
    projectId: env.ELECTION_RESULTS_PROJECT_ID || '',
    databaseId: env.ELECTION_RESULTS_DATABASE_ID || '',
    siteId: env.EMPLOYEE_DIRECTORY_SITE_ID || '',
    environment: env.ELECTION_DATA_ENVIRONMENT || '',
  };
  let actualProject = '';
  let actualDatabase = '';
  try {
    actualProject = firebaseDb?.projectId || '';
    actualDatabase = firebaseDb?.databaseId || '';
  } catch { /* Fail closed before the Admin client has a verified project identity. */ }
  const verified = Boolean(firebaseDb && binding.projectId && binding.projectId === actualProject &&
    binding.databaseId === '(default)' && binding.databaseId === actualDatabase &&
    binding.siteId === 'molard' && env.ELECTION_TIME_ZONE === 'Europe/Zurich' &&
    ['development', 'production'].includes(binding.environment) &&
    (env.NODE_ENV !== 'production' || binding.environment === 'production') &&
    (binding.environment !== 'production' || env.NODE_ENV === 'production') &&
    !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST);
  return { binding, verified };
}

function createWorkerAuthorization({ audience, subject, email, verifier = new OAuth2Client() }) {
  return async (req, res, next) => {
    const value = req.get('authorization') || '';
    if (!value.startsWith('Bearer ') || value.length > 8192) {
      return res.status(401).json({ code: 'AUTH_REQUIRED' });
    }
    if (!audience || !subject || !email) return res.status(503).json({ code: 'AUTOMATION_DISABLED' });
    try {
      const url = new URL(audience);
      if (url.protocol !== 'https:' || url.username || url.password ||
          url.pathname !== '/api/v1/internal/election-results/run' || url.search || url.hash) throw new Error();
      const ticket = await verifier.verifyIdToken({ idToken: value.slice(7), audience });
      const identity = ticket.getPayload();
      if (!identity || !['accounts.google.com', 'https://accounts.google.com'].includes(identity.iss) ||
          identity.aud !== audience || identity.sub !== subject || identity.email !== email ||
          identity.email_verified !== true || !Number.isFinite(identity.exp) ||
          identity.exp * 1000 <= Date.now()) return res.status(403).json({ code: 'FORBIDDEN' });
      return next();
    } catch {
      return res.status(401).json({ code: 'INVALID_JOB_AUTH' });
    }
  };
}

function createResultsRuntime({ env, firebaseDb, firebaseAuth, firebaseBucket, directoryPhotos, now }) {
  const { binding, verified } = resultsBinding(env, firebaseDb);
  const preview = env.NODE_ENV !== 'production';
  const enabled = !preview && verified && env.ELECTION_RESULTS_ENABLED === 'true';
  const automationEnabled = enabled && env.NODE_ENV === 'production' &&
    env.ELECTION_RESULTS_AUTOMATION_ENABLED === 'true';
  const store = !preview && verified ? new FirestoreResultsStore(firebaseDb, binding) : null;
  const photos = store ? new WinnerPhotos({ bucket: firebaseBucket, directoryPhotos, binding, store }) : null;
  const service = new ElectionResultsService({
    store, binding, enabled, automationEnabled, photos, now,
    septemberRecoveryApproved: env.ELECTION_RESULTS_SEPTEMBER_RECOVERY_APPROVED === 'true',
  });
  const previewBinding = previewResultsBinding(env, firebaseDb);
  const statusService = preview ? new PreviewResultsStatus({
    db: previewBinding.verified ? firebaseDb : null, binding: previewBinding.binding, now,
  }) : service;
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const administratorUid = String(env.MOLARD_ADMIN_FIREBASE_UID || '').trim();
  const authorize = firebaseAuth && siteId && administratorUid
    ? createAdministrationSessionAuthorization({ firebaseAuth, siteId, administratorUid })
    : (_req, res) => res.status(503).json({ code: 'ADMINISTRATION_UNAVAILABLE' });
  const workerAuthorization = createWorkerAuthorization({
    audience: env.ELECTION_RESULTS_JOB_AUDIENCE,
    subject: env.ELECTION_RESULTS_JOB_SUBJECT,
    email: env.ELECTION_RESULTS_JOB_EMAIL,
  });
  function mount(app) { mountResultsApi(app, { service, statusService, authorize, workerAuthorization, photos }); }
  return { service, statusService, mount };
}

function mountResultsApi(app, { service, statusService = service, authorize, workerAuthorization, photos }) {
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const handle = (callback) => async (req, res) => {
    try { await callback(req, res); } catch (error) {
      const known = error instanceof ResultError;
      res.status(known ? error.status : 503)
        .json({ code: known ? error.code : 'RESULTS_UNAVAILABLE' });
    }
  };
  app.get('/api/v1/public/election-results/latest', noStore, handle(async (_req, res) => {
    const result = await service.latest();
    return result ? res.json(result) : res.status(404).json({ code: 'NO_PUBLISHED_RESULT' });
  }));
  app.get('/api/v1/public/winner-photos/:key', noStore, handle(async (req, res) => {
    service.assertEnabled();
    const bytes = photos ? await photos.read(req.params.key, service.now()) : null;
    if (!bytes) return res.status(404).end();
    return res.set('Content-Type', 'image/webp').set('X-Content-Type-Options', 'nosniff').send(bytes);
  }));
  app.get('/api/v1/management/election-results', noStore, authorize, handle(async (_req, res) =>
    res.json(await statusService.monitor())));
  app.post('/api/v1/management/election-results/:month/recover', noStore, authorize,
    requireSameOrigin, handle(async (req, res) =>
      res.json(await service.processMonth(req.params.month, { recovery: true }))));
  app.post('/api/v1/internal/election-results/run', noStore, workerAuthorization,
    handle(async (_req, res) => res.json(await service.run())));
}

module.exports = { createResultsRuntime, resultsBinding, createWorkerAuthorization, mountResultsApi };