const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { browserSession, waitFor } = require('./helpers/browser-session');
const { mountAdministrationHistoryPage } = require('../administration-monitoring-page');
const { createAdministrationPageAuthorization, createAdministrationSessionAuthorization } = require('../employee-directory/auth');
const { mountPublicFiles } = require('../public-files');
const { mountResultsApi } = require('../election-engine/results-runtime');
const { createElectionHistoryService } = require('../election-engine/history-service');
const { fixture } = require('./helpers/results-fixture');

test('protected history renders safely in desktop/mobile browsers, selects September and clears data after session loss', async (t) => {
  const f = fixture();
  await f.service.processMonth('2026-10');
  const september = fixture({ month: '2026-09' });
  for (const [key, value] of september.db.docs) f.db.seed(key, value);
  const writes = f.db.writes.length;
  const options = { siteId: 'molard', administratorUid: 'fixture-owner',
    firebaseAuth: { async verifySessionCookie(cookie) {
      if (cookie !== 'fixture-owner') throw new Error();
      return { uid: 'fixture-owner', siteId: 'molard' };
    } } };
  const app = express(), root = path.join(__dirname, '..');
  mountAdministrationHistoryPage(app, createAdministrationPageAuthorization(options), root);
  mountResultsApi(app, { service: {}, authorize: createAdministrationSessionAuthorization(options),
    workerAuthorization: (_req, res) => res.sendStatus(403),
    historyService: createElectionHistoryService({ db: f.db, binding: f.binding, now: f.now }) });
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { call, evaluate, errors } = await browserSession(t);
  await call('Network.setCookie', { name: '__session', value: 'fixture-owner', url: base });
  for (const [width, height] of [[1440, 960], [390, 844], [320, 740]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.navigate', { url: base + '/historique-des-votations' });
    await waitFor(() => evaluate('document.querySelector("#dashboard") && !document.querySelector("#dashboard").hidden'));
    assert.equal(await evaluate('document.querySelectorAll("#winners article").length'), 2);
    assert.equal(await evaluate('document.querySelectorAll("#voter-list li").length'), 0);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await evaluate('document.querySelector("#month-select").value="2026-09"; document.querySelector("#month-select").dispatchEvent(new Event("change"))');
    await waitFor(() => evaluate('!document.querySelector("#dashboard").hidden && document.querySelector("#results-state").textContent.includes("Aucun résultat")'));
    assert.equal(await evaluate('document.querySelectorAll("#winners article").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("#voter-list li").length'), 0);
  }
  await call('Network.deleteCookies', { name: '__session', url: base });
  await evaluate('document.querySelector("#refresh").click()');
  await waitFor(() => evaluate('location.pathname.includes("gestion-photos-login")'));
  assert.equal(f.db.writes.length, writes);
  assert.deepEqual(errors, []);
});
