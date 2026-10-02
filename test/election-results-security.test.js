const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture, MemoryFirestore } = require('./helpers/results-fixture');
const { mountResultsApi, createWorkerAuthorization, resultsBinding } = require('../election-engine/results-runtime');
const { createAdministrationSessionAuthorization } = require('../employee-directory/auth');
const { publicRootFile } = require('../public-files');
const { WinnerPhotos } = require('../election-engine/results-photos');

async function serverFor(t, f, identity = {}) {
  const app = express();
  app.use(express.json());
  const audience = 'https://fixture.invalid/api/v1/internal/election-results/run';
  const workerAuthorization = createWorkerAuthorization({
    audience, subject: 'fixture-service-account', email: 'fixture@fixture.iam.gserviceaccount.com',
    verifier: { async verifyIdToken({ idToken, audience: expected }) {
      if (idToken === 'invalid') throw new Error('bad signature');
      assert.equal(expected, audience);
      return { getPayload: () => ({
        iss: 'https://accounts.google.com', aud: audience, sub: 'fixture-service-account',
        email: 'fixture@fixture.iam.gserviceaccount.com', email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300, ...identity,
      }) };
    } },
  });
  const authorize = createAdministrationSessionAuthorization({
    siteId: 'molard', administratorUid: 'fixture-admin',
    firebaseAuth: { async verifySessionCookie(value, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (value === 'bad') throw new Error('revoked');
      return { uid: value === 'admin' ? 'fixture-admin' : 'other', siteId: value === 'wrong-site' ? 'other-site' : 'molard' };
    } },
  });
  mountResultsApi(app, { service: f.service, authorize, workerAuthorization });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('anonymous public API responses are no-store, explicitly allow-listed, and zero-write', async (t) => {
  const f = fixture();
  const base = await serverFor(t, f);
  assert.equal((await fetch(`${base}/api/v1/public/election-results/latest`)).status, 404);
  assert.equal(f.db.writes.length, 0);
  await f.service.processMonth(f.month);
  const writes = f.db.writes.length;
  const response = await fetch(`${base}/api/v1/public/election-results/latest`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ['categories', 'code', 'month', 'publishedAt']);
  assert.deepEqual(Object.keys(payload.categories.CUISINE.winners[0]).sort(), ['name', 'photoUrl', 'role']);
  assert.equal(f.db.writes.length, writes);
  const reads = f.db.reads.length;
  await fetch(`${base}/api/v1/public/election-results/latest`);
  assert.equal(f.db.reads.slice(reads).some((read) => /ballots|participation/.test(read[1])), false);
});

test('recovery requires the exact authorized server session and a same-origin POST', async (t) => {
  const f = fixture();
  const base = await serverFor(t, f);
  const url = `${base}/api/v1/management/election-results/${f.month}/recover`;
  for (const headers of [{}, { cookie: '__session=other' }, { cookie: '__session=wrong-site' },
    { cookie: '__session=bad' }, { cookie: '__session=admin' },
    { cookie: '__session=admin', origin: 'https://attacker.invalid' }]) {
    const response = await fetch(url, { method: 'POST', headers });
    assert.ok([401, 403].includes(response.status));
    assert.equal(f.db.writes.length, 0);
  }
  const response = await fetch(url, { method: 'POST', headers: { cookie: '__session=admin', origin: base } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'PUBLISHED');
});

test('manual recovery respects September hold and pipeline integrity checks', async (t) => {
  const f = fixture();
  const base = await serverFor(t, f);
  const response = await fetch(`${base}/api/v1/management/election-results/2026-09/recover`, {
    method: 'POST', headers: { cookie: '__session=admin', origin: base },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SEPTEMBER_RECOVERY_HOLD');
  assert.equal(f.db.writes.length, 0);
  f.db.docs.delete(`${f.path}/participation/fixture-0`);
  const invalid = await fetch(`${base}/api/v1/management/election-results/${f.month}/recover`, {
    method: 'POST', headers: { cookie: '__session=admin', origin: base },
  });
  assert.equal(invalid.status, 409);
  assert.equal(await f.service.latest(), null);
});

test('scheduled job rejects missing, invalid, wrong-audience, wrong-account, unverified and expired OIDC tokens', async (t) => {
  const checks = [
    [{}, ''], [{}, 'invalid'], [{ aud: 'wrong-audience' }, 'token'],
    [{ sub: 'other-service-account' }, 'token'], [{ email: 'other@example.invalid' }, 'token'],
    [{ email_verified: false }, 'token'], [{ exp: 1 }, 'token'], [{ iss: 'attacker.invalid' }, 'token'],
  ];
  for (const [identity, token] of checks) {
    const f = fixture();
    const base = await serverFor(t, f, identity);
    const response = await fetch(`${base}/api/v1/internal/election-results/run`, {
      method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    assert.ok([401, 403].includes(response.status));
    assert.equal(f.db.writes.length, 0);
  }
});

test('only an authenticated, explicitly enabled worker runs; user visits never invoke it', async (t) => {
  const f = fixture({ automationEnabled: false });
  const base = await serverFor(t, f);
  const response = await fetch(`${base}/api/v1/internal/election-results/run`, {
    method: 'POST', headers: { authorization: 'Bearer fixture-token' },
  });
  assert.equal(response.status, 503);
  assert.equal(f.db.writes.length, 0);
  f.service.automationEnabled = true;
  const success = await fetch(`${base}/api/v1/internal/election-results/run`, {
    method: 'POST', headers: { authorization: 'Bearer fixture-token' },
  });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).processed, 1);
});

test('binding pins actual project/database/site/environment and rejects emulator or preview-production mixing', () => {
  const db = new MemoryFirestore();
  const env = {
    ELECTION_RESULTS_PROJECT_ID: 'fixture-project', ELECTION_RESULTS_DATABASE_ID: '(default)',
    EMPLOYEE_DIRECTORY_SITE_ID: 'molard', ELECTION_DATA_ENVIRONMENT: 'development', ELECTION_TIME_ZONE: 'Europe/Zurich',
  };
  assert.equal(resultsBinding(env, db).verified, true);
  for (const extra of [
    { ELECTION_RESULTS_PROJECT_ID: 'other' }, { ELECTION_RESULTS_DATABASE_ID: 'other' },
    { EMPLOYEE_DIRECTORY_SITE_ID: 'other' }, { ELECTION_DATA_ENVIRONMENT: 'production' },
    { NODE_ENV: 'production' }, { ELECTION_TIME_ZONE: 'UTC' }, { FIRESTORE_EMULATOR_HOST: 'fixture' },
  ]) assert.equal(resultsBinding({ ...env, ...extra }, db).verified, false);
  assert.equal(resultsBinding({ ...env, NODE_ENV: 'production', ELECTION_DATA_ENVIRONMENT: 'production' }, db).verified, true);
  assert.equal(resultsBinding({}, db).verified, false);
});

test('private HTML cannot leak through the public static-file allow-list', () => {
  for (const path of ['/election-results.html', '/private-pages/election-results.html',
    '/%2e%2e/private-pages/election-results.html', '/private-pages/../election-results.html']) {
    assert.equal(publicRootFile(path), null);
  }
  assert.equal(publicRootFile('/collaborateurs-du-mois.js'), 'collaborateurs-du-mois.js');
  assert.equal(publicRootFile('/election-engine/results-runtime.js'), null);
});

test('managed photos become immutable public copies with opaque URLs; external or missing photos stay absent', async () => {
  const f = fixture();
  const files = new Map([['employee-photos/molard/chef-one/portrait.webp', Buffer.from('fixture portrait')]]);
  const bucket = { file: (path) => ({
    path, copy: async (destination) => { files.set(destination.path, Buffer.from(files.get(path))); },
    download: async () => { if (!files.has(path)) throw new Error('missing'); return [files.get(path)]; },
  }) };
  const directoryPhotos = { records: new Map([
    ['chef-one', { objectPath: 'employee-photos/molard/chef-one/portrait.webp' }],
    ['chef-two', { objectPath: 'https://attacker.invalid/portrait.webp' }],
  ]) };
  const photos = new WinnerPhotos({ bucket, directoryPhotos, binding: f.binding, store: f.store });
  f.service.photos = photos;
  await f.service.processMonth(f.month);
  const dto = await f.service.latest();
  const url = dto.categories.CUISINE.winners[0].photoUrl;
  assert.match(url, /^\/api\/v1\/public\/winner-photos\/2026-10\.[a-f0-9-]{36}$/);
  assert.equal(url.includes('chef-one'), false);
  assert.equal(dto.categories.CUISINE.winners[1].photoUrl, null);
  files.delete('employee-photos/molard/chef-one/portrait.webp');
  assert.equal((await photos.read(url.split('/').pop(), f.now())).toString(), 'fixture portrait');
  assert.equal(await photos.read('2026-10.00000000-0000-0000-0000-000000000000', f.now()), null);
});