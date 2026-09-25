const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { electionWindow } = require('../election-engine/contract');
const {
  createElectionMonitoringService, mountElectionMonitoring,
} = require('../election-engine/monitoring');

const now = () => new Date('2026-09-26T12:00:00.000Z');
const window = electionWindow(now(), 'Europe/Zurich');
const env = {
  EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
  ELECTION_DATA_ENVIRONMENT: 'development',
  ELECTION_TIME_ZONE: 'Europe/Zurich',
  MOLARD_ADMIN_FIREBASE_UID: 'admin-uid',
};
const employees = Array.from({ length: 49 }, (_, index) => ({
  employeeId: `employee-${index}`, displayName: `Collaborateur ${index}`,
  department: 'Cuisine', votingGroup: 'CUISINE', siteId: 'molard',
}));
const directoryService = { getElectionSnapshot: () => ({ siteId: 'molard', employees }) };

function fakeDb(records = {}) {
  const calls = [];
  const db = {
    calls,
    records,
    current() { throw new Error('monitoring must not call current'); },
    ensureElection() { throw new Error('monitoring must not call ensureElection'); },
    collection(name) { return collection(name); },
    async getAll(ref, options) {
      calls.push(['getAll', ref.path, options.fieldMask]);
      if (records.failRead) throw new Error('Firestore unavailable');
      const value = records[ref.path];
      return [{
        exists: Boolean(value),
        data: () => Object.fromEntries(options.fieldMask
          .filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]])),
      }];
    },
    runTransaction() { throw new Error('write attempted'); },
  };
  function collection(path) {
    return {
      doc(id) { return document(`${path}/${id}`); },
    };
  }
  function document(path) {
    return {
      path,
      collection(name) {
        return {
          doc(id) { return document(`${path}/${name}/${id}`); },
          count() {
            return {
              async get() {
                calls.push(['count', `${path}/${name}`]);
                if (records.failCount) throw new Error('Count unavailable');
                return { data: () => ({ count: records[`${path}/${name}`] ?? 0 }) };
              },
            };
          },
          select() {
            return { async get() {
              calls.push(['select', `${path}/${name}`]);
              if (name !== 'participation') throw new Error('individual ballot read');
              if (records.failSelect) throw new Error('Participation unavailable');
              return { docs: (records.participationIds || []).map((id) => ({
                id, data() { throw new Error('participation payload read'); },
              })) };
            } };
          },
        };
      },
      get() { throw new Error('unprojected document read'); },
      create() { throw new Error('write attempted'); },
      set() { throw new Error('write attempted'); },
      update() { throw new Error('write attempted'); },
      delete() { throw new Error('write attempted'); },
    };
  }
  return db;
}

function electionPath(environment = 'development') {
  return `electionSites/molard/dataEnvironments/${environment}/elections/${window.monthKey}`;
}

function election(overrides = {}) {
  return {
    siteId: 'molard',
    dataEnvironment: 'development',
    monthKey: window.monthKey,
    timeZone: 'Europe/Zurich',
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    eligibleVoterCount: 49,
    voters: Object.fromEntries(employees.map((employee) => [employee.employeeId, {
      employeeId: employee.employeeId, votingGroup: employee.votingGroup, verifier: 'private-verifier',
    }])),
    candidates: { candidate: { comments: 'private' } },
    results: { CUISINE: { counts: { candidate: 1 } } },
    ...overrides,
  };
}

function seededDb(participation = 0, ballots = 0, ids = Array.from({ length: participation }, (_, i) => `employee-${i}`)) {
  const path = electionPath();
  return fakeDb({
    [path]: election(),
    [`${path}/participation`]: participation,
    [`${path}/ballots`]: ballots,
    participationIds: ids,
  });
}

