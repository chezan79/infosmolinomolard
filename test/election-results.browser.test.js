const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { fixture } = require('./helpers/results-fixture');
const { browserSession, waitFor } = require('./helpers/browser-session');
const { mountResultsApi } = require('../election-engine/results-runtime');
const { mountPublicFiles, mountPublicWinnersRoute } = require('../public-files');
const { createAdministrationPageAuthorization, createAdministrationSessionAuthorization } = require('../employee-directory/auth');

test('approved public announcement, published API and protected lifecycle/recovery work in isolated browsers', async (t) => {
  const f = fixture();
  await f.service.processMonth(f.month);
  f.advance('2026-11-26T12:00:00Z');
  const november = fixture({ month: '2026-11' });
  f.db.seed(november.path, november.election);
  const september = fixture({ month: '2026-09' });
  f.db.seed(september.path, september.election);
  const august = fixture({ month: '2026-08' });
  for (const [document, value] of august.db.docs) f.db.seed(document, value, august.db.times.get(document));
  const app = express();
  app.use(express.json());
  const root = path.join(__dirname, '..');
  const authOptions = {
    siteId: 'molard', administratorUid: 'fixture-admin',
    firebaseAuth: { async verifySessionCookie(cookie) {
      if (cookie !== 'fixture-admin') throw new Error('no session');
      return { uid: 'fixture-admin', siteId: 'molard' };
    } },
  };
  const pageAuth = createAdministrationPageAuthorization(authOptions);
  mountPublicWinnersRoute(app);
  app.get('/resultats-du-vote', pageAuth, (_req, res) => res.sendFile(path.join(root, 'private-pages/election-results.html')));
  for (const file of ['election-results-admin.js', 'election-results-admin.css', 'runtime-diagnostic-admin.js']) {
    app.get(`/private-pages/${file}`, pageAuth, (_req, res) => res.sendFile(path.join(root, 'private-pages', file)));
  }
  let recoveries = 0;
  app.post('/api/v1/management/election-results/:month/recover', (_req, _res, next) => { recoveries += 1; next(); });
  mountResultsApi(app, {
    service: f.service, authorize: createAdministrationSessionAuthorization(authOptions),
    workerAuthorization: (_req, res) => res.status(401).end(),
  });
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { call, evaluate, errors } = await browserSession(t);
  const writes = f.db.writes.length;
  const legacy = await fetch(`${base}/collaborateurs-du-mois`, { redirect: 'manual' });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get('location'), '/resultats_collaborateurs-du-mois.html');
  const published = await fetch(`${base}/api/v1/public/election-results/latest`).then((r) => r.json());
  assert.equal(published.month, '2026-10');
  assert.deepEqual(published.categories.CUISINE.winners.map((winner) => winner.name), ['Chef One', 'Chef Two']);
  assert.equal(published.categories.SERVICE.winners[0].name, 'Service One');
  assert.doesNotMatch(JSON.stringify(published), /employeeId|inputDigest|participation|comments/);
  for (const [width, height] of [[320, 740], [390, 844], [1440, 960]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
    await waitFor(() => evaluate('document.readyState === "complete" && Boolean(document.querySelector("#page-title"))'));
    assert.equal(await evaluate('location.pathname'), '/resultats_collaborateurs-du-mois.html');
    assert.equal(await evaluate('document.body.textContent.toLowerCase().includes("septembre 2026")'), true);
    assert.equal(await evaluate('Boolean(document.querySelector("#loading-panel"))'), false);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    assert.equal(await evaluate('document.body.textContent.includes("counts")'), false);
  }
  assert.equal(f.db.writes.length, writes, 'public browser visits must never mutate storage');
  await call('Page.navigate', { url: `${base}/resultats-du-vote` });
  await waitFor(() => evaluate('location.pathname === "/gestion-photos-login.html"'));
  await call('Network.setCookie', { name: '__session', value: 'fixture-admin', url: base });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `${base}/resultats-du-vote` });
  await waitFor(() => evaluate('document.querySelector("#dashboard") && !document.querySelector("#dashboard").hidden'));
  assert.equal(await evaluate('document.querySelectorAll("#months-list .month-row").length'), 4);
  assert.equal(await evaluate('document.body.textContent.includes("Résultat à vérifier")'), true);
  assert.equal(await evaluate('document.body.textContent.includes("SEPTEMBER_RECOVERY_HOLD")'), false);
  assert.equal(await evaluate('[...document.querySelectorAll("#months-list .month-row")].find(r => r.textContent.includes("septembre")).querySelector("button").disabled'), true);
  assert.equal(await evaluate('[...document.querySelectorAll("#months-list .month-row")].find(r => r.textContent.includes("novembre")).querySelector("button").disabled'), true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
  // Same canonical recovery pipeline, real fixture API, no bypassed login on the application.
  await evaluate('[...document.querySelectorAll("#months-list .month-row")].find(r => r.textContent.includes("août")).querySelector("button").click()');
  await waitFor(() => evaluate('[...document.querySelectorAll("#months-list .month-row")].find(r => r.textContent.includes("août")).textContent.includes("Publié")'));
  assert.equal(recoveries, 1);
  assert.equal((await f.service.latest()).month, '2026-10', 'late recovery must not replace newer winners');
  assert.equal(f.db.writes.some(([, document]) => document.includes('/elections/2026-09/')), false);
  assert.deepEqual(errors, []);
});