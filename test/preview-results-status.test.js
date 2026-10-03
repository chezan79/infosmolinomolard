const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { fixture, MemoryFirestore } = require('./helpers/results-fixture');
const { createResultsRuntime } = require('../election-engine/results-runtime');
const { previewResultsBinding, META_FIELDS, OPERATION_FIELDS, HEARTBEAT_FIELDS } = require('../election-engine/preview-results-status');
const { createAdministrationPageAuthorization } = require('../employee-directory/auth');
const { mountPublicFiles } = require('../public-files');
const { browserSession, waitFor } = require('./helpers/browser-session');

const env = {
  NODE_ENV: 'development', EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
  ELECTION_DATA_ENVIRONMENT: 'development', ELECTION_TIME_ZONE: 'Europe/Zurich',
  MOLARD_ADMIN_FIREBASE_UID: 'fixture-admin',
};
const firebaseAuth = { async verifySessionCookie(cookie, revoked) {
  assert.equal(revoked, true);
  if (cookie === 'revoked') throw new Error('revoked');
  return { uid: cookie === 'admin' ? 'fixture-admin' : 'other',
    siteId: cookie === 'wrong-site' ? 'other' : 'molard' };
} };
function previewFixture() {
  const f = fixture({ now: '2026-10-26T12:00:00Z' });
  f.db.projectId = 'infosmolinomoard';
  const september = fixture({ month: '2026-09' });
  f.db.seed(september.path, september.election);
  f.db.seed(`${september.path}/resultOperations/state`, {
    state: 'PUBLISHED', publishedAt: '2026-10-01T01:00:00Z', private: 'NEVER_EXPOSE',
  });
  f.db.seed('electionSites/molard/dataEnvironments/development/publicationState/worker', {
    status: 'OK', lastAttemptAt: '2026-10-01T01:00:00Z', private: 'NEVER_EXPOSE',
  });
  return f;
}
function runtime(f, extra = {}) {
  return createResultsRuntime({ env: { ...env, ...extra }, firebaseDb: f.db, firebaseAuth, now: f.now });
}
function assertSafeReads(f) {
  assert.equal(f.db.writes.length, 0);
  for (const [kind, document, fields] of f.db.reads) {
    assert.ok(document.startsWith('electionSites/molard/dataEnvironments/development/'));
    if (kind === 'query') {
      assert.equal(document, 'electionSites/molard/dataEnvironments/development/elections');
      assert.deepEqual(fields, META_FIELDS);
    } else {
      assert.equal(kind, 'projection');
      if (document.endsWith('/publicationState/worker')) assert.deepEqual(fields, HEARTBEAT_FIELDS);
      else {
        assert.match(document, /\/elections\/\d{4}-\d{2}\/resultOperations\/state$/);
        assert.deepEqual(fields, OPERATION_FIELDS);
      }
    }
  }
}
async function serve(t, f, extra = {}) {
  const app = express();
  const r = runtime(f, extra);
  r.mount(app);
  const root = path.join(__dirname, '..');
  const pageAuth = createAdministrationPageAuthorization({
    firebaseAuth, siteId: 'molard', administratorUid: 'fixture-admin',
  });
  app.get(['/resultats-du-vote', '/election-results.html'], pageAuth,
    (_req, res) => res.sendFile(path.join(root, 'private-pages/election-results.html')));
  for (const file of ['election-results-admin.js', 'election-results-admin.css']) {
    app.get(`/private-pages/${file}`, pageAuth, (_req, res) => res.sendFile(path.join(root, 'private-pages', file)));
  }
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, r };
}

test('Preview binding is fixed to the approved Admin project, default database and development site', async () => {
  const f = previewFixture();
  assert.equal(previewResultsBinding(env, f.db).verified, true);
  const invalid = [
    [{ NODE_ENV: 'production' }, f.db], [{ ELECTION_DATA_ENVIRONMENT: 'production' }, f.db],
    [{ ELECTION_DATA_ENVIRONMENT: '' }, f.db], [{ EMPLOYEE_DIRECTORY_SITE_ID: 'other' }, f.db],
    [{ ELECTION_TIME_ZONE: 'UTC' }, f.db], [{ FIRESTORE_EMULATOR_HOST: 'fixture' }, f.db],
    [{ FIREBASE_AUTH_EMULATOR_HOST: 'fixture' }, f.db], [{}, null],
    [{}, { projectId: 'other', databaseId: '(default)' }],
    [{}, { projectId: 'infosmolinomoard', databaseId: 'other' }],
    [{}, { get projectId() { throw new Error('unknown identity'); } }],
  ];
  for (const [extra, db] of invalid) {
    assert.equal(previewResultsBinding({ ...env, ...extra }, db).verified, false);
    const r = createResultsRuntime({ env: { ...env, ...extra }, firebaseDb: db });
    assert.equal((await r.statusService.monitor()).storageStatus, 'DISABLED');
  }
  assert.equal(f.db.reads.length, 0);
  assert.equal(f.db.writes.length, 0);
});

