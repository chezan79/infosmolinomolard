const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { fixture } = require('./helpers/results-fixture');
const { browserSession, waitFor } = require('./helpers/browser-session');
const { mountResultsApi } = require('../election-engine/results-runtime');
const { mountPublicFiles } = require('../public-files');
const { createAdministrationPageAuthorization, createAdministrationSessionAuthorization } = require('../employee-directory/auth');

test('public winners and protected lifecycle/recovery work in isolated desktop and mobile browsers', async (t) => {
  const f = fixture();
  const key = '2026-10.11111111-1111-4111-8111-111111111111';
  f.service.photos = { prepare: async () => ({ 'chef-one': {
    key, path: `published-winner-photos/molard/development/${key}.webp`,
  } }) };
  await f.service.processMonth(f.month);
  const empty = fixture({ votes: 0 });
  await empty.service.processMonth(empty.month);
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
  app.get('/collaborateurs-du-mois', (_req, res) => res.sendFile(path.join(root, 'collaborateurs-du-mois.html')));
  app.get('/resultats-du-vote', pageAuth, (_req, res) => res.sendFile(path.join(root, 'private-pages/election-results.html')));
  for (const file of ['election-results-admin.js', 'election-results-admin.css']) {
    app.get(`/private-pages/${file}`, pageAuth, (_req, res) => res.sendFile(path.join(root, 'private-pages', file)));
  }
  let publicMode = 'published';
  app.get('/api/v1/public/election-results/latest', async (_req, res, next) => {
    if (publicMode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 500));
    if (publicMode === 'empty') return res.status(404).json({ code: 'NO_PUBLISHED_RESULT' });
    if (publicMode === 'error') return res.status(503).json({ code: 'RESULTS_UNAVAILABLE' });
    if (publicMode === 'malformed') return res.json({ code: 'PUBLISHED_RESULT', private: 'DO_NOT_RENDER', categories: {} });
    if (publicMode === 'no-winner') return res.json(await empty.service.latest());
    next();
  });
  let photoAvailable = false;
  app.get(`/api/v1/public/winner-photos/${key}`, (_req, res, next) => {
    if (!photoAvailable) return next();
    res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="280"><rect width="240" height="280" fill="#f1dfce"/><circle cx="120" cy="94" r="42" fill="#b7472a"/><path d="M40 280v-52a80 80 0 0 1 160 0v52" fill="#8d321f"/></svg>');
  });
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
  publicMode = 'delayed';
  await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
  await waitFor(() => evaluate('document.querySelector("#loading-panel") && !document.querySelector("#loading-panel").hidden'));
  assert.equal(await evaluate('document.querySelector("#results-region").getAttribute("aria-busy")'), 'true');
  assert.equal(await evaluate('document.querySelectorAll(".skeleton-grid .skeleton-photo").length'), 2);
  await waitFor(() => evaluate('!document.querySelector("#results-content").hidden'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#loading-panel")).display'), 'none');
  publicMode = 'published';
  for (const [width, height] of [[320, 740], [390, 844], [1440, 960]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
    await waitFor(() => evaluate('document.querySelector("#results-content") && !document.querySelector("#results-content").hidden'));
    assert.equal(await evaluate('document.querySelectorAll(".winner-name").length'), 3);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".winner-name")].map(name => name.textContent)'), ['Chef One', 'Chef Two', 'Service One']);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".category-heading h2")].map(heading => heading.textContent)'), ['Cuisine', 'Service']);
    assert.equal(await evaluate('document.querySelector(".closing p").textContent'), 'Une maison, des métiers, une même attention.');
    assert.equal(await evaluate('document.querySelector("#month-label").textContent.includes("octobre 2026")'), true);
    assert.equal(await evaluate('document.querySelector("#month-label").tagName'), 'H2');
    assert.equal(await evaluate('document.body.textContent.toLowerCase().includes("ex æquo")'), true);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".winner-role")].map(role => role.textContent)'), ['Chef', 'Service']);
    assert.equal(await evaluate('document.querySelectorAll(".category-index").length'), 0);
    assert.equal(await evaluate('document.querySelector(".published-at, .latest-note, #published-note, #published-at")'), null);
    assert.equal(await evaluate('document.body.textContent.includes("Publication du")'), false);
    assert.equal(await evaluate('document.body.textContent.includes("Derniers résultats publiés")'), false);
    assert.deepEqual(await evaluate(`(() => {
      const cards = [...document.querySelectorAll(".winner-category")].map((card) => card.getBoundingClientRect());
      const portraits = [...document.querySelectorAll(".portrait-wrap")].map((portrait) => portrait.getBoundingClientRect());
      return {
        equalCategories: Math.abs(cards[0].width - cards[1].width) < 1,
        portraitsLarge: portraits.every((portrait) => portrait.height >= 200),
      };
    })()`), { equalCategories: true, portraitsLarge: true });
    await waitFor(() => evaluate('document.querySelectorAll(".portrait").length === 0'));
    assert.equal(await evaluate('document.querySelector(".portrait-fallback").hidden'), false);
    assert.equal(await evaluate('document.querySelector(".portrait-fallback").getAttribute("aria-hidden")'), 'true');
    assert.equal(await evaluate(`(() => {
      const box = document.querySelector(".portrait-wrap").getBoundingClientRect();
      const fallback = document.querySelector(".portrait-fallback").getBoundingClientRect();
      return Math.abs(box.width - fallback.width) < 1 && Math.abs(box.height - fallback.height) < 1;
    })()`), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    assert.equal(await evaluate('document.body.textContent.includes("counts")'), false);
  }
  photoAvailable = true;
  await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
  await waitFor(() => evaluate('document.querySelector(".portrait")?.naturalWidth > 0'));
  assert.equal(await evaluate('document.querySelector(".portrait-fallback").hidden'), true);
  assert.equal(await evaluate(`(() => {
    const box = document.querySelector(".portrait-wrap").getBoundingClientRect();
    const image = document.querySelector(".portrait").getBoundingClientRect();
    return Math.abs(box.width - image.width) < 1 && Math.abs(box.height - image.height) < 1;
  })()`), true);
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('parseFloat(getComputedStyle(document.querySelector(".winner-category")).animationDuration) < 0.001'), true);
  assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollBehavior'), 'auto');
  await call('Emulation.setEmulatedMedia', { features: [] });
  assert.equal(f.db.writes.length, writes, 'public browser visits must never mutate storage');
  publicMode = 'no-winner';
  await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
  await waitFor(() => evaluate('document.querySelectorAll(".no-winner").length === 2'));
  assert.equal(await evaluate('document.querySelectorAll(".winner-name").length'), 0);
  for (const mode of ['empty', 'error', 'malformed']) {
    publicMode = mode;
    await call('Page.navigate', { url: `${base}/collaborateurs-du-mois` });
    await waitFor(() => evaluate('document.querySelector("#message-panel") && !document.querySelector("#message-panel").hidden'));
    assert.equal(await evaluate('document.querySelector("#results-content").hidden'), true);
    assert.equal(await evaluate('document.querySelector("#retry-button").hidden'), mode === 'empty');
    assert.equal(await evaluate('document.body.textContent.includes("DO_NOT_RENDER")'), false);
  }
  publicMode = 'published';
  await evaluate('document.querySelector("#retry-button").click()');
  await waitFor(() => evaluate('!document.querySelector("#results-content").hidden'));
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