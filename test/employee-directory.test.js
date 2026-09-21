const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerAuthorization } = require('../employee-directory/auth');
const {
  DEFAULT_PHOTO,
  MAX_DIRECTORY_ROWS,
  createSalaireVerifier,
  getCandidates,
  normalizeDirectory,
  serializeCandidate,
  validatePersistedSnapshot,
} = require('../employee-directory/contract');
const { createDirectoryRuntime } = require('../employee-directory');
const { FirestoreDirectoryStore } = require('../employee-directory/firestore-store');
const { GoogleSheetsDirectorySource, MAX_RESPONSE_BYTES } = require('../employee-directory/google-sheets-source');
const { EmployeeDirectoryService } = require('../employee-directory/service');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const HEADERS = [
  'Employee ID',
  'Salaire-ID',
  'Name',
  'Department',
  'Active',
  'Can Vote',
  'Can Be Elected',
  'Job Title',
  'Photo URL',
  'Site ID',
];
const OPTIONS = {
  siteId: 'molard',
  pepper: 'test-pepper-that-is-not-used-in-production',
  allowedPhotoOrigins: ['https://images.example.test'],
};

function validRows() {
  return [
    HEADERS,
    ['emp-1', 'SAL-1001', 'Anna Rossi', 'Cuisine', 'yes', 'yes', 'yes', 'Chef', 'https://images.example.test/anna.jpg', 'molard'],
    ['emp-2', 'SAL-1002', 'Luca Bianchi', 'Pizzeria', 'true', 'false', 'true', '', '', 'molard'],
    ['emp-3', 'SAL-1003', 'Mia Verdi', 'Service', '1', '1', '0', 'Serveuse', '/photos/mia.jpg', 'molard'],
  ];
}

test('normalizes departments, groups, flags and photo fallback', () => {
  const result = normalizeDirectory(validRows(), OPTIONS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.employees.map((employee) => employee.votingGroup), ['CUISINE', 'CUISINE', 'SERVICE']);
  assert.equal(result.employees[1].canVote, false);
  assert.equal(result.employees[1].canBeElected, true);
  assert.equal(result.employees[1].photoUrl, DEFAULT_PHOTO);
  assert.ok(result.warnings.some((warning) => warning.code === 'MISSING_JOB_TITLE'));
  assert.ok(result.warnings.some((warning) => warning.code === 'MISSING_PHOTO'));
});

test('privacy-safe status includes validation and eligibility aggregates', () => {
  const normalized = normalizeDirectory(validRows(), OPTIONS);
  const service = new EmployeeDirectoryService({ source: null, store: null, ...OPTIONS });
  service.snapshot = {
    schemaVersion: 1,
    siteId: OPTIONS.siteId,
    sourceGeneration: 1,
    refreshedAt: '2026-09-01T00:00:00.000Z',
    employees: normalized.employees,
    verifierRecords: normalized.verifierRecords,
    warnings: normalized.warnings,
  };
  const status = service.getStatus();
  assert.equal(status.counts.rows, 3);
  assert.equal(status.counts.departments.Pizzeria, 1);
  assert.equal(status.counts.candidateOnly, 1);
  assert.equal(status.counts.voterOnly, 1);
  assert.equal(status.counts.fallbackAvatars, 1);
  assert.equal(JSON.stringify(status).includes('SAL-100'), false);
  assert.equal(JSON.stringify(status).includes('verifier'), false);
});

test('candidate model keeps voting and election eligibility separate', () => {
  const result = normalizeDirectory(validRows(), OPTIONS);
  const candidates = getCandidates(result.employees);
  assert.deepEqual(candidates.map((candidate) => candidate.employeeId), ['emp-1', 'emp-2']);
  assert.equal(candidates.some((candidate) => candidate.employeeId === 'emp-3'), false);
});