test('Preview enumerates existing months with field projections only, independent of processing settings', async () => {
  const f = previewFixture();
  const r = runtime(f);
  const status = await r.statusService.monitor();
  assert.deepEqual(status.months.map(({ month, state }) => [month, state]),
    [['2026-09', 'PUBLISHED'], ['2026-10', 'VOTING_OPEN']]);
  const electionsQuery = f.db.queries.find(({ path: queryPath }) =>
    queryPath === 'electionSites/molard/dataEnvironments/development/elections');
  assert.ok(electionsQuery, 'the Preview status service should issue its elections list');
  assert.deepEqual(electionsQuery.fields, META_FIELDS);
  assert.equal(electionsQuery.limit, 60);
  assert.equal(Object.hasOwn(electionsQuery, 'orderBy'), false,
    'Preview must not add an explicit Firestore ordering that requires the unavailable composite index');
  assert.equal(status.months[1].held, false, 'production recovery hold is not a Preview metadata state');
  assert.equal(status.readOnly, true);
  assert.equal(status.enabled, false);
  assert.equal(status.automationEnabled, false);
  assert.equal(status.storageStatus, 'AVAILABLE');
  assert.equal(JSON.stringify(status).includes('NEVER'), false);
  assert.equal(JSON.stringify(status).includes('candidates'), false);
  assertSafeReads(f);
  const flagged = runtime(f, {
    ELECTION_RESULTS_ENABLED: 'true', ELECTION_RESULTS_AUTOMATION_ENABLED: 'true',
    ELECTION_RESULTS_SEPTEMBER_RECOVERY_APPROVED: 'true',
    ELECTION_RESULTS_PROJECT_ID: 'infosmolinomoard', ELECTION_RESULTS_DATABASE_ID: '(default)',
  });
  assert.deepEqual(await flagged.statusService.monitor(), status);
  const before = f.db.reads.length;
  for (const month of ['2026-09', '2026-10']) {
    await assert.rejects(flagged.service.processMonth(month, { recovery: true }));
  }
  await assert.rejects(flagged.service.run(), (error) => error.status === 503);
  await assert.rejects(flagged.service.latest(), (error) => error.status === 503);
  assert.equal(f.db.reads.length, before);
  assertSafeReads(f);
});

test('invalid election/status fields and read failures fail safely without exposing arbitrary data', async () => {
  const f = previewFixture();
  f.db.docs.get(f.path).siteId = 'other';
  f.db.seed(`${f.path}/resultOperations/state`, {
    state: 'arbitrary', reason: 'PRIVATE_NAME', publishedAt: { private: 'NEVER_EXPOSE' },
  });
  const status = await runtime(f).statusService.monitor();
  const invalidMonth = status.months.find(({ month }) => month === f.month);
  assert.equal(invalidMonth.state, 'RESULT_REQUIRES_VERIFICATION');
  assert.equal(invalidMonth.reason, 'STORAGE_UNAVAILABLE');
  assert.equal(invalidMonth.publishedAt, null);
  assertSafeReads(f);
  f.db.getAll = async () => { throw new Error('unavailable'); };
  const failed = await runtime(f).statusService.monitor();
  assert.equal(failed.storageStatus, 'UNAVAILABLE');
  assert.deepEqual(failed.months, []);
  assert.equal(failed.heartbeat, null);
});

test('protected Preview API/page reject unauthorized users, and public/recovery/worker paths cannot process', async (t) => {
  const f = previewFixture();
  const { base } = await serve(t, f);
  for (const cookie of ['', 'other', 'wrong-site', 'revoked']) {
    const headers = cookie ? { cookie: `__session=${cookie}` } : {};
    const response = await fetch(`${base}/api/v1/management/election-results`, { headers });
    assert.ok([401, 403].includes(response.status));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const page of ['/resultats-du-vote', '/election-results.html',
      '/private-pages/election-results-admin.js', '/private-pages/election-results-admin.css']) {
      assert.equal((await fetch(`${base}${page}`, { headers, redirect: 'manual' })).status, 302);
    }
  }
  assert.equal(f.db.reads.length, 0);
  assert.equal((await fetch(`${base}/private-pages/election-results.html`)).status, 404);
  const response = await fetch(`${base}/api/v1/management/election-results`, { headers: { cookie: '__session=admin' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).months.length, 2);
  const before = f.db.reads.length;
  for (const month of ['2026-09', '2026-10']) {
    const response = await fetch(`${base}/api/v1/management/election-results/${month}/recover`,
      { method: 'POST', headers: { cookie: '__session=admin', origin: base } });
    assert.ok([409, 503].includes(response.status));
  }
  assert.equal((await fetch(`${base}/api/v1/internal/election-results/run`,
    { method: 'POST', headers: { authorization: 'Bearer fixture' } })).status, 503);
  assert.equal((await fetch(`${base}/api/v1/public/election-results/latest`)).status, 503);
  assert.equal((await fetch(`${base}/api/v1/public/winner-photos/fixture`)).status, 503);
  assert.equal(f.db.reads.length, before);
  assertSafeReads(f);
});

