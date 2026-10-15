const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { MemoryFirestore } = require('./helpers/results-fixture');
const { electionWindow } = require('../election-engine/contract');
const { createElectionHistoryService } = require('../election-engine/history-service');
const { mountResultsApi } = require('../election-engine/results-runtime');
const { createAdministrationSessionAuthorization, createAdministrationPageAuthorization } = require('../employee-directory/auth');
const { mountAdministrationHistoryPage } = require('../administration-monitoring-page');
const { mountPublicFiles } = require('../public-files');

const binding = { siteId: 'molard', environment: 'development' };
const now = () => new Date('2026-11-02T12:00:00Z');
function seed(db, month, names = true, published = true) {
  const window = electionWindow(new Date(`${month}-15T12:00:00Z`), 'Europe/Zurich');
  const root = `electionSites/molard/dataEnvironments/development/elections/${month}`;
  const voters = {
    'private-one': { employeeId: 'private-one', votingGroup: 'CUISINE', verifier: 'PRIVATE_VERIFIER' },
    'private-two': { employeeId: 'private-two', votingGroup: 'SERVICE', verifier: 'PRIVATE_VERIFIER' },
  };
  if (names) {
    Object.assign(voters['private-one'], { displayName: 'Alice historique', department: 'Cuisine' });
    Object.assign(voters['private-two'], { displayName: 'Bruno historique', department: 'Service' });
  }
  db.seed(root, { schemaVersion: 1, siteId: 'molard', dataEnvironment: 'development', monthKey: month,
    timeZone: 'Europe/Zurich', opensAt: window.opensAt, closesAt: window.closesAt,
    eligibleVoterCount: 2, voters, candidates: { secret: 'NEVER_READ' } });
  db.seed(`${root}/participation/private-one`, { status: 'SUBMITTED', secret: 'NEVER_READ' });
  db.seed(`${root}/ballots/random`, { choices: 'NEVER_READ', comments: 'NEVER_READ' });
  if (published) {
    const publishedAt = `${month === '2026-09' ? '2026-10' : '2026-11'}-01T01:00:00.000Z`;
    db.seed(`${root}/resultOperations/state`, { state: 'PUBLISHED', publishedAt });
    db.seed(`${root}/publication/public`, {
      schemaVersion: 1, siteId: 'molard', dataEnvironment: 'development', monthKey: month,
      timeZone: 'Europe/Zurich', opensAt: window.opensAt, closesAt: window.closesAt,
      finalizedAt: publishedAt, publishedAt, inputDigest: 'a'.repeat(64),
      categories: {
        CUISINE: { outcome: 'WINNERS', winners: [{ employeeId: 'private-chef', name: 'Chef gagnant', role: 'Chef' }] },
        SERVICE: { outcome: 'WINNERS', winners: [{ employeeId: 'private-service', name: 'Service gagnant', role: '' }] },
      },
    });
  }
  return root;
}
function fixture() {
  const db = new MemoryFirestore();
  const september = seed(db, '2026-09', false, false);
  const october = seed(db, '2026-10');
  return { db, september, october, service: createElectionHistoryService({ db, binding, now }) };
}
function assertPrivate(db, result) {
  assert.equal(db.writes.length, 0);
  assert.equal(db.reads.some(([, key]) => /ballots|grants|resultInternals|employeeDirectory/.test(key)), false);
  const json = JSON.stringify(result);
  for (const value of ['private-', 'PRIVATE_VERIFIER', 'NEVER_READ', 'employeeId', 'choices', 'comments', 'inputDigest']) {
    assert.equal(json.includes(value), false, value);
  }
}

test('September/October history uses stored months, definitive publications and only complete snapshot names', async () => {
  const f = fixture();
  const october = await f.service.read('2026-10');
  assert.deepEqual(october.availableMonths, ['2026-10', '2026-09']);
  assert.deepEqual(october.participation, { eligible: 2, submitted: 1, notSubmitted: 1, percentage: 50 });
  assert.equal(october.results.status, 'PUBLISHED');
  assert.equal(october.results.categories.CUISINE.winners[0].name, 'Chef gagnant');
  assert.deepEqual(october.roster.voters, [
    { name: 'Alice historique', department: 'Cuisine', hasVoted: true },
    { name: 'Bruno historique', department: 'Service', hasVoted: false },
  ]);
  const september = await f.service.read('2026-09');
  assert.equal(september.roster.status, 'UNVERIFIABLE');
  assert.equal(september.roster.voters, null);
  assert.equal(september.results.status, 'NOT_PUBLISHED');
  assert.equal((await f.service.read()).month, '2026-10');
  assertPrivate(f.db, [september, october]);
});