test('rejects duplicate employee IDs and duplicate Salaire-IDs', () => {
  const rows = validRows();
  rows.push(['emp-1', 'SAL-1002', 'Duplicate', 'Service', 'yes', 'yes', 'yes', '', '', 'molard']);
  const result = normalizeDirectory(rows, OPTIONS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_EMPLOYEE_ID'));
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_SALAIRE_ID'));
});

test('rejects malformed rows, unknown departments, invalid flags and cross-site rows', () => {
  const rows = [
    HEADERS,
    ['bad id!', 'x', '', 'Office', 'maybe', 'yes', 'yes', '', 'javascript:alert(1)', 'other-site'],
  ];
  const result = normalizeDirectory(rows, OPTIONS);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  for (const code of ['INVALID_EMPLOYEE_ID', 'INVALID_SALAIRE_ID', 'MISSING_NAME', 'UNKNOWN_DEPARTMENT', 'INVALID_FLAG', 'SITE_MISMATCH']) {
    assert.ok(codes.has(code), `expected ${code}`);
  }
});

test('rejects a directory larger than the bounded snapshot policy', () => {
  const row = ['emp-1', 'SAL-1001', 'Anna Rossi', 'Cuisine', 'yes', 'yes', 'yes', 'Chef', '', 'molard'];
  const rows = [HEADERS, ...Array.from({ length: MAX_DIRECTORY_ROWS + 1 }, () => row)];
  const result = normalizeDirectory(rows, OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'TOO_MANY_ROWS');
});

test('safe candidate serialization cannot expose verifier or private flags', () => {
  const employee = {
    ...normalizeDirectory(validRows(), OPTIONS).employees[0],
    salaireId: 'must-not-leak',
    verifier: 'must-not-leak',
  };
  const serialized = serializeCandidate(employee);
  const json = JSON.stringify(serialized);
  assert.equal(json.includes('must-not-leak'), false);
  assert.equal(Object.hasOwn(serialized, 'canVote'), false);
  assert.deepEqual(Object.keys(serialized).sort(), [
    'department',
    'displayName',
    'employeeId',
    'jobTitle',
    'photoUrl',
    'votingGroup',
  ]);
});

test('Salaire-ID verifier is deterministic and does not contain plaintext', () => {
  const first = createSalaireVerifier('SAL-1001', OPTIONS.pepper);
  const second = createSalaireVerifier('SAL-1001', OPTIONS.pepper);
  assert.equal(first, second);
  assert.equal(first.includes('SAL-1001'), false);
});

test('invalid refresh preserves the last-known-good snapshot', async () => {
  const saved = [];
  const source = {
    calls: 0,
    async load() {
      this.calls += 1;
      if (this.calls === 1) return validRows();
      return [HEADERS, ['broken']];
    },
  };
  const store = {
    async load() { return null; },
    async replaceFromSource(build) {
      const snapshot = { ...(await build()), sourceGeneration: saved.length + 1 };
      saved.push(snapshot);
      return snapshot;
    },
  };
  const service = new EmployeeDirectoryService({ source, store, ...OPTIONS });
  await service.refresh();
  const firstCandidates = service.getCandidates();
  await assert.rejects(service.refresh(), /validation failed/);
  assert.deepEqual(service.getCandidates(), firstCandidates);
  assert.equal(saved.length, 1);
  assert.equal(service.getStatus().sourceHealth, 'invalid');
});

test('overlong public fields are rejected before replacing durable last-known-good data', async () => {
  let durableSnapshot = null;
  const valid = validRows();
  const invalid = validRows();
  invalid[1][2] = 'A'.repeat(161);
  const source = {
    calls: 0,
    async load() {
      this.calls += 1;
      return this.calls === 1 ? valid : invalid;
    },
  };
  const store = {
    async load() { return durableSnapshot; },
    async replaceFromSource(build) {
      const candidate = await build();
      durableSnapshot = { ...candidate, sourceGeneration: (durableSnapshot?.sourceGeneration || 0) + 1 };
      return durableSnapshot;
    },
  };
  const service = new EmployeeDirectoryService({ source, store, ...OPTIONS });
  await service.refresh();
  const firstSnapshot = durableSnapshot;
  await assert.rejects(service.refresh(), /validation failed/);
  assert.equal(durableSnapshot, firstSnapshot);
  assert.equal(service.snapshot, firstSnapshot);
});

test('source failure loads and retains a stored snapshot', async () => {
  const normalized = normalizeDirectory(validRows(), OPTIONS);
  const stored = {
    schemaVersion: 1,
    siteId: OPTIONS.siteId,
    sourceGeneration: 1,
    refreshedAt: '2026-01-01T00:00:00.000Z',
    employees: normalized.employees,
    verifierRecords: normalized.verifierRecords,
    warnings: [],
  };
  const service = new EmployeeDirectoryService({
    source: { async load() { throw new Error('temporary outage'); } },
    store: {
      async load() { return stored; },
      async replaceFromSource(build) { return build(); },
    },
    ...OPTIONS,
  });
  await service.initialize();
  assert.equal(service.getCandidates().length, 2);
  assert.equal(service.getStatus().sourceHealth, 'unavailable');
  assert.equal(service.getStatus().lastSuccessfulRefreshAt, stored.refreshedAt);
});

test('rejects malformed or cross-site persisted snapshots at startup', async () => {
  const normalized = normalizeDirectory(validRows(), OPTIONS);
  const stored = {
    schemaVersion: 1,
    siteId: OPTIONS.siteId,
    sourceGeneration: 1,
    refreshedAt: '2026-01-01T00:00:00.000Z',
    employees: normalized.employees.map((employee, index) =>
      index === 0 ? { ...employee, siteId: 'other-site' } : employee,
    ),
    verifierRecords: normalized.verifierRecords,
    warnings: [],
  };
  assert.equal(validatePersistedSnapshot(stored, OPTIONS).ok, false);
  const service = new EmployeeDirectoryService({
    source: null,
    store: { async load() { return stored; } },
    ...OPTIONS,
  });
  await service.initialize();
  assert.equal(service.snapshot, null);
  assert.equal(service.getStatus().sourceHealth, 'snapshot_invalid');
});

test('coalesces overlapping refreshes in one process', async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = new EmployeeDirectoryService({
    source: { async load() { loads += 1; await gate; return validRows(); } },
    store: {
      async load() { return null; },
      async replaceFromSource(build) { return { ...(await build()), sourceGeneration: 1 }; },
    },
    ...OPTIONS,
  });
  const first = service.refresh();
  const second = service.refresh();
  release();
  await Promise.all([first, second]);
  assert.equal(loads, 1);
});

