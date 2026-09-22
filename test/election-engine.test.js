const assert = require('node:assert/strict');
const test = require('node:test');
const { createSalaireVerifier } = require('../employee-directory/contract');
const {
  COMMENT_MAX, electionState, electionWindow, validateBallot, winnersFromCounts,
} = require('../election-engine/contract');
const { ElectionError } = require('../election-engine/firestore-store');
const { ElectionService } = require('../election-engine/service');
const { createElectionRuntime, networkKey } = require('../election-engine');
const express = require('express');

const siteId = 'molard';
const pepper = 'directory-test-pepper';
const grantSecret = 'grant-secret-at-least-thirty-two-bytes-long';
const employees = [
  { employeeId: 'voter-1', displayName: 'Voter', jobTitle: '', department: 'Cuisine', votingGroup: 'CUISINE', active: true, canVote: true, canBeElected: false, photoUrl: '/v.svg', siteId },
  { employeeId: 'chef-1', displayName: 'Chef One', jobTitle: 'Chef', department: 'Cuisine', votingGroup: 'CUISINE', active: true, canVote: false, canBeElected: true, photoUrl: '/c.svg', siteId },
  { employeeId: 'service-1', displayName: 'Service One', jobTitle: '', department: 'Service', votingGroup: 'SERVICE', active: true, canVote: true, canBeElected: true, photoUrl: '/s.svg', siteId },
  { employeeId: 'inactive', displayName: 'Inactive', jobTitle: '', department: 'Service', votingGroup: 'SERVICE', active: false, canVote: true, canBeElected: true, photoUrl: '/i.svg', siteId },
];
const directory = {
  snapshot: {
    schemaVersion: 1, siteId, sourceGeneration: 7, refreshedAt: '2026-09-01T00:00:00.000Z',
    employees,
    verifierRecords: [
      { employeeId: 'voter-1', verifier: createSalaireVerifier('SAL-1001', pepper), verifierVersion: 1, siteId },
      { employeeId: 'chef-1', verifier: createSalaireVerifier('SAL-1002', pepper), verifierVersion: 1, siteId },
      { employeeId: 'service-1', verifier: createSalaireVerifier('SAL-1003', pepper), verifierVersion: 1, siteId },
      { employeeId: 'inactive', verifier: createSalaireVerifier('SAL-1004', pepper), verifierVersion: 1, siteId },
    ],
  },
};

class MemoryTestStore {
  constructor() {
    this.elections = new Map(); this.grants = new Map(); this.participation = new Set();
    this.ballots = []; this.audits = []; this.rateAllowed = true;
  }
  async ensureElection(window, snapshot, now) {
    if (!this.elections.has(window.monthKey)) {
      const voters = {}; const candidates = {};
      const verifierByEmployee = new Map(snapshot.verifierRecords.map((record) => [record.employeeId, record]));
      for (const e of snapshot.employees) {
        if (e.active && e.canVote) voters[e.employeeId] = {
          employeeId: e.employeeId, votingGroup: e.votingGroup,
          verifier: verifierByEmployee.get(e.employeeId).verifier, verifierVersion: 1,
        };
        if (e.active && e.canBeElected) candidates[e.employeeId] = { ...e };
      }
      this.elections.set(window.monthKey, { ...window, siteId, voters, candidates, eligibleVoterCount: Object.keys(voters).length, createdAt: now.toISOString() });
    }
    return this.elections.get(window.monthKey);
  }
  async checkRateLimit() { return this.rateAllowed; }
  async createGrant(grant) { this.grants.set(grant.hash, grant); }
  async authorize(monthKey, hash, nowMs, { allowConsumed = false } = {}) {
    const grant = this.grants.get(hash);
    if (!grant || grant.monthKey !== monthKey || (!allowConsumed && grant.consumed) ||
        (!grant.consumed && grant.expiresAtMs <= nowMs)) throw new ElectionError('INVALID_AUTHORIZATION');
    return grant;
  }
  async hasParticipated(monthKey, employeeId) { return this.participation.has(`${monthKey}:${employeeId}`); }
  async participationCount(monthKey) { return [...this.participation].filter((key) => key.startsWith(`${monthKey}:`)).length; }
  async audit(monthKey, action, outcome, now) { this.audits.push({ monthKey, action, outcome, timeBucket: now.toISOString().slice(0, 13) }); }
  async submit({ monthKey, grantHash, ballot, now, stateFor }) {
    const transactionNow = now();
    const grant = this.grants.get(grantHash);
    if (!grant || grant.monthKey !== monthKey) throw new ElectionError('INVALID_AUTHORIZATION');
    const election = this.elections.get(monthKey);
    const key = `${monthKey}:${grant.employeeId}`;
    if (grant.consumed && this.participation.has(key)) return { code: 'SUBMITTED', replayed: true };
    if (grant.consumed || grant.expiresAtMs <= transactionNow.getTime()) throw new ElectionError('INVALID_AUTHORIZATION');
    if (stateFor(election, transactionNow) !== 'OPEN') throw new ElectionError('ELECTION_NOT_OPEN');
    if (this.participation.has(key)) throw new ElectionError('ALREADY_VOTED');
    for (const group of ['CUISINE', 'SERVICE']) {
      const candidate = election.candidates[ballot.choices[group]];
      if (!candidate || candidate.votingGroup !== group || candidate.employeeId === grant.employeeId) throw new ElectionError('INVALID_BALLOT');
    }
    this.participation.add(key);
    this.ballots.push({ schemaVersion: 1, choices: ballot.choices, comments: ballot.comments });
    grant.consumed = true;
    return { code: 'SUBMITTED' };
  }
  async tally(monthKey, now, stateFor) {
    const election = this.elections.get(monthKey);
    if (stateFor(election, now) !== 'CLOSED_PENDING_RESULTS') throw new ElectionError('RESULTS_SEALED');
    const counts = { CUISINE: {}, SERVICE: {} };
    for (const ballot of this.ballots) for (const group of ['CUISINE', 'SERVICE']) {
      const id = ballot.choices[group]; counts[group][id] = (counts[group][id] || 0) + 1;
    }
    return counts;
  }
  async finalize(monthKey, now, stateFor, summarize) {
    const counts = await this.tally(monthKey, now(), stateFor);
    return { monthKey, results: summarize(counts), finalizedAt: now().toISOString() };
  }
}

