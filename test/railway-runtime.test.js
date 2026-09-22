const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  APPROVED_RAILWAY_CANONICAL_ORIGIN,
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

test('production configuration accepts only the exact approved Railway origin', () => {
  assert.equal(
    parseCanonicalOrigin(APPROVED_RAILWAY_CANONICAL_ORIGIN),
    APPROVED_RAILWAY_CANONICAL_ORIGIN,
  );
  assert.equal(
    validateProductionConfig(productionEnv({
      APP_CANONICAL_ORIGIN: APPROVED_RAILWAY_CANONICAL_ORIGIN,
    })).canonicalOrigin,
    APPROVED_RAILWAY_CANONICAL_ORIGIN,
  );

  for (const rejected of [
    'http://infosmolinomolard-production.up.railway.app',
    'https://other-production.up.railway.app',
    'https://infosmolinomolard-production.up.railway.app.',
    'https://*.up.railway.app',
    'https://infosmolinomolard-production.up.railway.app:444',
    'https://infosmolinomolard-production.up.railway.app:443',
    'https://infosmolinomolard-production.up.railway.app/path',
    'https://infosmolinomolard-production.up.railway.app?query=1',
    'https://infosmolinomolard-production.up.railway.app#fragment',
    'https://user@infosmolinomolard-production.up.railway.app',
    ' https://infosmolinomolard-production.up.railway.app',
    'https://localhost',
    'https://127.0.0.1',
    'not-an-origin',
  ]) {
    assert.throws(
      () => parseCanonicalOrigin(rejected),
      /exact HTTPS custom origin/,
      rejected,
    );
  }
});

test('deployment manifest declares Node, build, start, and liveness contract', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const railway = JSON.parse(fs.readFileSync(path.join(root, 'railway.json'), 'utf8'));
  const runtimePackages = ['exceljs', 'express', 'firebase-admin', 'google-auth-library', 'sharp'];
  const developmentPackages = ['@firebase/rules-unit-testing', 'firebase', 'ws'];
  assert.equal(manifest.engines.node, '20.x');
  assert.equal(manifest.scripts.start, 'node server.js');
  assert.equal(railway.build.buildCommand, 'npm run build');
  assert.equal(railway.deploy.healthcheckPath, '/healthz');
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), runtimePackages);
  assert.deepEqual(Object.keys(manifest.devDependencies).sort(), developmentPackages);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
    /package-firewall\.replit\.internal|"resolved":/,
  );
  const deploymentManifest = fs.readFileSync(
    path.join(root, 'docs', 'railway-deployment-manifest.md'),
    'utf8',
  );
  assert.match(deploymentManifest, new RegExp(APPROVED_RAILWAY_CANONICAL_ORIGIN));
  assert.doesNotMatch(deploymentManifest, /\*\.railway\.app|wildcard allowance/i);
});

test('liveness payload is minimal and unsafe legacy routes are production-disabled', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /app\.get\('\/healthz'/);
  assert.match(source, /json\(\{ status: 'ok' \}\)/);
  assert.match(source, /runtimeConfig\.production && unsafeLegacyPrefixes/);
  assert.doesNotMatch(source.match(/app\.get\('\/healthz'[\s\S]*?\n\}\);/)[0], /firebase|employee|election|secret/i);
});

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Production-pruned server exited with code ${child.exitCode}`);
    try {
      await request(port, '/healthz');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Production-pruned server did not become ready');
}

test('production-pruned install starts and serves the Railway route contract', { timeout: 120000 }, async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molard-production-install-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.cpSync(root, temporaryRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(root, source);
      return !relative.startsWith('.git') &&
        !relative.startsWith('node_modules') &&
        !relative.startsWith('.agents') &&
        !relative.startsWith('.local');
    },
  });

  const install = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts=false'], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_replace_registry_host: 'always',
    },
    encoding: 'utf8',
    timeout: 90000,
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  for (const packageName of ['exceljs', 'express', 'firebase-admin', 'google-auth-library', 'sharp']) {
    assert.doesNotThrow(() => require.resolve(packageName, { paths: [temporaryRoot] }));
  }
  for (const packageName of ['@firebase/rules-unit-testing', 'firebase', 'ws']) {
    assert.throws(() => require.resolve(packageName, { paths: [temporaryRoot] }), { code: 'MODULE_NOT_FOUND' });
  }

  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: temporaryRoot,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), FIREBASE_SERVICE_ACCOUNT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });

  await waitForServer(port, child);
  const expectations = [
    ['/healthz', 200],
    ['/readyz', 503],
    ['/', 200],
    ['/collaborateur-du-mois', 200],
    ['/administration', 503],
  ];
  for (const [requestPath, status] of expectations) {
    const response = await request(port, requestPath);
    assert.equal(response.statusCode, status, requestPath);
  }
  assert.doesNotMatch(output, /MODULE_NOT_FOUND|Cannot find module/);
});