test('Firestore store serializes the source read and commit under a distributed lease', async () => {
  let currentData = { sourceGeneration: 4 };
  const db = {
    collection() { return { doc() { return { path: 'snapshot' }; } }; },
    async runTransaction(callback) {
      return callback({
        async get() { return { exists: true, data: () => currentData }; },
        set(_ref, value, options) {
          currentData = options?.merge ? { ...currentData, ...value } : value;
        },
      });
    },
  };
  const store = new FirestoreDirectoryStore(db, 'molard');
  let builtWhileLeaseHeld = false;
  const result = await store.replaceFromSource(async () => {
    builtWhileLeaseHeld = Boolean(currentData.refreshLease?.token);
    return { schemaVersion: 1, siteId: 'molard', marker: 'fresh' };
  });
  assert.equal(builtWhileLeaseHeld, true);
  assert.equal(result.sourceGeneration, 5);
  assert.equal(currentData.refreshLease, undefined);
  assert.equal(currentData.marker, 'fresh');
});

test('does not configure Google publication without Firestore persistence', () => {
  const runtime = createDirectoryRuntime({
    env: {
      EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
      EMPLOYEE_DIRECTORY_SHEET_ID: 'private-id',
      EMPLOYEE_DIRECTORY_PEPPER: 'private-pepper',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'x@example.test', private_key: 'key' }),
    },
    firebaseDb: null,
    firebaseAuth: null,
  });
  assert.equal(runtime.service.getStatus().configured, false);
});

