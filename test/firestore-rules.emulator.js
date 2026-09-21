const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const admin = require('firebase-admin');
const { FirestoreElectionStore } = require('../election-engine/firestore-store');
const { electionState } = require('../election-engine/contract');

let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'employee-directory-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
  });
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