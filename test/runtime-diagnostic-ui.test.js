const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { inspectOfficialRuntime } = require('../election-engine/runtime-diagnostic');
const script = fs.readFileSync('private-pages/runtime-diagnostic-admin.js', 'utf8');
function node() {
  return { textContent: '', disabled: false, children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(event, callback) { this[event] = callback; } };
}
function fixture(fetch) {
  const nodes = Object.fromEntries(['status', 'checks', 'refresh'].map((id) => [`runtime-diagnostic-${id}`, node()]));
  const redirects = [];
  vm.runInNewContext(script, { document: { getElementById: (id) => nodes[id], createElement: node },
    location: { replace: (url) => redirects.push(url) }, fetch, Object });
  return { nodes, redirects, run: () => nodes['runtime-diagnostic-refresh'].click() };
}
const report = inspectOfficialRuntime({
  NODE_ENV: 'production', ELECTION_DATA_ENVIRONMENT: 'production', EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
  ELECTION_TIME_ZONE: 'Europe/Zurich', ELECTION_RESULTS_PROJECT_ID: 'infosmolinomoard',
  ELECTION_RESULTS_DATABASE_ID: '(default)',
}, { projectId: 'infosmolinomoard', databaseId: '(default)' });
test('private diagnostic UI is opt-in, uses only same-origin GET and clears stale verification on failure', async () => {
  let calls = 0;
  const f = fixture(async (url, options) => {
    calls++;
    assert.equal(url, '/api/v1/management/election-runtime-diagnostic');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    return { ok: calls === 1, status: calls === 1 ? 200 : 503, json: async () => report };
  });
  assert.equal(calls, 0);
  await f.run();
  assert.equal(f.nodes['runtime-diagnostic-checks'].children.length, 9);
  assert.match(f.nodes['runtime-diagnostic-status'].textContent, /conforme/);
  await f.run();
  assert.equal(f.nodes['runtime-diagnostic-checks'].children.length, 0);
  assert.match(f.nodes['runtime-diagnostic-status'].textContent, /indisponible/);
});
test('unverified/malformed reports and expired sessions never create a false successful attestation', async () => {
  for (const payload of [{}, { ...report, checks: { ...report.checks, nodeEnv: 'MISMATCH' } },
    { ...report, status: 'BLOCKED', checks: { ...report.checks, nodeEnv: 'PRIVATE_UNEXPECTED' } }]) {
    const f = fixture(async () => ({ ok: true, status: 200, json: async () => payload }));
    await f.run();
    assert.equal(f.nodes['runtime-diagnostic-checks'].children.length, 0);
    assert.match(f.nodes['runtime-diagnostic-status'].textContent, /indisponible/);
    assert.equal(JSON.stringify(f.nodes).includes('PRIVATE_UNEXPECTED'), false);
  }
  for (const status of [401, 403]) {
    const f = fixture(async () => ({ ok: false, status }));
    await f.run();
    assert.match(f.redirects[0], /gestion-photos-login/);
  }
});