async function appFixture(t, db = seededDb(), directory = directoryService) {
  const app = express();
  mountElectionMonitoring(app, {
    env,
    firebaseDb: db,
    directoryService: directory,
    now,
    firebaseAuth: {
      async verifySessionCookie(cookie) {
        if (cookie === 'admin') return { uid: 'admin-uid', siteId: 'molard' };
        if (cookie === 'wrong-site') return { uid: 'admin-uid', siteId: 'other' };
        if (cookie === 'non-admin') return { uid: 'another-uid', siteId: 'molard' };
        throw new Error('Invalid session');
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/management/election-monitoring`;
  return { db, get: (cookie) => fetch(url, cookie ? { headers: { Cookie: `__session=${cookie}` } } : {}) };
}

test('admin receives only the approved aggregates and no-store headers', async (t) => {
  const { db, get } = await appFixture(t, seededDb(1, 1));
  const response = await get('admin');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual({ ...body, voters: undefined }, {
    month: window.monthKey,
    status: 'OPEN',
    window: { opensAt: window.opensAt, closesAt: window.closesAt },
    eligibleVoters: 49,
    participation: { count: 1, remaining: 48, percentage: 2.04 },
    systemHealth: { participationRecords: 1, anonymousBallots: 1, consistency: 'OK' },
    voters: undefined,
  });
  assert.equal(body.voters.length, 49);
  assert.deepEqual(body.voters[0], { name: 'Collaborateur 0', department: 'Cuisine', hasVoted: true });
  assert.deepEqual(body.voters[1], { name: 'Collaborateur 1', department: 'Cuisine', hasVoted: false });
  assert.deepEqual(db.calls.map(([operation]) => operation), ['getAll', 'count', 'count', 'select']);
  assert.deepEqual(db.calls[0][2].sort(), [
    'siteId', 'dataEnvironment', 'monthKey', 'timeZone',
    'opensAt', 'closesAt', 'eligibleVoterCount', 'voters',
  ].sort());
  for (const prohibited of ['private', 'verifier', 'grant', 'ballotId', 'comments', 'candidate',
    'results', 'ranking', 'salaireId', 'employee-0', 'private-verifier']) {
    assert.equal(JSON.stringify(body).toLowerCase().includes(prohibited.toLowerCase()), false, prohibited);
  }
});

test('requests without the exact admin UID and site claim are denied before database access', async (t) => {
  const { db, get } = await appFixture(t);
  for (const [cookie, expected] of [
    [null, 401], ['invalid', 401], ['non-admin', 403], ['wrong-site', 403],
  ]) {
    const response = await get(cookie);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(await response.json()).includes('ELECTION_NOT_FOUND'), false);
  }
  assert.equal(db.calls.length, 0);
});

test('missing election is distinct from a real election with zero participation and never creates one', async (t) => {
  const empty = fakeDb();
  const { get } = await appFixture(t, empty);
  for (let i = 0; i < 3; i += 1) {
    const response = await get('admin');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'ELECTION_NOT_FOUND' });
  }
  assert.deepEqual(empty.calls.map(([operation]) => operation), ['getAll', 'getAll', 'getAll']);
  const zero = await createElectionMonitoringService({
    db: seededDb(), directoryService, siteId: 'molard', dataEnvironment: 'development',
    timeZone: 'Europe/Zurich', now,
  }).read();
  assert.deepEqual(zero.participation, { count: 0, remaining: 49, percentage: 0 });
  assert.deepEqual(zero.systemHealth, { participationRecords: 0, anonymousBallots: 0, consistency: 'OK' });
});

test('independent aggregate counts signal anomalies without repair or result reads', async (t) => {
  const db = seededDb(1, 0);
  const { get } = await appFixture(t, db);
  for (let i = 0; i < 3; i += 1) {
    const response = await get('admin');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.systemHealth, {
      participationRecords: 1, anonymousBallots: 0, consistency: 'ANOMALY',
    });
  }
  assert.equal(db.calls.length, 12);
  assert.equal(db.calls.some(([, path]) => path.includes('resultInternals')), false);
});

test('equal counts above the eligible total are still an anomaly', async () => {
  for (const [eligible, count] of [[0, 1], [2, 3]]) {
    const db = seededDb(count, count);
    db.records[electionPath()].eligibleVoterCount = eligible;
    db.records[electionPath()].voters = Object.fromEntries(
      Object.entries(db.records[electionPath()].voters).slice(0, eligible));
    const result = await createElectionMonitoringService({
      db, directoryService, siteId: 'molard', dataEnvironment: 'development',
      timeZone: 'Europe/Zurich', now,
    }).read();
    assert.equal(result.systemHealth.consistency, 'ANOMALY');
    assert.equal(result.participation.remaining, 0);
  }
});

test('the monitoring service fails closed for corrupted, mismatched, or unavailable data', async (t) => {
  const cases = [
    { siteId: 'other' }, { dataEnvironment: 'production' },
    { monthKey: '2026-08' }, { timeZone: 'UTC' },
    { opensAt: '2026-09-24T00:00:00.000Z' },
    { eligibleVoterCount: -1 }, { eligibleVoterCount: '49' },
  ];
  for (const altered of cases) {
    const path = electionPath();
    const db = fakeDb({ [path]: election(altered) });
    const service = createElectionMonitoringService({
      db, directoryService, siteId: 'molard', dataEnvironment: 'development', timeZone: 'Europe/Zurich', now,
    });
    await assert.rejects(service.read(), (error) => error.code === 'ELECTION_DATA_INVALID');
    assert.equal(db.calls.length, 1);
  }
  for (const flag of ['failRead', 'failCount', 'failSelect']) {
    const db = seededDb();
    db.records[flag] = true;
    const { get } = await appFixture(t, db);
    const response = await get('admin');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'MONITORING_UNAVAILABLE' });
    const service = createElectionMonitoringService({
      db, directoryService, siteId: 'molard', dataEnvironment: 'development', timeZone: 'Europe/Zurich', now,
    });
    await assert.rejects(service.read());
  }
});

test('development and production paths remain isolated', async () => {
  const production = electionPath('production');
  const db = fakeDb({ [production]: election({ dataEnvironment: 'production' }) });
  const developmentReader = createElectionMonitoringService({
    db, directoryService, siteId: 'molard', dataEnvironment: 'development', timeZone: 'Europe/Zurich', now,
  });
  await assert.rejects(developmentReader.read(), (error) => error.code === 'ELECTION_NOT_FOUND');
  const productionReader = createElectionMonitoringService({
    db, directoryService, siteId: 'molard', dataEnvironment: 'production', timeZone: 'Europe/Zurich', now,
  });
  const result = await productionReader.read();
  assert.equal(result.month, window.monthKey);
  assert.equal(db.calls[0][1], electionPath('development'));
  assert.equal(db.calls[1][1], production);
});

test('missing binding or admin configuration fails closed without reading the election', async (t) => {
  const db = seededDb(1, 1);
  const service = createElectionMonitoringService({
    db, directoryService, siteId: 'molard', dataEnvironment: '', timeZone: 'Europe/Zurich', now,
  });
  await assert.rejects(service.read(), (error) => error.code === 'MONITORING_UNAVAILABLE');
  assert.equal(db.calls.length, 0);

  const app = express();
  mountElectionMonitoring(app, {
    env: { ...env, MOLARD_ADMIN_FIREBASE_UID: '' },
    firebaseDb: db,
    firebaseAuth: null,
    now,
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/management/election-monitoring`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'MONITORING_UNAVAILABLE' });
  assert.equal(db.calls.length, 0);
});

test('zero eligible voters and upcoming windows are handled without ballot data', async () => {
  const path = electionPath();
  const db = fakeDb({ [path]: election({ eligibleVoterCount: 0, voters: {} }) });
  const read = (at) => createElectionMonitoringService({
    db, directoryService, siteId: 'molard', dataEnvironment: 'development',
    timeZone: 'Europe/Zurich', now: () => new Date(at),
  }).read();
  const open = await read('2026-09-26T12:00:00.000Z');
  assert.equal(open.participation.percentage, 0);
  assert.equal(open.status, 'OPEN');
  assert.equal((await read('2026-09-20T12:00:00.000Z')).status, 'UPCOMING');
  // After the month rolls over, the canonical month becomes October; no September data is read.
  await assert.rejects(read('2026-10-01T12:00:00.000Z'), (error) => error.code === 'ELECTION_NOT_FOUND');
});

test('unknown participation identifiers and aggregate disagreements produce anomalies without writes', async () => {
  for (const db of [seededDb(1, 1, []), seededDb(1, 1, ['unknown-id'])]) {
    const result = await createElectionMonitoringService({
      db, directoryService, siteId: 'molard', dataEnvironment: 'development', timeZone: 'Europe/Zurich', now,
    }).read();
    assert.equal(result.systemHealth.consistency, 'ANOMALY');
    assert.equal(result.voters.filter((voter) => voter.hasVoted).length, 0);
    assert.deepEqual(db.calls.filter(([, path]) => path.endsWith('/ballots')).map(([op]) => op), ['count']);
  }
});

test('missing, duplicate or changed directory names fail closed instead of inventing pending voters', async (t) => {
  for (const altered of [
    null,
    { siteId: 'molard', employees: employees.slice(1) },
    { siteId: 'molard', employees: [{ ...employees[0], displayName: '' }, ...employees.slice(1)] },
    { siteId: 'molard', employees: [{ ...employees[0], displayName: 'Collaborateur 1' }, ...employees.slice(1)] },
    { siteId: 'other', employees },
  ]) {
    const db = seededDb();
    const { get } = await appFixture(t, db, { getElectionSnapshot: () => altered });
    const response = await get('admin');
    assert.equal(response.status, 503);
    assert.equal(Object.hasOwn(await response.json(), 'voters'), false);
    assert.equal(db.calls.length, 1);
  }
});