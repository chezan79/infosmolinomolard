const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

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
  if (environment) await environment.cleanup();
});

test('blocks directory snapshots while preserving existing client collections', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'employeeDirectorySnapshots', 'molard')));

  for (const collection of ['planning', 'enrollments', 'trainings']) {
    const reference = doc(database, collection, 'compatibility-check');
    await assertSucceeds(setDoc(reference, { ok: true }));
    const snapshot = await assertSucceeds(getDoc(reference));
    assert.equal(snapshot.data().ok, true);
  }
});