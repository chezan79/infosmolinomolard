// Pure metadata inspection: never calls Firestore, Auth, Storage or the network.
const EXPECTED = Object.freeze({
  firebaseAdminProjectId: 'infosmolinomoard',
  firestoreDatabaseId: '(default)',
  siteId: 'molard',
  dataEnvironment: 'production',
  nodeEnv: 'production',
  timeZone: 'Europe/Zurich',
  resultsProjectId: 'infosmolinomoard',
  resultsDatabaseId: '(default)',
  emulators: 'ABSENT',
});

function compare(actual, expected) {
  if (actual === undefined || actual === null || actual === '') return 'MISSING';
  return actual === expected ? 'MATCH' : 'MISMATCH';
}

function inspectOfficialRuntime(env, db) {
  let project, database, metadataAvailable = false;
  try {
    if (db) {
      project = db.projectId;
      database = db.databaseId;
      metadataAvailable = true;
    }
  } catch { /* Never return SDK exceptions or configuration values. */ }
  const checks = {
    firebaseAdminProjectId: metadataAvailable ? compare(project, EXPECTED.firebaseAdminProjectId) : 'UNAVAILABLE',
    firestoreDatabaseId: metadataAvailable ? compare(database, EXPECTED.firestoreDatabaseId) : 'UNAVAILABLE',
    siteId: compare(env.EMPLOYEE_DIRECTORY_SITE_ID, EXPECTED.siteId),
    dataEnvironment: compare(env.ELECTION_DATA_ENVIRONMENT, EXPECTED.dataEnvironment),
    nodeEnv: compare(env.NODE_ENV, EXPECTED.nodeEnv),
    timeZone: compare(env.ELECTION_TIME_ZONE, EXPECTED.timeZone),
    resultsProjectId: compare(env.ELECTION_RESULTS_PROJECT_ID, EXPECTED.resultsProjectId),
    resultsDatabaseId: compare(env.ELECTION_RESULTS_DATABASE_ID, EXPECTED.resultsDatabaseId),
    emulators: ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
      .some((key) => Boolean(env[key])) ? 'MISMATCH' : 'MATCH',
  };
  // Actual values are deliberately not reflected, even for ostensibly public
  // settings: a misconfigured variable or SDK getter may contain sensitive text.
  return {
    scope: 'OFFICIAL_PRODUCTION',
    status: Object.values(checks).every((status) => status === 'MATCH') ? 'VERIFIED' : 'BLOCKED',
    expected: { ...EXPECTED },
    checks,
    inspection: 'CLIENT_METADATA_AND_CONFIGURATION_ONLY',
  };
}

module.exports = { inspectOfficialRuntime, EXPECTED };