test('production monitoring and processing still require their original explicit binding and enablement', async () => {
  const db = new MemoryFirestore();
  const production = { ...env, NODE_ENV: 'production', ELECTION_DATA_ENVIRONMENT: 'production' };
  for (const extra of [{}, { ELECTION_RESULTS_ENABLED: 'true' },
    { ELECTION_RESULTS_PROJECT_ID: 'fixture-project', ELECTION_RESULTS_DATABASE_ID: '(default)' }]) {
    const r = createResultsRuntime({ env: { ...production, ...extra }, firebaseDb: db });
    assert.equal(r.statusService, r.service);
    assert.equal((await r.statusService.monitor()).storageStatus, 'DISABLED');
    assert.equal(r.service.enabled, false);
    await assert.rejects(r.service.processMonth('2026-10'));
    await assert.rejects(r.service.run());
  }
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
  const r = createResultsRuntime({ env: { ...production,
    ELECTION_RESULTS_PROJECT_ID: 'fixture-project', ELECTION_RESULTS_DATABASE_ID: '(default)',
    ELECTION_RESULTS_ENABLED: 'true', ELECTION_RESULTS_AUTOMATION_ENABLED: 'true',
  }, firebaseDb: db });
  assert.equal(r.statusService, r.service);
  assert.equal(r.service.enabled, true);
  assert.equal(r.service.automationEnabled, true);
  const status = await r.statusService.monitor();
  assert.equal(status.storageStatus, 'AVAILABLE');
  assert.equal(status.readOnly, undefined);
  assert.equal(db.writes.length, 0);
});

test('Preview launcher and current-month monitoring remain snapshot-only and unmodified', () => {
  const config = fs.readFileSync(path.join(__dirname, '../.replit'), 'utf8');
  assert.match(config, /args = "env -u EMPLOYEE_DIRECTORY_SHEET_ID node server.js"/);
  const monitoring = fs.readFileSync(path.join(__dirname, '../election-engine/monitoring.js'), 'utf8');
  assert.match(monitoring, /electionWindow\(observedAt, timeZone\)/);
  assert.match(monitoring, /\.doc\(window.monthKey\)/);
  assert.doesNotMatch(monitoring, /req\.query\.month|req\.params\.month/);
});

test('Preview dashboard renders fixture month/heartbeat status and never offers an active recovery', async (t) => {
  const f = previewFixture();
  const { base } = await serve(t, f);
  const { call, evaluate, errors } = await browserSession(t);
  await call('Network.setCookie', { name: '__session', value: 'admin', url: base });
  for (const [width, height] of [[390, 844], [1440, 960]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.navigate', { url: `${base}/resultats-du-vote` });
    await waitFor(() => evaluate('document.querySelector("#dashboard") && !document.querySelector("#dashboard").hidden'));
    assert.equal(await evaluate('document.querySelectorAll(".month-row").length'), 2);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".month-period")].map(node => node.textContent)'),
      ['octobre 2026', 'septembre 2026'], 'the page should sort months newest-first for display');
    assert.equal(await evaluate('document.querySelector("#results-eyebrow").textContent'), 'Preview · Lecture seule');
    assert.equal(await evaluate('document.querySelector("#storage-state").textContent'), 'Disponible');
    assert.equal(await evaluate('[...document.querySelectorAll(".month-actions button")].every(b => b.disabled && b.textContent === "Indisponible en Preview")'), true);
    assert.equal(await evaluate('document.querySelector("#heartbeat-details").textContent.includes("Dernière tentative")'), true);
    assert.equal(await evaluate('document.body.textContent.includes("NEVER")'), false);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    await evaluate('document.querySelector("#refresh").click()');
    await waitFor(() => evaluate('document.querySelector("#refresh-status").textContent === "État actualisé."'));
  }
  assert.deepEqual(errors, []);
  assertSafeReads(f);
});