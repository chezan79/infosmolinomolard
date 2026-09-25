const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');
const { createAdministrationPageAuthorization } = require('../employee-directory/auth');
const { mountAdministrationMonitoringPage } = require('../administration-monitoring-page');
const { mountPublicFiles } = require('../public-files');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'private-pages/suivi-du-vote.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'suivi-du-vote.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'suivi-du-vote.css'), 'utf8');
const sample = {
  month: '2026-09',
  status: 'OPEN',
  window: { opensAt: '2026-09-24T22:00:00.000Z', closesAt: '2026-09-30T22:00:00.000Z' },
  eligibleVoters: 49,
  participation: { count: 1, remaining: 48, percentage: 2.04 },
  systemHealth: { participationRecords: 1, anonymousBallots: 1, consistency: 'OK' },
};

function element() {
  return {
    hidden: false, disabled: false, textContent: '', className: '', style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this[name] = handler; },
  };
}

function fixture(fetchImpl) {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const nodes = Object.fromEntries(ids.map((id) => [id, element()]));
  nodes.dashboard.hidden = true;
  nodes.message.hidden = true;
  nodes.retry.hidden = true;
  const requests = [];
  const redirects = [];
  const fetch = (...args) => {
    requests.push(args);
    return fetchImpl(...args);
  };
  vm.runInNewContext(script, {
    document: { getElementById: (id) => nodes[id] },
    fetch,
    location: { replace: (url) => redirects.push(url) },
    Intl, Date, Number, Object, String,
  }, { filename: 'suivi-du-vote.js' });
  return { nodes, requests, redirects };
}

function response(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('aggregate fields drive month, window, four KPIs, accessible progress, consistency and sealed results', async () => {
  const { nodes, requests } = fixture(async () => response({
    ...sample, ballotId: 'private-ballot', salaireId: 'SAL-SECRET',
    participation: { ...sample.participation, voterId: 'private-voter' },
    systemHealth: { ...sample.systemHealth, selections: 'private-selection' },
    comments: 'private-comment', ranking: 'private-ranking',
  }));
  assert.equal(nodes.loading.hidden, false);
  assert.equal(nodes.eligible.textContent, '');
  await settle();
  assert.equal(nodes.dashboard.hidden, false);
  assert.match(nodes.month.textContent, /septembre 2026/i);
  assert.equal(nodes['election-status'].textContent, 'Vote ouvert');
  assert.match(nodes.window.textContent, /25 septembre 2026 au 30 septembre 2026/);
  for (const [id, expected] of Object.entries({
    eligible: '49', voted: '1', remaining: '48', percentage: '2,04 %',
    records: '1', ballots: '1', consistency: 'Système cohérent',
    'progress-count': '1 / 49', 'progress-label': '2,04 %',
  })) assert.equal(nodes[id].textContent, expected, id);
  assert.equal(nodes.progress.attributes['aria-valuenow'], '2.04');
  assert.match(nodes.progress.attributes['aria-valuetext'], /1 sur 49/);
  assert.equal(nodes['progress-fill'].style.width, '2.04%');
  assert.equal(nodes['results-state'].textContent, '🔒 Résultats masqués');
  assert.deepEqual(requests.map(([url, options]) => [url, options.method, options.credentials, options.cache]),
    [['/api/v1/management/election-monitoring', 'GET', 'same-origin', 'no-store']]);
  const rendered = Object.values(nodes).map((node) => node.textContent).join(' ');
  for (const privateValue of ['private-', 'SAL-SECRET', 'ranking', 'comment', 'selection', 'voterId']) {
    assert.equal(rendered.includes(privateValue), false, privateValue);
  }
});

test('upcoming and closed states retain result secrecy and use API window, not hardcoded month', async () => {
  for (const status of ['UPCOMING', 'CLOSED']) {
    const data = { ...sample, month: '2026-12', status,
      window: { opensAt: '2026-12-24T23:00:00.000Z', closesAt: '2026-12-31T23:00:00.000Z' } };
    const { nodes } = fixture(async () => response(data));
    await settle();
    assert.match(nodes.month.textContent, /décembre 2026/i);
    assert.match(nodes.window.textContent, /25 décembre 2026 au 31 décembre 2026/);
    assert.equal(nodes['election-status'].textContent, status === 'UPCOMING' ? 'Vote à venir' : 'Vote clôturé');
    assert.match(nodes['results-explanation'].textContent,
      status === 'UPCOMING' ? /masqués jusqu’à la clôture/ : /ne fournit pas encore les résultats définitifs/);
    assert.equal(nodes.dashboard.hidden, false);
  }
});

test('anomalies are explicit, including mismatched counts despite reported OK', async () => {
  for (const health of [
    { participationRecords: 1, anonymousBallots: 0, consistency: 'ANOMALY' },
    { participationRecords: 1, anonymousBallots: 0, consistency: 'OK' },
  ]) {
    const { nodes } = fixture(async () => response({ ...sample, systemHealth: health }));
    await settle();
    assert.equal(nodes.consistency.textContent, 'Anomalie détectée');
    assert.equal(nodes.consistency.className, 'anomaly');
  }
});

test('loading, refresh, failure and retry never convert unknown data to zero or retain stale counts', async () => {
  const pending = [];
  const { nodes, requests } = fixture(() => new Promise((resolve) => pending.push(resolve)));
  assert.equal(nodes.dashboard.hidden, true);
  assert.equal(nodes.loading.hidden, false);
  assert.equal(nodes.eligible.textContent, '');
  pending.shift()(response(sample));
  await settle();
  nodes.refresh.click();
  assert.equal(nodes.dashboard.hidden, false);
  assert.equal(nodes.dashboard.attributes['aria-busy'], 'true');
  assert.match(nodes['refresh-status'].textContent, /Actualisation/);
  assert.equal(nodes.refresh.disabled, true);
  nodes.refresh.click();
  assert.equal(requests.length, 2, 'concurrent refresh is ignored');
  pending.shift()(response({ error: 'MONITORING_UNAVAILABLE' }, 503));
  await settle();
  assert.equal(nodes.dashboard.hidden, true);
  assert.match(nodes['message-text'].textContent, /momentanément indisponibles/);
  assert.equal(nodes.retry.hidden, false);
  nodes.retry.click();
  pending.shift()(response({ ...sample, participation: { count: 2, remaining: 47, percentage: 4.08 } }));
  await settle();
  assert.equal(nodes.dashboard.hidden, false);
  assert.equal(nodes.voted.textContent, '2');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(([, options]) => options.method === 'GET'));
});

