const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { createAdministrationPageAuthorization } = require('../employee-directory/auth');
const { createResultsRuntime } = require('../election-engine/results-runtime');
const { MemoryFirestore } = require('./helpers/results-fixture');
const { mountPublicFiles } = require('../public-files');
const { browserSession, waitFor } = require('./helpers/browser-session');

test('owner runtime diagnostic renders in desktop/mobile browsers, with zero election reads and safe session expiry', async (t) => {
  const db = new MemoryFirestore();
  db.projectId = 'infosmolinomoard';
  const env = { NODE_ENV: 'production', ELECTION_DATA_ENVIRONMENT: 'production', EMPLOYEE_DIRECTORY_SITE_ID: 'molard',
    ELECTION_TIME_ZONE: 'Europe/Zurich', ELECTION_RESULTS_PROJECT_ID: 'infosmolinomoard',
    ELECTION_RESULTS_DATABASE_ID: '(default)', MOLARD_ADMIN_FIREBASE_UID: 'fixture-owner' };
  const firebaseAuth = { async verifySessionCookie(cookie) {
    if (cookie !== 'fixture-owner') throw new Error();
    return { uid: 'fixture-owner', siteId: 'molard' };
  } };
  const authorizePage = createAdministrationPageAuthorization({
    firebaseAuth, siteId: 'molard', administratorUid: 'fixture-owner',
  });
  const app = express(), root = path.join(__dirname, '..');
  app.get('/resultats-du-vote', authorizePage, (_req, res) =>
    res.sendFile(path.join(root, 'private-pages/election-results.html')));
  for (const file of ['runtime-diagnostic-admin.js', 'election-results-admin.js', 'election-results-admin.css']) {
    app.get(`/private-pages/${file}`, authorizePage, (_req, res) =>
      res.sendFile(path.join(root, 'private-pages', file)));
  }
  // Isolate the new diagnostic from the existing status dashboard: never query data.
  app.get('/api/v1/management/election-results', (_req, res) => res.json({
    enabled: false, automationEnabled: false, storageStatus: 'DISABLED', months: [], heartbeat: null,
  }));
  createResultsRuntime({ env, firebaseDb: db, firebaseAuth }).mount(app);
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/private-pages/runtime-diagnostic-admin.js', { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(base + '/election-engine/runtime-diagnostic.js')).status, 404);
  const { call, evaluate, errors } = await browserSession(t);
  await call('Network.setCookie', { name: '__session', value: 'fixture-owner', url: base });
  for (const [width, height] of [[1440, 960], [390, 844], [320, 740]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.navigate', { url: base + '/resultats-du-vote' });
    await waitFor(() => evaluate('document.querySelector("#runtime-diagnostic-refresh") && !document.querySelector("#runtime-diagnostic-refresh").disabled'));
    assert.equal(await evaluate('document.querySelectorAll("#runtime-diagnostic-checks dd").length'), 0);
    await evaluate('document.querySelector("#runtime-diagnostic-refresh").click()');
    await waitFor(() => evaluate('document.querySelectorAll("#runtime-diagnostic-checks dd").length===9'));
    assert.equal(await evaluate('document.querySelector("#runtime-diagnostic-status").textContent.includes("officielle conforme")'), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    env.ELECTION_DATA_ENVIRONMENT = 'development';
    await evaluate('document.querySelector("#runtime-diagnostic-refresh").click()');
    await waitFor(() => evaluate('document.querySelector("#runtime-diagnostic-status").textContent.includes("non attestée")'));
    env.ELECTION_DATA_ENVIRONMENT = 'production';
  }
  await call('Network.deleteCookies', { name: '__session', url: base });
  await evaluate('document.querySelector("#runtime-diagnostic-refresh").click()');
  await waitFor(() => evaluate('location.pathname.includes("gestion-photos-login")'));
  assert.equal(db.reads.length + db.writes.length, 0);
  assert.deepEqual(errors, []);
});
