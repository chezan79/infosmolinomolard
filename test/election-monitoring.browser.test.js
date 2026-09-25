const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const WebSocket = require('ws');
const { createAdministrationPageAuthorization } = require('../employee-directory/auth');
const { mountAdministrationMonitoringPage } = require('../administration-monitoring-page');
const { mountPublicFiles } = require('../public-files');

const root = path.join(__dirname, '..');

async function waitFor(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Navigation can temporarily detach the document.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for monitoring page');
}

test('protected Administration navigation and dashboard work in desktop and mobile browsers', async (t) => {
  const app = express();
  const authorize = createAdministrationPageAuthorization({
    siteId: 'molard', administratorUid: 'admin',
    firebaseAuth: { async verifySessionCookie(cookie) {
      if (cookie !== 'fixture-admin') throw new Error('Invalid session');
      return { uid: 'admin', siteId: 'molard' };
    } },
  });
  app.get('/administration', authorize, (_req, res) =>
    res.sendFile(path.join(root, 'private-pages/administration.html')));
  mountAdministrationMonitoringPage(app, authorize, root);
  let reads = 0;
  app.get('/api/v1/management/election-monitoring', authorize, (_req, res) => {
    reads += 1;
    res.json({
      month: '2026-09', status: 'OPEN',
      window: { opensAt: '2026-09-24T22:00:00.000Z', closesAt: '2026-09-30T22:00:00.000Z' },
      eligibleVoters: 49, participation: { count: 1, remaining: 48, percentage: 2.04 },
      systemHealth: { participationRecords: 1, anonymousBallots: 1, consistency: 'OK' },
      privateVote: 'NEVER_DISPLAY_THIS',
    });
  });
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const child = spawn(process.env.CHROME_BIN || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=/tmp/molino-monitoring-browser-${process.pid}-${Date.now()}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const debuggerUrl = await waitFor(() => stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]);
  const port = new URL(debuggerUrl).port;
  const base = `http://127.0.0.1:${server.address().port}`;
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/administration')}`,
    { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  t.after(() => socket.close());
  await new Promise((resolve) => socket.once('open', resolve));
  let sequence = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result.exceptionDetails) throw new Error('Browser evaluation failed');
    return result.result.result.value;
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.setCookie', { name: '__session', value: 'fixture-admin', url: base });
  const inspect = async (width, height, label) => {
    await call('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    await call('Page.navigate', { url: `${base}/administration` });
    await waitFor(() => evaluate('document.querySelectorAll(".administration-card").length === 2'));
    assert.equal(await evaluate('document.querySelector(".administration-card[href=\\"/suivi-du-vote\\"]")?.textContent.includes("Ouvrir le dashboard")'), true);
    await evaluate('document.querySelector(".administration-card[href=\\"/suivi-du-vote\\"]").click()');
    await waitFor(() => evaluate('document.querySelector("#dashboard") && !document.querySelector("#dashboard").hidden'));
    assert.equal(await evaluate('document.querySelector("#eligible").textContent'), '49');
    assert.equal(await evaluate('document.querySelector("#consistency").textContent'), 'Système cohérent');
    assert.equal(await evaluate('document.body.innerText.includes("NEVER_DISPLAY_THIS")'), false);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#progress")).height !== "0px"'), true);
    assert.equal(await evaluate('document.querySelector("#results-state").textContent.includes("Résultats masqués")'), true);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`/tmp/phase3-${label}.png`, Buffer.from(screenshot.result.data, 'base64'));
    await evaluate('document.querySelector("#refresh").click()');
    await waitFor(() => reads >= (label === 'desktop' ? 2 : 4));
  };
  await inspect(1280, 900, 'desktop');
  await inspect(390, 844, 'mobile');
  assert.equal(reads, 4, 'one initial GET and one refresh GET at each width');
});