function serviceAt(iso, store = new MemoryTestStore()) {
  return {
    store,
    service: new ElectionService({
      store, directoryService: directory, siteId, timeZone: 'Europe/Zurich',
      pepper, grantSecret, now: () => new Date(iso),
    }),
  };
}

test('derives local monthly windows across leap-year and year boundaries', () => {
  const february = electionWindow(new Date('2028-02-15T12:00:00Z'), 'Europe/Zurich');
  assert.deepEqual(february, {
    monthKey: '2028-02',
    opensAt: '2028-02-24T23:00:00.000Z',
    closesAt: '2028-02-29T23:00:00.000Z',
  });
  const december = electionWindow(new Date('2026-12-31T12:00:00Z'), 'Europe/Zurich');
  assert.equal(december.closesAt, '2026-12-31T23:00:00.000Z');
  assert.equal(electionState(february, new Date(february.opensAt)), 'OPEN');
  assert.equal(electionState(february, new Date(february.closesAt)), 'CLOSED_PENDING_RESULTS');
});

test('requires exact two-category ballot and trimmed comment bounds', () => {
  const valid = validateBallot({
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: '  Excellent travail  ', SERVICE: 'Très bon service' },
  });
  assert.equal(valid.comments.CUISINE, 'Excellent travail');
  assert.equal(validateBallot({ choices: valid.choices, comments: { CUISINE: 'short', SERVICE: 'valid comment' } }), null);
  assert.equal(validateBallot({ choices: valid.choices, comments: { CUISINE: 'x'.repeat(COMMENT_MAX + 1), SERVICE: 'valid comment' } }), null);
  assert.equal(validateBallot({ choices: { ...valid.choices, EXTRA: 'x' }, comments: valid.comments }), null);
});

test('verification eligibility is independent from candidacy and failures are generic', async () => {
  const { service } = serviceAt('2026-09-25T12:00:00Z');
  assert.equal((await service.verify('SAL-1001')).code, 'VERIFIED');
  await assert.rejects(service.verify('SAL-1002'), (error) => error.code === 'INVALID_CREDENTIALS');
  await assert.rejects(service.verify('SAL-1004'), (error) => error.code === 'INVALID_CREDENTIALS');
  await assert.rejects(service.verify('unknown'), (error) => error.code === 'INVALID_CREDENTIALS');
});

test('authorization is scoped, expires, and omits voter from own candidate group', async () => {
  const { service, store } = serviceAt('2026-09-25T12:00:00Z');
  const verified = await service.verify('SAL-1003');
  const result = await service.candidates(verified.authorization);
  assert.equal(result.candidates.SERVICE.some((c) => c.employeeId === 'service-1'), false);
  assert.equal(JSON.stringify(result).includes('verifier'), false);
  for (const candidate of [...result.candidates.CUISINE, ...result.candidates.SERVICE]) {
    assert.deepEqual(Object.keys(candidate).sort(), ['displayName', 'employeeId', 'jobTitle', 'photoUrl']);
  }
  const grant = [...store.grants.values()][0];
  grant.expiresAtMs = 0;
  await assert.rejects(service.candidates(verified.authorization), (error) => error.code === 'INVALID_AUTHORIZATION');
  await assert.rejects(service.candidates(`${verified.authorization}x`), (error) => error.code === 'INVALID_AUTHORIZATION');
});