test('missing months, invalid input, empty storage and incomplete data never create elections', async () => {
  const f = fixture();
  for (const month of ['2026-13', ['2026-10'], '../2026-10']) {
    const reads = f.db.reads.length;
    await assert.rejects(f.service.read(month), (error) => error.code === 'INVALID_MONTH');
    assert.equal(f.db.reads.length, reads);
  }
  await assert.rejects(f.service.read('2026-08'), (error) => error.code === 'ELECTION_NOT_FOUND');
  const empty = new MemoryFirestore();
  assert.deepEqual(await createElectionHistoryService({ db: empty, binding, now }).read(),
    { availableMonths: [], month: null, electionStatus: 'NO_ELECTIONS' });
  f.db.docs.get(f.october).siteId = 'other';
  await assert.rejects(f.service.read('2026-10'), (error) => error.code === 'HISTORY_DATA_INVALID');
  assert.equal(f.db.writes.length + empty.writes.length, 0);
});

test('partial, ambiguous and orphaned historical rosters never expose a partial named list', async () => {
  for (const defect of ['missing-name', 'duplicate-name', 'orphan', 'wrong-group']) {
    const f = fixture();
    const voters = f.db.docs.get(f.october).voters;
    if (defect === 'missing-name') delete voters['private-two'].displayName;
    if (defect === 'duplicate-name') voters['private-two'].displayName = 'Alice historique';
    if (defect === 'wrong-group') voters['private-two'].department = 'Cuisine';
    if (defect === 'orphan') f.db.seed(`${f.october}/participation/orphan`, {});
    const data = await f.service.read('2026-10');
    assert.equal(data.roster.voters, null);
    assertPrivate(f.db, data);
  }
});

test('unpublished, missing, mismatched and invalid publications never expose winners; ties are preserved', async () => {
  for (const defect of ['unpublished', 'missing', 'month', 'time', 'operation']) {
    const f = fixture();
    const publication = f.db.docs.get(`${f.october}/publication/public`);
    if (defect === 'unpublished') f.db.docs.get(`${f.october}/resultOperations/state`).state = 'FINALIZING';
    if (defect === 'missing') f.db.docs.delete(`${f.october}/publication/public`);
    if (defect === 'month') publication.monthKey = '2026-09';
    if (defect === 'time') publication.finalizedAt = '2026-10-10T00:00:00Z';
    if (defect === 'operation') f.db.docs.get(`${f.october}/resultOperations/state`).publishedAt = 'invalid';
    const data = await f.service.read('2026-10');
    assert.equal(data.results.categories, null);
    assertPrivate(f.db, data);
  }
  const f = fixture();
  f.db.docs.get(`${f.october}/publication/public`).categories.CUISINE.winners.push({ name: 'Ex æquo', role: '' });
  assert.equal((await f.service.read('2026-10')).results.categories.CUISINE.winners.length, 2);
});

test('API and every private history page/asset require the exact owner session before data reads', async (t) => {
  const f = fixture();
  const firebaseAuth = { async verifySessionCookie(cookie, revoked) {
    assert.equal(revoked, true);
    if (cookie === 'bad') throw new Error();
    return { uid: cookie === 'owner' || cookie === 'wrong-site' ? 'owner-uid' : 'other', siteId: cookie === 'wrong-site' ? 'other' : 'molard' };
  } };
  const options = { firebaseAuth, siteId: 'molard', administratorUid: 'owner-uid' };
  const app = express();
  mountResultsApi(app, { service: {}, historyService: f.service,
    authorize: createAdministrationSessionAuthorization(options), workerAuthorization: (_req, res) => res.sendStatus(403) });
  mountAdministrationHistoryPage(app, createAdministrationPageAuthorization(options), path.join(__dirname, '..'));
  mountPublicFiles(app, path.join(__dirname, '..'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const cookie of ['', 'bad', 'employee', 'manager', 'wrong-site']) {
    const headers = cookie ? { cookie: `__session=${cookie}` } : {};
    assert.ok([401, 403].includes((await fetch(`${base}/api/v1/management/election-history`, { headers })).status));
    for (const route of ['/historique-des-votations', '/historique-des-votations.html',
      '/private-pages/election-history-admin.js', '/private-pages/election-history-admin.css']) {
      assert.equal((await fetch(base + route, { headers, redirect: 'manual' })).status, 302);
    }
  }
  assert.equal(f.db.reads.length, 0);
  const headers = { cookie: '__session=owner' };
  const response = await fetch(`${base}/api/v1/management/election-history?month=2026-10`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assertPrivate(f.db, await response.json());
  assert.equal((await fetch(`${base}/historique-des-votations`, { headers })).status, 200);
  for (const route of ['/election-history.html', '/private-pages/election-history.html']) {
    assert.equal((await fetch(base + route)).status, 404);
  }
});
