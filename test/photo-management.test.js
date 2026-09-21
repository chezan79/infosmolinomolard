const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const express = require('express');
const { createDirectoryRuntime } = require('../employee-directory');
const { normalizeStorageBucket } = require('../firebase-server-config');
const { normalizeDirectory } = require('../employee-directory/contract');
const {
  EmployeePhotoService, MAX_UPLOAD_BYTES, PORTRAIT_SIZE, PhotoError,
} = require('../employee-directory/photo-service');
const { EmployeeDirectoryService } = require('../employee-directory/service');
const { ElectionService } = require('../election-engine/service');
const { createSalaireVerifier } = require('../employee-directory/contract');
const { mountPublicFiles } = require('../public-files');
const {
  CLIENT_KEYS,
  mountFirebaseClientConfig,
} = require('../firebase-client-config-route');

const root = path.join(__dirname, '..');
const rows = [
  ['Employee ID', 'Salaire-ID', 'Name', 'Department', 'Active', 'Can Vote', 'Can Be Elected', 'Job Title', 'Photo URL', 'Site ID'],
  ['emp-1', 'SAL-1001', 'Anna Rossi', 'Cuisine', 'yes', 'yes', 'yes', 'Cheffe', 'https://images.example.test/anna.jpg', 'molard'],
  ['emp-2', 'SAL-1002', 'Luca Bianchi', 'Service', 'no', 'no', 'no', '', '', 'molard'],
];
const options = { siteId: 'molard', pepper: 'photo-tests', allowedPhotoOrigins: ['https://images.example.test'] };

class MemoryPhotoStore {
  constructor() { this.records = new Map(); this.bytes = new Map(); }
  async list() { return new Map(this.records); }
  async save(employeeId, bytes, metadata) {
    const record = { schemaVersion: 1, objectPath: `employee-photos/molard/${employeeId}/portrait.webp`, ...metadata };
    this.records.set(employeeId, record); this.bytes.set(employeeId, bytes); return record;
  }
  async read(record) { return this.bytes.get(record.objectPath.split('/')[2]); }
  async remove(employeeId, record, deletedAt) {
    this.bytes.delete(employeeId);
    const tombstone = { schemaVersion: 1, version: record.version, deletedAt };
    this.records.set(employeeId, tombstone);
    return tombstone;
  }
}

function fixture() {
  const normalized = normalizeDirectory(rows, options);
  const directoryService = new EmployeeDirectoryService({ source: null, store: null, ...options });
  directoryService.snapshot = {
    schemaVersion: 1, siteId: 'molard', sourceGeneration: 1,
    refreshedAt: '2026-09-01T00:00:00.000Z',
    employees: normalized.employees, verifierRecords: normalized.verifierRecords, warnings: normalized.warnings,
  };
  const store = new MemoryPhotoStore();
  const photos = new EmployeePhotoService({
    directoryService,
    store,
    photoUrlSecret: 'photo-url-test-secret-at-least-thirty-two-bytes',
    now: () => new Date('2026-09-21T10:00:00.000Z'),
  });
  directoryService.resolvePhotoUrl = (employeeId, fallback) => photos.resolvePhotoUrl(employeeId, fallback);
  return { photos, store, directoryService };
}

test('processing normalizes orientation, dimensions, format and metadata', async () => {
  const { photos } = fixture();
  const source = await sharp({
    create: { width: 900, height: 600, channels: 3, background: '#d25b42' },
  }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'private metadata' } } }).toBuffer();
  const output = await photos.process(source, 'image/jpeg');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, PORTRAIT_SIZE);
  assert.equal(metadata.height, PORTRAIT_SIZE);
  assert.equal(metadata.exif, undefined);
  assert.equal(output.includes(Buffer.from('private metadata')), false);
});

