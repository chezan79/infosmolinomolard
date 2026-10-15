const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('private-pages/election-history.html', 'utf8');
const script = fs.readFileSync('private-pages/election-history-admin.js', 'utf8');
function element() {
  return { hidden: false, disabled: false, value: '', textContent: '', children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(event, callback) { this[event] = callback; } };
}
function fixture(fetchImpl) {
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], element()]));
  const requests = [], redirects = [];
  vm.runInNewContext(script, {
    document: { getElementById: (id) => nodes[id], createElement: element },
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); },
    location: { replace: (url) => redirects.push(url) }, Intl, Date, Number, Object, String,
  });
  return { nodes, requests, redirects };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (body, status = 200) => ({ status, ok: status === 200, json: async () => body });
const sample = {
  availableMonths: ['2026-10', '2026-09'], month: '2026-10', electionStatus: 'AVAILABLE',
  participation: { eligible: 2, submitted: 1, notSubmitted: 1, percentage: 50 },
  roster: { status: 'VERIFIABLE', voters: [
    { name: '<script>not executable</script>', department: 'Cuisine', hasVoted: true },
    { name: 'Bruno', department: 'Service', hasVoted: false },
  ] },
  results: { status: 'PUBLISHED', categories: {
    CUISINE: { outcome: 'WINNERS', winners: [{ name: 'Chef', role: '' }] },
    SERVICE: { outcome: 'NO_WINNER', winners: [] },
  } },
};

test('history renders both categories and named participation safely with same-origin GET only', async () => {
  const { nodes, requests } = fixture(async () => response(sample));
  await settle();
  assert.equal(nodes.dashboard.hidden, false);
  assert.equal(nodes.winners.children.length, 2);
  assert.equal(nodes['voter-list'].children.length, 2);
  assert.equal(nodes['voter-list'].children[0].children[0].children[0].textContent, '<script>not executable</script>');
  assert.equal(nodes.submitted.textContent, '1');
  assert.equal(nodes['not-submitted'].textContent, '1');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), ['/api/v1/management/election-history', {
    method: 'GET', credentials: 'same-origin', cache: 'no-store',
  }]);
});

test('switching to September clears stale winners and names immediately and never renders an unverifiable roster', async () => {
  const pending = [];
  const { nodes, requests } = fixture(() => new Promise((resolve) => pending.push(resolve)));
  pending.shift()(response(sample));
  await settle();
  nodes['month-select'].change({ target: { value: '2026-09' } });
  assert.equal(nodes['voter-list'].children.length, 0);
  assert.equal(nodes.winners.children.length, 0);
  assert.equal(nodes.dashboard.hidden, true);
  pending.shift()(response({ ...sample, month: '2026-09',
    roster: { status: 'UNVERIFIABLE', voters: sample.roster.voters },
    results: { status: 'NOT_PUBLISHED', categories: null } }));
  await settle();
  assert.equal(nodes['voter-list'].children.length, 0);
  assert.equal(nodes.winners.children.length, 0);
  assert.match(nodes['roster-state'].textContent, /non vérifiable/);
  assert.match(requests[1][0], /month=2026-09$/);
});

test('empty, failed, malformed and unauthorized responses do not reveal previous results or names', async () => {
  for (const [data, status] of [
    [{ availableMonths: [], month: null, electionStatus: 'NO_ELECTIONS' }, 200],
    [{}, 503], [{}, 404], [{}, 200], [{}, 401], [{}, 403],
  ]) {
    const { nodes, redirects } = fixture(async () => response(data, status));
    await settle();
    assert.equal(nodes['voter-list'].children.length, 0);
    assert.equal(nodes.winners.children.length, 0);
    if ([401, 403].includes(status)) assert.match(redirects[0], /gestion-photos-login/);
    else assert.equal(nodes.message.hidden, false);
  }
});
