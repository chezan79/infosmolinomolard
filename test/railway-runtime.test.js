const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  parseCanonicalOrigin,
  parsePort,
  validateProductionConfig,
} = require('../production-config');

const root = path.join(__dirname, '..');
const secret = 'x'.repeat(32);

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PORT: '8080',
    APP_CANONICAL_ORIGIN: 'https://infos.example.ch',
    ELECTION_DATA_ENVIRONMENT: 'production',
    ELECTION_GRANT_SECRET: secret,
    ELECTION_TIME_ZONE: 'Europe/Zurich',
    ELECTION_TRUST_PROXY_HOPS: '1',
    EMPLOYEE_DIRECTORY_PEPPER: secret,
    EMPLOYEE_DIRECTORY_SHEET_ID: 'sheet-id',
    EMPLOYEE_DIRECTORY_SHEET_RANGE: 'Collaborateurs!A:M',
    EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: 'example',
      client_email: 'server@example.test',
      private_key: 'not-a-real-key',
    }),
    FIREBASE_STORAGE_BUCKET: 'example.appspot.com',
    MOLARD_ADMIN_FIREBASE_UID: 'administrator',
    SESSION_SECRET: secret,
    apiKey: 'public-client-id',
    appId: 'public-app-id',
    authDomain: 'example.firebaseapp.com',
    projectId: 'example',
    storageBucket: 'example.appspot.com',
    ...overrides,
  };
}

test('Railway runtime uses a validated dynamic port and public bind address', () => {
  assert.equal(parsePort('3210'), 3210);
  assert.throws(() => parsePort('0'), /PORT/);
  const config = validateProductionConfig(productionEnv());
  assert.equal(config.port, 8080);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.trustProxyHops, 1);
});

test('production configuration rejects missing, development, emulator, and temporary origins', () => {
  assert.throws(() => validateProductionConfig(productionEnv({ SESSION_SECRET: '' })), /SESSION_SECRET/);
  assert.throws(() => validateProductionConfig(productionEnv({ ELECTION_DATA_ENVIRONMENT: 'development' })), /must equal production/);
  assert.throws(() => validateProductionConfig(productionEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })), /forbidden/);
  assert.throws(() => parseCanonicalOrigin('https://example.up.railway.app'), /custom origin/);
  assert.throws(() => parseCanonicalOrigin('http://infos.example.ch'), /HTTPS/);
});

test('deployment manifest declares Node, build, start, and liveness contract', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const railway = JSON.parse(fs.readFileSync(path.join(root, 'railway.json'), 'utf8'));
  assert.equal(manifest.engines.node, '20.x');
  assert.equal(manifest.scripts.start, 'node server.js');
  assert.equal(railway.build.buildCommand, 'npm run build');
  assert.equal(railway.deploy.healthcheckPath, '/healthz');
});

test('liveness payload is minimal and unsafe legacy routes are production-disabled', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /app\.get\('\/healthz'/);
  assert.match(source, /json\(\{ status: 'ok' \}\)/);
  assert.match(source, /runtimeConfig\.production && unsafeLegacyPrefixes/);
  assert.doesNotMatch(source.match(/app\.get\('\/healthz'[\s\S]*?\n\}\);/)[0], /firebase|employee|election|secret/i);
});