test('full directory is not public and manager status enforces tenant authorization', async (t) => {
  const normalized = normalizeDirectory(validRows(), OPTIONS);
  const firebaseAuth = {
    async verifyIdToken(token) {
      if (token === 'allowed') return { uid: 'u1', siteId: 'molard', role: 'manager' };
      return { uid: 'u2', siteId: 'other', role: 'manager' };
    },
  };
  const runtime = createDirectoryRuntime({
    env: { EMPLOYEE_DIRECTORY_SITE_ID: 'molard' },
    firebaseDb: null,
    firebaseAuth,
  });
  runtime.service.snapshot = {
    schemaVersion: 1,
    siteId: 'molard',
    sourceGeneration: 1,
    refreshedAt: '2026-01-01T00:00:00.000Z',
    employees: normalized.employees,
    verifierRecords: normalized.verifierRecords,
    warnings: [],
  };
  const app = express();
  runtime.mount(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const candidatesResponse = await fetch(`${base}/api/v1/employee-directory/candidates`);
  assert.equal(candidatesResponse.status, 404);

  const denied = await fetch(`${base}/api/v1/management/employee-directory/status`, {
    headers: { Authorization: 'Bearer denied' },
  });
  assert.equal(denied.status, 403);
  const allowed = await fetch(`${base}/api/v1/management/employee-directory/status`, {
    headers: { Authorization: 'Bearer allowed' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.stringify(await allowed.json()).includes('verifier'), false);
});

test('Google source rejects oversized responses before parsing', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), {
    status: 200,
    headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
  });
  const source = Object.create(GoogleSheetsDirectorySource.prototype);
  Object.assign(source, {
    auth: { async getAccessToken() { return { token: 'redacted' }; } },
    spreadsheetId: 'private',
    range: 'Employees!A:J',
    timeoutMs: 1000,
  });
  await assert.rejects(source.load(), /too large/);
});

test('Firestore rules deny browser access to directory snapshots', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.ok(rules.includes('match /employeeDirectorySnapshots/{siteId}'));
  assert.match(rules, /allow read, write: if false/);
  assert.ok(rules.includes('match /electionSites/{document=**}'));
  for (const collection of ['planning', 'enrollments', 'trainings']) {
    assert.ok(rules.includes(`match /${collection}/{document=**}`));
  }
});

test('persisted snapshot rejects object-valued public fields and invalid generation', () => {
  const normalized = normalizeDirectory(validRows(), OPTIONS);
  const snapshot = {
    schemaVersion: 1,
    siteId: 'molard',
    sourceGeneration: 0,
    refreshedAt: 'not-an-iso-date',
    employees: normalized.employees.map((employee, index) =>
      index === 0 ? { ...employee, jobTitle: { verifier: 'must-not-leak' } } : employee,
    ),
    verifierRecords: normalized.verifierRecords,
    warnings: [],
  };
  const result = validatePersistedSnapshot(snapshot, OPTIONS);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has('INVALID_SNAPSHOT_EMPLOYEE'));
  assert.ok(codes.has('INVALID_SNAPSHOT_GENERATION'));
  assert.ok(codes.has('INVALID_SNAPSHOT_DATE'));
});

test('manager authorization enforces role and site isolation', async () => {
  function response() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }
  const req = { get: () => 'Bearer token' };
  let nextCalled = false;
  const allowed = createManagerAuthorization({
    siteId: 'molard',
    firebaseAuth: { async verifyIdToken() { return { uid: 'u1', siteId: 'molard', role: 'manager' }; } },
  });
  await allowed(req, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const deniedResponse = response();
  const denied = createManagerAuthorization({
    siteId: 'molard',
    firebaseAuth: { async verifyIdToken() { return { uid: 'u2', siteId: 'other', role: 'manager' }; } },
  });
  await denied(req, deniedResponse, () => assert.fail('must not authorize'));
  assert.equal(deniedResponse.statusCode, 403);
  assert.deepEqual(deniedResponse.body, { error: 'FORBIDDEN' });
});