test('submission is final, anonymous, atomic in shape, and monthly isolated', async () => {
  const { service, store } = serviceAt('2026-09-25T12:00:00Z');
  const verified = await service.verify('SAL-1001');
  const body = {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  };
  assert.equal((await service.submit(verified.authorization, body)).code, 'SUBMITTED');
  assert.equal(store.participation.size, 1);
  assert.equal(store.ballots.length, 1);
  const serialized = JSON.stringify(store.ballots[0]);
  for (const forbidden of ['voter', 'employeeId', 'grant', 'participation', 'ip', 'userAgent', 'SAL-1001', 'submittedAt']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  const replay = await service.submit(verified.authorization, body);
  assert.deepEqual(replay, { code: 'SUBMITTED', replayed: true });
  assert.equal(store.ballots.length, 1);

  const october = new ElectionService({ store, directoryService: directory, siteId, timeZone: 'Europe/Zurich', pepper, grantSecret, now: () => new Date('2026-10-25T12:00:00Z') });
  const octoberGrant = await october.verify('SAL-1001');
  assert.equal((await october.participation(octoberGrant.authorization)).submitted, false);
});

test('simultaneous duplicate submissions yield exactly one success', async () => {
  const { service, store } = serviceAt('2026-09-25T12:00:00Z');
  const first = await service.verify('SAL-1001');
  const second = await service.verify('SAL-1001');
  const body = {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  };
  const settled = await Promise.allSettled([service.submit(first.authorization, body), service.submit(second.authorization, body)]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(store.ballots.length, 1);
  assert.equal(store.participation.size, 1);
});

test('self-votes, wrong groups, throttling, and open results are rejected', async () => {
  const { service, store } = serviceAt('2026-09-25T12:00:00Z');
  const verified = await service.verify('SAL-1003');
  await assert.rejects(service.submit(verified.authorization, {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  }), (error) => error.code === 'INVALID_BALLOT');
  await assert.rejects(service.finalize('2026-09'), (error) => error.code === 'RESULTS_SEALED');
  store.rateAllowed = false;
  await assert.rejects(service.verify('SAL-1001'), (error) => error.code === 'RATE_LIMITED');
});

test('tie primitive includes every highest-count leader without override', () => {
  assert.deepEqual(winnersFromCounts({ a: 4, b: 4, c: 2 }), {
    highestCount: 4,
    winnerEmployeeIds: ['a', 'b'],
  });
});

test('fails closed without timezone, durable store, directory, or strong grant secret', async () => {
  const service = new ElectionService({ store: null, directoryService: directory, siteId, timeZone: '', pepper, grantSecret: 'short' });
  await assert.rejects(service.current(), (error) => error.code === 'SERVICE_UNAVAILABLE');
});

test('runtime readiness names missing configuration without exposing secret values', () => {
  const runtime = createElectionRuntime({
    env: {
      EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
      ELECTION_TIME_ZONE: 'Europe/Zurich',
      ELECTION_TRUST_PROXY_HOPS: '1',
      ELECTION_DATA_ENVIRONMENT: 'development',
    },
    firebaseDb: null,
    directoryService: { getStatus: () => ({ configured: false, sourceHealth: 'not_configured' }) },
  });
  const report = runtime.readiness();
  assert.equal(report.ready, false);
  assert.equal(report.checks.siteIdentity, true);
  assert.equal(report.checks.firebaseAdmin, false);
  assert.equal(report.checks.directoryVerifier, false);
  assert.equal(report.checks.electionAuthorization, false);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('production readiness accepts only the explicit durable production namespace', () => {
  const reference = {
    collection() { return reference; },
    doc() { return reference; },
  };
  const runtime = createElectionRuntime({
    env: {
      EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
      EMPLOYEE_DIRECTORY_SHEET_ID: 'sheet',
      EMPLOYEE_DIRECTORY_PEPPER: 'p'.repeat(32),
      ELECTION_GRANT_SECRET: 'g'.repeat(32),
      ELECTION_TIME_ZONE: 'Europe/Zurich',
      ELECTION_TRUST_PROXY_HOPS: '1',
      ELECTION_DATA_ENVIRONMENT: 'production',
    },
    firebaseDb: { collection: () => reference },
    directoryService: {
      getStatus: () => ({
        configured: true,
        sourceHealth: 'healthy',
        lastSuccessfulRefreshAt: '2026-09-01T00:00:00.000Z',
      }),
    },
  });
  const report = runtime.readiness();
  assert.equal(report.ready, true);
  assert.equal(report.dataEnvironment, 'production');
  assert.equal(report.checks.dataEnvironment, true);
  assert.equal(Object.hasOwn(report.checks, 'developmentIsolation'), false);
});

test('snapshotted eligibility survives later directory deactivation and removal', async () => {
  const { service } = serviceAt('2026-09-25T12:00:00Z');
  await service.current();
  directory.snapshot.employees[0].active = false;
  directory.snapshot.employees[0].canVote = false;
  const originalRecords = directory.snapshot.verifierRecords;
  directory.snapshot.verifierRecords = originalRecords.filter((record) => record.employeeId !== 'voter-1');
  try {
    assert.equal((await service.verify('SAL-1001')).code, 'VERIFIED');
  } finally {
    directory.snapshot.employees[0].active = true;
    directory.snapshot.employees[0].canVote = true;
    directory.snapshot.verifierRecords = originalRecords;
  }
});

test('explicit closed-month finalization works after calendar rollover and preserves ties', async () => {
  const store = new MemoryTestStore();
  const september = serviceAt('2026-09-25T12:00:00Z', store).service;
  const verified = await september.verify('SAL-1001');
  await september.submit(verified.authorization, {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  });
  const october = serviceAt('2026-10-02T12:00:00Z', store).service;
  const result = await october.finalize('2026-09');
  assert.equal(result.code, 'RESULTS_FINAL');
  assert.deepEqual(result.results.CUISINE.winnerEmployeeIds, ['chef-1']);
  assert.equal((await october.current()).election.monthKey, '2026-10');
});

test('submission rechecks authoritative time inside the transaction attempt', async () => {
  let now = new Date('2026-09-30T21:59:59.900Z');
  const store = new MemoryTestStore();
  const service = new ElectionService({
    store, directoryService: directory, siteId, timeZone: 'Europe/Zurich',
    pepper, grantSecret, now: () => now,
  });
  const verified = await service.verify('SAL-1001');
  const originalSubmit = store.submit.bind(store);
  store.submit = (args) => {
    now = new Date('2026-09-30T22:00:00.000Z');
    return originalSubmit(args);
  };
  await assert.rejects(service.submit(verified.authorization, {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  }), (error) => error.code === 'ELECTION_NOT_OPEN');
  assert.equal(store.ballots.length, 0);
});

test('HTTP operations are no-store, generic on failure, and never echo credentials', async (t) => {
  const { service } = serviceAt('2026-09-25T12:00:00Z');
  const app = express();
  createElectionRuntime({ env: {}, firebaseDb: null, directoryService: null, electionService: service }).mount(app);
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const rejected = await fetch(`${base}/api/v1/public/election/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ salaireId: 'not-a-real-id' }),
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await rejected.json(), { code: 'INVALID_CREDENTIALS' });

  const accepted = await fetch(`${base}/api/v1/public/election/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ salaireId: 'SAL-1001' }),
  });
  const body = await accepted.json();
  assert.equal(accepted.status, 200);
  assert.equal(body.code, 'VERIFIED');
  assert.equal(JSON.stringify(body).includes('SAL-1001'), false);
  assert.equal(Object.hasOwn(body, 'employeeId'), false);

  const oversized = await fetch(`${base}/api/v1/public/election/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ salaireId: 'x'.repeat(17000) }),
  });
  assert.equal(oversized.status, 413);
});

test('network throttling keys use coarse proxy-resolved prefixes', () => {
  assert.equal(networkKey({ ip: '203.0.113.47' }), '203.0.113.0/24');
  assert.equal(networkKey({ ip: '2001:db8:abcd:12:1234:5678:9abc:def0' }), '2001:db8:abcd:12::/64');
  assert.equal(networkKey({ ip: '2001:db8::1' }), '2001:db8:0:0::/64');
  assert.equal(networkKey({ ip: '2001:db8::2' }), '2001:db8:0:0::/64');
});

test('post-commit audit failure cannot turn a stored vote into a failed response', async () => {
  const { service, store } = serviceAt('2026-09-25T12:00:00Z');
  const verified = await service.verify('SAL-1001');
  store.audit = async () => { throw new Error('audit unavailable'); };
  const result = await service.submit(verified.authorization, {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  });
  assert.deepEqual(result, { code: 'SUBMITTED' });
  assert.equal(store.ballots.length, 1);
  assert.deepEqual(await service.submit(verified.authorization, {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: { CUISINE: 'Excellent collègue', SERVICE: 'Service remarquable' },
  }), { code: 'SUBMITTED', replayed: true });
});