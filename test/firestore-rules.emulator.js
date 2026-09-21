const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertFails,
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

test('blocks unauthenticated browser access to server-managed collections', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'employeeDirectorySnapshots', 'molard')));

  for (const collection of ['planning', 'enrollments', 'trainings']) {
    const reference = doc(database, collection, 'compatibility-check');
    await assertFails(setDoc(reference, { ok: true }));
    await assertFails(getDoc(reference));
  }
});