test('missing election is distinct from unavailable and does not generate zero totals', async () => {
  const { nodes, requests } = fixture(async () => response({ error: 'ELECTION_NOT_FOUND' }, 404));
  await settle();
  assert.equal(nodes.dashboard.hidden, true);
  assert.equal(nodes['message-text'].textContent, 'Aucune élection active trouvée pour cette période.');
  assert.equal(nodes.retry.hidden, true);
  assert.equal(nodes.eligible.textContent, '');
  assert.equal(requests.length, 1);
});

test('authentication redirects by existing session and access-denied paths without exposing data', async () => {
  for (const [code, target] of [
    [401, '/gestion-photos-login.html?error=session'],
    [403, '/gestion-photos-login.html?error=access'],
  ]) {
    const { nodes, redirects } = fixture(async () => response({ error: 'DENIED' }, code));
    await settle();
    assert.deepEqual(redirects, [target]);
    assert.equal(nodes.dashboard.hidden, true);
  }
});

test('expired or forbidden session on refresh hides previously rendered figures immediately', async () => {
  for (const code of [401, 403]) {
    let calls = 0;
    const { nodes, redirects } = fixture(async () => response(
      ++calls === 1 ? sample : { error: 'DENIED' }, calls === 1 ? 200 : code,
    ));
    await settle();
    assert.equal(nodes.dashboard.hidden, false);
    nodes.refresh.click();
    await settle();
    assert.equal(nodes.dashboard.hidden, true);
    assert.equal(redirects.length, 1);
  }
});

test('malformed or malicious aggregate fails closed and never inserts markup', async () => {
  const { nodes } = fixture(async () => response({ ...sample, month: '<img src=x onerror=alert(1)>' }));
  await settle();
  assert.equal(nodes.dashboard.hidden, true);
  assert.equal(nodes.retry.hidden, false);
  assert.doesNotMatch(Object.values(nodes).map((n) => n.textContent).join(''), /<img/);
});

test('page markup and CSS support mobile, tablet, keyboard and read-only navigation', () => {
  const administration = fs.readFileSync(path.join(root, 'private-pages/administration.html'), 'utf8');
  assert.match(administration, /Photos collaborateurs/);
  assert.match(administration, /href="\/suivi-du-vote"/);
  assert.match(administration, /Suivre la participation et contrôler le bon fonctionnement du vote\./);
  assert.match(administration, /Ouvrir le dashboard/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /href="\/administration"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /<button id="refresh"/);
  assert.match(css, /max-width:800px/);
  assert.match(css, /max-width:600px/);
  assert.match(css, /minmax\(0,1fr\)/);
  assert.doesNotMatch(html + script, /firebase|firestore|\/api\/v1\/public\/election|<select|method:\s*'POST'/i);
  assert.equal((administration.match(/class="administration-card"/g) || []).length, 2);
});

test('actual monitoring page routes deny direct access without the exact admin session before static serving', async (t) => {
  const auth = createAdministrationPageAuthorization({
    siteId: 'molard', administratorUid: 'admin-uid',
    firebaseAuth: {
      async verifySessionCookie(cookie) {
        if (cookie === 'admin') return { uid: 'admin-uid', siteId: 'molard' };
        if (cookie === 'other') return { uid: 'not-admin', siteId: 'molard' };
        throw new Error('expired');
      },
    },
  });
  const app = express();
  mountAdministrationMonitoringPage(app, auth, root);
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/suivi-du-vote', '/suivi-du-vote.html']) {
    for (const [cookie, redirect] of [
      [null, '/gestion-photos-login.html'],
      ['other', '/gestion-photos-login.html?error=access'],
      ['invalid', '/gestion-photos-login.html?error=session'],
    ]) {
      const denied = await fetch(`${base}${route}`, { redirect: 'manual',
        headers: cookie ? { Cookie: `__session=${cookie}` } : {} });
      assert.equal(denied.status, 302);
      assert.equal(denied.headers.get('location'), redirect);
      assert.doesNotMatch(await denied.text(), /Contrôle du système/);
    }
    const authorized = await fetch(`${base}${route}`, { headers: { Cookie: '__session=admin' } });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get('cache-control'), 'no-store');
    assert.match(await authorized.text(), /Contrôle du système/);
  }
  for (const route of ['/private-pages/suivi-du-vote.html', '/public/../suivi-du-vote.html']) {
    const response = await fetch(`${base}${route}`, { redirect: 'manual' });
    assert.notEqual(response.status, 200);
  }
});