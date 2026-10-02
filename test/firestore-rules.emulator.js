const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getBytes, ref, uploadBytes } = require('firebase/storage');
const admin = require('firebase-admin');
const { FirestoreElectionStore } = require('../election-engine/firestore-store');
const { electionState } = require('../election-engine/contract');
const { FirestoreResultsStore } = require('../election-engine/results-store');
const { ElectionResultsService } = require('../election-engine/results-service');
const { fixture } = require('./helpers/results-fixture');

let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'employee-directory-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
    storage: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8'),
    },
  });
});

test('blocks every browser role from employee portrait objects', async () => {
  for (const context of [
    environment.unauthenticatedContext(),
    environment.authenticatedContext('manager', { siteId: 'molard', role: 'manager' }),
    environment.authenticatedContext('other-manager', { siteId: 'other', role: 'manager' }),
  ]) {
    const object = ref(context.storage(), 'employee-photos/molard/emp-1/portrait.webp');
    await assertFails(uploadBytes(object, Buffer.from('not-an-image'), { contentType: 'image/webp' }));
    await assertFails(getBytes(object));
    const winner = ref(context.storage(), 'published-winner-photos/molard/production/fixture.webp');
    await assertFails(uploadBytes(winner, Buffer.from('not-an-image'), { contentType: 'image/webp' }));
    await assertFails(getBytes(winner));
  }
});

test('blocks direct browser reads and writes of result snapshots, pointers, operations, and heartbeat', async () => {
  for (const context of [environment.unauthenticatedContext(),
    environment.authenticatedContext('admin', { siteId: 'molard', role: 'manager' })]) {
    for (const suffix of [
      'elections/2100-10/publication/public',
      'elections/2100-10/resultInternals/final',
      'elections/2100-10/resultOperations/state',
      'publicationState/latest', 'publicationState/worker',
    ]) {
      const document = doc(context.firestore(), `electionSites/molard/dataEnvironments/development/${suffix}`);
      await assertFails(getDoc(document));
      await assertFails(setDoc(document, { unsafe: true }));
    }
  }
});

test('real isolated Firestore transactions finalize and publish idempotently with concurrent workers', async () => {
  const f = fixture({ month: '2100-10', now: '2100-11-01T02:00:00Z' });
  const app = admin.initializeApp({ projectId: 'employee-directory-rules-test' }, 'results-fixture');
  const db = app.firestore();
  // The demo/emulator environment is established by the emulator runner, never a live project.
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  for (const [path, data] of f.db.docs) await db.doc(path).set(data);
  const binding = { ...f.binding, projectId: 'employee-directory-rules-test' };
  const store = new FirestoreResultsStore(db, binding);
  const service = new ElectionResultsService({ store, binding, enabled: true, automationEnabled: true, now: f.now });
  await Promise.all([service.processMonth(f.month), service.processMonth(f.month)]);
  const first = await service.latest();
  assert.equal(first.month, '2100-10');
  assert.equal(first.categories.CUISINE.winners.length, 2);
  const publication = await store.publication(f.month).get();
  const updateTime = publication.updateTime.toMillis();
  await service.processMonth(f.month, { recovery: true });
  assert.deepEqual(await service.latest(), first);
  assert.equal((await store.publication(f.month).get()).updateTime.toMillis(), updateTime);
});

test.after(async () => {
  await Promise.all(admin.apps.map((app) => app.delete()));
  if (environment) await environment.cleanup();
});

test('blocks unauthenticated browser access to server-managed collections', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'employeeDirectorySnapshots', 'molard')));
  await assertFails(getDoc(doc(database, 'electionSites', 'molard')));
  await assertFails(setDoc(doc(database, 'electionSites', 'molard', 'elections', '2026-09'), { unsafe: true }));

  for (const collection of ['planning', 'enrollments', 'trainings']) {
    const reference = doc(database, collection, 'compatibility-check');
    await assertFails(setDoc(reference, { ok: true }));
    await assertFails(getDoc(reference));
  }
});

test('Firestore transaction creates one anonymous ballot for simultaneous submissions', async () => {
  const app = admin.initializeApp({ projectId: 'employee-directory-rules-test' }, 'election-transaction-test');
  const db = app.firestore();
  const store = new FirestoreElectionStore(db, 'molard', 'development');
  const electionRef = db.collection('electionSites').doc('molard')
    .collection('dataEnvironments').doc('development').collection('elections').doc('2026-09');
  await electionRef.set({
    schemaVersion: 1, siteId: 'molard', monthKey: '2026-09', timeZone: 'Europe/Zurich',
    opensAt: '2026-09-24T22:00:00.000Z', closesAt: '2026-09-30T22:00:00.000Z',
    voters: { voter: { employeeId: 'voter', votingGroup: 'CUISINE' } },
    candidates: {
      chef: { employeeId: 'chef', votingGroup: 'CUISINE' },
      server: { employeeId: 'server', votingGroup: 'SERVICE' },
    },
  });
  const expiresAtMs = Date.parse('2026-09-26T00:00:00.000Z');
  await Promise.all([
    electionRef.collection('grants').doc('grant-a').set({ hash: 'grant-a', siteId: 'molard', monthKey: '2026-09', employeeId: 'voter', expiresAtMs, consumed: false }),
    electionRef.collection('grants').doc('grant-b').set({ hash: 'grant-b', siteId: 'molard', monthKey: '2026-09', employeeId: 'voter', expiresAtMs, consumed: false }),
  ]);
  const submission = (grantHash) => store.submit({
    monthKey: '2026-09', grantHash, now: () => new Date('2026-09-25T12:00:00.000Z'),
    stateFor: electionState,
    ballot: {
      choices: { CUISINE: 'chef', SERVICE: 'server' },
      comments: { CUISINE: 'Excellent travail', SERVICE: 'Service remarquable' },
    },
  });
  const settled = await Promise.allSettled([submission('grant-a'), submission('grant-b')]);
  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  const participation = await electionRef.collection('participation').get();
  const ballots = await electionRef.collection('ballots').get();
  assert.equal(participation.size, 1);
  assert.equal(ballots.size, 1);
  assert.deepEqual(Object.keys(ballots.docs[0].data()).sort(), ['choices', 'comments', 'schemaVersion']);
});