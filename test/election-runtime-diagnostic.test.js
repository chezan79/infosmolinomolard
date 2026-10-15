const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { request } = require('node:http');
const { inspectOfficialRuntime, EXPECTED } = require('../election-engine/runtime-diagnostic');
const { createResultsRuntime, resultsBinding } = require('../election-engine/results-runtime');
const { MemoryFirestore } = require('./helpers/results-fixture');

function environment(extra = {}) {
  return { NODE_ENV: 'production', ELECTION_DATA_ENVIRONMENT: 'production',
    EMPLOYEE_DIRECTORY_SITE_ID: 'molard', ELECTION_TIME_ZONE: 'Europe/Zurich',
    ELECTION_RESULTS_PROJECT_ID: 'infosmolinomoard', ELECTION_RESULTS_DATABASE_ID: '(default)',
    ELECTION_RESULTS_ENABLED: 'true', MOLARD_ADMIN_FIREBASE_UID: 'owner-fixture', ...extra };
}
function database() {
  const db = new MemoryFirestore();
  db.projectId = 'infosmolinomoard';
  return db;
}
const firebaseAuth = { async verifySessionCookie(cookie, revoked) {
  assert.equal(revoked, true);
  if (cookie === 'expired') throw new Error('PRIVATE_EXCEPTION');
  return { uid: cookie === 'owner' || cookie === 'wrong-site' ? 'owner-fixture' : 'not-owner',
    siteId: cookie === 'wrong-site' ? 'other' : 'molard', role: 'manager' };
} };
async function application(t, env = environment(), db = database(), auth = firebaseAuth) {
  const app = express();
  const runtime = createResultsRuntime({ env, firebaseDb: db, firebaseAuth: auth });
  runtime.mount(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { db, runtime, base: `http://127.0.0.1:${server.address().port}` };
}

test('official diagnostic attests SDK metadata and only allow-listed comparisons, without datastore access', () => {
  const db = database();
  db.collection = () => { throw new Error('DATASTORE_MUST_NOT_BE_ACCESSED'); };
  const report = inspectOfficialRuntime(environment({
    FIREBASE_SERVICE_ACCOUNT: 'PRIVATE_SERVICE_ACCOUNT', SESSION_SECRET: 'PRIVATE_SESSION',
  }), db);
  assert.equal(report.status, 'VERIFIED');
  assert.deepEqual(report.expected, EXPECTED);
  assert.equal(Object.values(report.checks).every((value) => value === 'MATCH'), true);
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  assert.equal(db.reads.length + db.writes.length, 0);
});

test('wrong and missing environment, SDK metadata, result bindings and every emulator fail closed', () => {
  for (const [key, value] of [
    ['NODE_ENV', 'development'], ['ELECTION_DATA_ENVIRONMENT', 'development'],
    ['EMPLOYEE_DIRECTORY_SITE_ID', 'other'], ['ELECTION_TIME_ZONE', 'UTC'],
    ['ELECTION_RESULTS_PROJECT_ID', 'other'], ['ELECTION_RESULTS_DATABASE_ID', 'other'],
    ['FIRESTORE_EMULATOR_HOST', 'PRIVATE_HOST'], ['FIREBASE_AUTH_EMULATOR_HOST', 'PRIVATE_HOST'],
    ['FIREBASE_STORAGE_EMULATOR_HOST', 'PRIVATE_HOST'],
  ]) {
    const env = environment({ [key]: value }), db = database();
    const report = inspectOfficialRuntime(env, db);
    assert.equal(report.status, 'BLOCKED', key);
    assert.equal(resultsBinding(env, db).verified, false, key);
    assert.equal(db.reads.length + db.writes.length, 0);
    assert.equal(JSON.stringify(report).includes('PRIVATE_HOST'), false);
  }
  for (const key of ['NODE_ENV', 'ELECTION_DATA_ENVIRONMENT', 'EMPLOYEE_DIRECTORY_SITE_ID',
    'ELECTION_TIME_ZONE', 'ELECTION_RESULTS_PROJECT_ID', 'ELECTION_RESULTS_DATABASE_ID']) {
    const env = environment();
    delete env[key];
    assert.equal(inspectOfficialRuntime(env, database()).status, 'BLOCKED', key);
    assert.equal(resultsBinding(env, database()).verified, false, key);
  }
  for (const key of ['projectId', 'databaseId']) {
    const db = database();
    db[key] = 'PRIVATE_UNEXPECTED_VALUE';
    const report = inspectOfficialRuntime(environment(), db);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(JSON.stringify(report).includes('PRIVATE_UNEXPECTED_VALUE'), false);
    assert.equal(resultsBinding(environment(), db).verified, false);
    delete db[key];
    assert.equal(inspectOfficialRuntime(environment(), db).status, 'BLOCKED');
  }
  assert.equal(inspectOfficialRuntime(environment(), null).checks.firebaseAdminProjectId, 'UNAVAILABLE');
  const inaccessible = { get projectId() { throw new Error('PRIVATE_SDK_ERROR'); } };
  assert.equal(JSON.stringify(inspectOfficialRuntime(environment(), inaccessible)).includes('PRIVATE_SDK_ERROR'), false);
});

test('exact owner authentication is required before diagnostic metadata inspection; report is private and read-only', async (t) => {
  const db = database();
  let inspected = 0;
  Object.defineProperty(db, 'projectId', { get() { inspected++; return 'infosmolinomoard'; } });
  const f = await application(t, environment(), db);
  inspected = 0;
  for (const cookie of ['', 'employee', 'manager', 'expired', 'wrong-site']) {
    const r = await fetch(f.base + '/api/v1/management/election-runtime-diagnostic', {
      headers: cookie ? { cookie: `__session=${cookie}` } : {},
    });
    assert.equal(r.status, !cookie || cookie === 'expired' ? 401 : 403);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(inspected, 0);
  const r = await fetch(f.base + '/api/v1/management/election-runtime-diagnostic', {
    headers: { cookie: '__session=owner' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).status, 'VERIFIED');
  assert.ok(inspected > 0);
  assert.equal((await fetch(f.base + '/api/v1/public/election-runtime-diagnostic')).status, 404);
  assert.equal((await fetch(f.base + '/api/v1/management/election-runtime-diagnostic', {
    method: 'POST', headers: { cookie: '__session=owner' },
  })).status, 404);
  assert.equal(db.reads.length + db.writes.length, 0);
});

test('missing administrator, Auth or Firebase configuration never grants diagnostic access or reads elections', async (t) => {
  for (const variant of ['admin', 'auth', 'db']) {
    const env = environment();
    if (variant === 'admin') delete env.MOLARD_ADMIN_FIREBASE_UID;
    const db = variant === 'db' ? null : database();
    const f = await application(t, env, db, variant === 'auth' ? null : firebaseAuth);
    const r = await fetch(f.base + '/api/v1/management/election-runtime-diagnostic', {
      headers: { cookie: '__session=owner' },
    });
    assert.equal(r.status, variant === 'db' ? 200 : 503);
    if (variant === 'db') assert.equal((await r.json()).status, 'BLOCKED');
    if (db) assert.equal(db.reads.length + db.writes.length, 0);
  }
});

test('production mismatch blocks public/admin results and history with no development fallback or data reads', async (t) => {
  for (const extra of [
    { ELECTION_RESULTS_PROJECT_ID: '' }, { ELECTION_RESULTS_DATABASE_ID: '' },
    { NODE_ENV: 'development' }, { ELECTION_DATA_ENVIRONMENT: 'development' },
    { FIREBASE_STORAGE_EMULATOR_HOST: 'PRIVATE_HOST' },
    { NODE_ENV: 'development', ELECTION_DATA_ENVIRONMENT: 'development', RAILWAY_SERVICE_ID: 'railway-fixture' },
  ]) {
    const f = await application(t, environment(extra));
    for (const route of ['/api/v1/public/election-results/latest', '/api/v1/public/winner-photos/fixture',
      '/api/v1/management/election-results', '/api/v1/management/election-history?month=2026-09']) {
      const r = await fetch(f.base + route, { headers: { cookie: '__session=owner' } });
      assert.equal(r.status, 503, `${JSON.stringify(extra)} ${route}`);
      assert.equal((await r.json()).code, 'RESULTS_BINDING_UNVERIFIED');
    }
    const recovery = await fetch(f.base + '/api/v1/management/election-results/2026-09/recover', {
      method: 'POST', headers: { cookie: '__session=owner', origin: f.base },
    });
    assert.equal(recovery.status, 503);
    assert.equal(f.db.reads.length + f.db.writes.length, 0);
  }
});

test('official hostname cannot select development data even with both environment flags misconfigured', async (t) => {
  const f = await application(t, environment({ NODE_ENV: 'development', ELECTION_DATA_ENVIRONMENT: 'development' }));
  for (const path of ['/api/v1/management/election-results', '/api/v1/management/election-history?month=2026-09']) {
    // Node's built-in fetch replaces Host; use HTTP directly to exercise the real header.
    const response = await new Promise((resolve, reject) => {
      request(f.base + path, { headers: {
        host: 'infosmolinomolard-production.up.railway.app', cookie: '__session=owner',
      } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject).end();
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'RESULTS_BINDING_UNVERIFIED');
  }
  assert.equal(f.db.reads.length + f.db.writes.length, 0);
});

test('guard rechecks the actual client on each request, including when it changes after initialization', async (t) => {
  const f = await application(t);
  f.db.projectId = 'different-project';
  const r = await fetch(f.base + '/api/v1/management/election-results', { headers: { cookie: '__session=owner' } });
  assert.equal(r.status, 503);
  assert.equal(f.db.reads.length + f.db.writes.length, 0);
  assert.equal(f.runtime.diagnose().status, 'BLOCKED');
});

test('explicit development is never attested as the official production runtime', async (t) => {
  const f = await application(t, environment({ NODE_ENV: 'development', ELECTION_DATA_ENVIRONMENT: 'development' }));
  const r = await fetch(f.base + '/api/v1/management/election-runtime-diagnostic', {
    headers: { cookie: '__session=owner' },
  });
  assert.equal((await r.json()).status, 'BLOCKED');
  assert.equal(f.db.reads.length + f.db.writes.length, 0);
});