test('validation rejects oversized, malformed, unsupported and spoofed images', async () => {
  const { photos } = fixture();
  await assert.rejects(photos.process(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/jpeg'), (e) => e.code === 'IMAGE_TOO_LARGE');
  await assert.rejects(photos.process(Buffer.from('not an image'), 'image/jpeg'), (e) => e.code === 'MALFORMED_IMAGE');
  await assert.rejects(photos.process(Buffer.from('heic'), 'image/heic'), (e) => e.code === 'HEIC_NOT_SUPPORTED');
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
  await assert.rejects(photos.process(png, 'image/jpeg'), (e) => e.code === 'MIME_MISMATCH');
});

test('upload, replacement and deletion preserve legacy precedence and eligibility', async () => {
  const { photos, store, directoryService } = fixture();
  const jpeg = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const before = directoryService.snapshot.employees.map(({ active, canVote, canBeElected }) => ({ active, canVote, canBeElected }));
  const first = await photos.upload('emp-1', jpeg, 'image/jpeg');
  const second = await photos.upload('emp-1', jpeg, 'image/jpeg');
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.notEqual(first.photoUrl, second.photoUrl);
  assert.match(second.photoUrl, /^\/api\/v1\/employee-photos\/emp-1\?v=2&expires=\d+&signature=[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(directoryService.getElectionSnapshot().employees.map(({ active, canVote, canBeElected }) => ({ active, canVote, canBeElected })), before);
  assert.equal(directoryService.getElectionSnapshot().employees[0].photoUrl, 'https://images.example.test/anna.jpg');
  assert.equal(directoryService.resolvePhotoUrl('emp-1', '/legacy.jpg'), second.photoUrl);
  assert.equal(store.records.get('emp-1').displayName, undefined);
  assert.equal(store.records.get('emp-1').siteId, undefined);
  const removed = await photos.remove('emp-1');
  assert.equal(removed.photoStatus, 'legacy');
  assert.equal(removed.photoUrl, 'https://images.example.test/anna.jpg');
  assert.equal(directoryService.resolvePhotoUrl('emp-1', '/legacy.jpg'), '/legacy.jpg');
  const third = await photos.upload('emp-1', jpeg, 'image/jpeg');
  assert.equal(third.version, 3);
  assert.match(third.photoUrl, /\?v=3&expires=\d+&signature=/);
});

test('existing election candidates return to legacy fallback after managed portrait deletion', async () => {
  const { photos, directoryService } = fixture();
  const jpeg = await sharp({ create: { width: 24, height: 24, channels: 3, background: 'navy' } }).jpeg().toBuffer();
  const managed = await photos.upload('emp-1', jpeg, 'image/jpeg');
  let election;
  const store = {
    async ensureElection(_window, snapshot) {
      if (!election) {
        const candidate = snapshot.employees.find((item) => item.employeeId === 'emp-1');
        election = {
          monthKey: '2026-09', timeZone: 'Europe/Zurich',
          opensAt: '2026-09-24T22:00:00.000Z', closesAt: '2026-09-30T22:00:00.000Z',
          eligibleVoterCount: 1,
          voters: { voter: { employeeId: 'voter', verifier: createSalaireVerifier('SAL-9999', options.pepper), verifierVersion: 1 } },
          candidates: { 'emp-1': { ...candidate } },
        };
      }
      return election;
    },
    async authorize() { return { employeeId: 'voter' }; },
  };
  const electionService = new ElectionService({
    store, directoryService, siteId: 'molard', timeZone: 'Europe/Zurich',
    pepper: options.pepper, grantSecret: 'a-secure-test-grant-secret-over-32-bytes',
    now: () => new Date('2026-09-25T12:00:00.000Z'),
  });
  const token = 'a-valid-test-authorization-token-over-32-bytes';
  assert.equal((await electionService.candidates(token)).candidates.CUISINE[0].photoUrl, managed.photoUrl);
  await photos.remove('emp-1');
  assert.equal(
    (await electionService.candidates(token)).candidates.CUISINE[0].photoUrl,
    'https://images.example.test/anna.jpg',
  );
});

test('directory membership and traversal-safe IDs are enforced, including inactive retention', async () => {
  const { photos } = fixture();
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'green' } }).jpeg().toBuffer();
  await assert.rejects(photos.upload('../emp-1', jpeg, 'image/jpeg'), (e) => e.code === 'INVALID_EMPLOYEE_ID');
  await assert.rejects(photos.upload('other', jpeg, 'image/jpeg'), (e) => e.code === 'EMPLOYEE_NOT_FOUND');
  const inactive = await photos.upload('emp-2', jpeg, 'image/jpeg');
  assert.equal(inactive.photoStatus, 'managed');
  assert.equal(photos.list().employees.find((e) => e.employeeId === 'emp-2').active, false);
});

test('management UI is localized, responsive and contains protected photo actions', () => {
  const html = fs.readFileSync(path.join(root, 'private-pages', 'gestion-photos-collaborateurs.html'), 'utf8');
  const administration = fs.readFileSync(path.join(root, 'private-pages', 'administration.html'), 'utf8');
  const administrationJs = fs.readFileSync(path.join(root, 'administration.js'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'gestion-photos-collaborateurs.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'gestion-photos-collaborateurs.css'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'gestion-photos-login.js'), 'utf8');
  const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const locale of ['fr:', 'it:', 'en:']) assert.ok(js.includes(locale));
  for (const action of ["method:'PUT'", "method:'DELETE'", 'getIdToken']) assert.ok(js.includes(action));
  assert.match(login, /signInWithEmailAndPassword/);
  assert.match(login, /configurationUnavailable/);
  assert.match(login, /if \(!state\.auth\)/);
  assert.doesNotMatch(login, /await signOut\(auth\)/);
  assert.match(html, /name="viewport"/);
  assert.match(js, /accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif"/);
  assert.match(js, /capture="environment"/);
  assert.match(css, /@media\(max-width:650px\)/);
  assert.match(login, /\/api\/v1\/management\/session/);
  assert.match(login, /location\.replace\('\/administration'\)/);
  assert.match(js, /gestion-photos-login\.html\?error=session/);
  assert.match(administration, /📷/);
  assert.match(administration, /Photos collaborateurs/);
  assert.match(administrationJs, /signOut/);
  assert.match(homepage, /🔐 Administration/);
  assert.doesNotMatch(homepage, /Andrea|Capriotti|firebase|uid|password/i);
});

test('Firebase web client configuration route survives the static allowlist and exposes only public keys', async (t) => {
  const env = {
    apiKey: 'public-api-key',
    authDomain: 'development.example.test',
    projectId: 'development-project',
    appId: 'public-app-id',
    messagingSenderId: 'public-sender',
    storageBucket: 'development-bucket',
    FIREBASE_SERVICE_ACCOUNT: 'must-not-leak',
    MOLARD_ADMIN_FIREBASE_UID: 'must-not-leak',
    EMPLOYEE_DIRECTORY_PEPPER: 'must-not-leak',
  };
  const app = express();
  mountPublicFiles(app, root);
  mountFirebaseClientConfig(app, env);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/public/firebase-client-config`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), [...CLIENT_KEYS].sort());
  assert.equal(body.projectId, env.projectId);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
});

test('rules deny direct browser access to photo metadata and objects', () => {
  const firestore = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
  assert.match(firestore, /employeePhotoSites\/\{document=\*\*\}/);
  assert.match(storage, /employee-photos\/\{siteId\}\/\{employeeId\}\/\{fileName\}/);
  assert.match(storage, /allow read, write: if false/);
});

test('administration APIs require the sole configured Molard UID and never expose private directory fields', async (t) => {
  const memory = new MemoryPhotoStore();
  const firebaseAuth = {
    async verifyIdToken(token) {
      if (token === 'authorized') return { uid: 'andrea-uid', siteId: 'molard', role: 'employee' };
      if (token === 'manager') return { uid: 'manager-1', siteId: 'molard', role: 'manager' };
      if (token === 'generic-admin') return { uid: 'admin-1', siteId: 'molard', role: 'admin' };
      if (token === 'wrong-site') return { uid: 'andrea-uid', siteId: 'other', role: 'admin' };
      if (token === 'voting-grant') throw new Error('Not a Firebase ID token');
      return { uid: 'voter-1', siteId: 'molard', role: 'employee' };
    },
    async verifySessionCookie(token) {
      const value = token.replace(/^session-/, '');
      return this.verifyIdToken(value);
    },
    async createSessionCookie(token) { return `session-${token}`; },
  };
  const runtime = createDirectoryRuntime({
    env: {
      EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
      MOLARD_ADMIN_FIREBASE_UID: 'andrea-uid',
      EMPLOYEE_PHOTO_URL_SECRET: 'photo-url-test-secret-at-least-thirty-two-bytes',
    },
    firebaseDb: null,
    firebaseAuth,
    photoStore: memory,
  });
  const normalized = normalizeDirectory(rows, options);
  runtime.service.snapshot = {
    schemaVersion: 1, siteId: 'molard', sourceGeneration: 1,
    refreshedAt: '2026-09-01T00:00:00.000Z',
    employees: normalized.employees, verifierRecords: normalized.verifierRecords, warnings: normalized.warnings,
  };
  await runtime.photos.initialize();
  const app = express();
  runtime.mount(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const token of [null, 'voter', 'manager', 'generic-admin', 'wrong-site', 'voting-grant', 'SAL-1001']) {
    const response = await fetch(`${base}/api/v1/management/employee-photos`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    assert.equal(response.status, token === null || token === 'voting-grant' ? 401 : 403);
  }
  const list = await fetch(`${base}/api/v1/management/employee-photos`, {
    headers: { Authorization: 'Bearer authorized' },
  });
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  for (const forbidden of ['SAL-1001', 'verifier', 'canVote', 'canBeElected', 'siteId']) {
    assert.equal(JSON.stringify(body).includes(forbidden), false);
  }

  const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: 'purple' } }).png().toBuffer();
  const uploaded = await fetch(`${base}/api/v1/management/employee-photos/emp-1`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer authorized', 'Content-Type': 'image/png' },
    body: image,
  });
  assert.equal(uploaded.status, 200);
  const uploadedBody = await uploaded.json();
  for (const forbidden of ['objectPath', 'schemaVersion', 'updatedAt', 'deletedAt', 'siteId']) {
    assert.equal(Object.hasOwn(uploadedBody, forbidden), false);
  }
  const candidate = runtime.service.getCandidates((employee) => runtime.photos.candidate(employee))[0];
  assert.match(candidate.photoUrl, /^\/api\/v1\/employee-photos\/emp-1\?v=1&expires=\d+&signature=/);
  assert.equal(Object.hasOwn(candidate, 'active'), false);
  const guessedPhoto = await fetch(`${base}/api/v1/employee-photos/emp-1?v=1`);
  assert.equal(guessedPhoto.status, 404);
  const tamperedPhoto = await fetch(`${base}${candidate.photoUrl.replace(/signature=[^&]+/, 'signature=invalid')}`);
  assert.equal(tamperedPhoto.status, 404);
  const signedPhoto = await fetch(`${base}${candidate.photoUrl}`);
  assert.equal(signedPhoto.status, 200);
  assert.equal(signedPhoto.headers.get('content-type'), 'image/webp');
  const removed = await fetch(`${base}/api/v1/management/employee-photos/emp-1`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer authorized' },
  });
  assert.equal(removed.status, 200);

  const administratorSession = await fetch(`${base}/api/v1/management/session`, {
    method: 'POST',
    headers: { Authorization: 'Bearer authorized' },
  });
  assert.equal(administratorSession.status, 204);
  assert.match(administratorSession.headers.get('set-cookie'), /__session=session-authorized/);
  for (const deniedToken of ['voter', 'manager', 'generic-admin', 'wrong-site']) {
    const deniedSession = await fetch(`${base}/api/v1/management/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deniedToken}` },
    });
    assert.equal(deniedSession.status, 403);
  }
});

test('private Administration pages redirect every identity except the configured Molard UID', async (t) => {
  const firebaseAuth = {
    async verifyIdToken() { throw new Error('not used'); },
    async verifySessionCookie(token) {
      const claims = {
        authorized: { uid: 'andrea-uid', siteId: 'molard', role: 'employee' },
        manager: { uid: 'm1', siteId: 'molard', role: 'manager' },
        admin: { uid: 'a1', siteId: 'molard', role: 'admin' },
        employee: { uid: 'e1', siteId: 'molard', role: 'employee' },
        'wrong-site': { uid: 'andrea-uid', siteId: 'other', role: 'admin' },
      };
      if (!claims[token]) throw new Error('invalid session, including voting grants');
      return claims[token];
    },
  };
  const runtime = createDirectoryRuntime({
    env: { EMPLOYEE_DIRECTORY_SITE_ID: 'molard', MOLARD_ADMIN_FIREBASE_UID: 'andrea-uid' },
    firebaseDb: null,
    firebaseAuth,
  });
  const app = express();
  for (const route of ['/administration', '/administration.html', '/gestion-photos-collaborateurs', '/gestion-photos-collaborateurs.html']) {
    app.get(route, runtime.authorizeAdministrationPage, (_req, res) => res.send('PRIVATE_ADMINISTRATION'));
  }
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/administration', '/administration.html', '/gestion-photos-collaborateurs', '/gestion-photos-collaborateurs.html']) {
    const anonymous = await fetch(`${base}${route}`, { redirect: 'manual' });
    assert.equal(anonymous.status, 302, 'knowing a private URL must not grant access');
    assert.equal(anonymous.headers.get('location'), '/gestion-photos-login.html');
  }
  for (const bypass of [
    '/%67estion-photos-collaborateurs.html',
    '/gestion-photos-collaborateurs%2ehtml',
    '//gestion-photos-collaborateurs.html',
    '/public/../gestion-photos-collaborateurs.html',
  ]) {
    const denied = await fetch(`${base}${bypass}`, { redirect: 'manual' });
    assert.notEqual(denied.status, 200);
    assert.equal((await denied.text()).includes('PRIVATE_ADMINISTRATION'), false);
  }
  for (const session of ['voting-grant', 'employee', 'manager', 'admin', 'wrong-site']) {
    const denied = await fetch(`${base}/gestion-photos-collaborateurs`, {
      headers: { Cookie: `__session=${session}` },
      redirect: 'manual',
    });
    assert.equal(denied.status, 302);
    assert.match(denied.headers.get('location'), /gestion-photos-login\.html\?error=(session|access)/);
    assert.equal((await denied.text()).includes('PRIVATE_ADMINISTRATION'), false);
  }
  for (const route of ['/administration', '/gestion-photos-collaborateurs']) {
    const allowed = await fetch(`${base}${route}`, { headers: { Cookie: '__session=authorized' } });
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'PRIVATE_ADMINISTRATION');
  }
});

test('administration fails closed when the sole UID configuration is absent', async (t) => {
  const runtime = createDirectoryRuntime({
    env: { EMPLOYEE_DIRECTORY_SITE_ID: 'molard' },
    firebaseDb: null,
    firebaseAuth: { async verifyIdToken() { return { uid: 'any', siteId: 'molard' }; } },
  });
  assert.equal(runtime.administrationConfigured, false);
  const app = express();
  runtime.mount(app);
  app.get('/administration', runtime.authorizeAdministrationPage);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/v1/management/session`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/administration`)).status, 503);
});

test('photo errors expose stable codes without image bytes', () => {
  const error = new PhotoError('MALFORMED_IMAGE');
  assert.equal(error.code, 'MALFORMED_IMAGE');
  assert.equal(JSON.stringify(error).includes('image bytes'), false);
});

test('Firebase Admin accepts common configured bucket reference forms safely', () => {
  assert.equal(normalizeStorageBucket('gs://example.firebasestorage.app'), 'example.firebasestorage.app');
  assert.equal(normalizeStorageBucket('https://storage.googleapis.com/example.appspot.com/path'), 'example.appspot.com');
  assert.equal(normalizeStorageBucket('https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/file'), 'example.appspot.com');
});