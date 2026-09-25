const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');

function waitFor(check, timeout = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await check();
        if (value) return resolve(value);
      } catch {
        // The page may still be navigating.
      }
      if (Date.now() - started >= timeout) return reject(new Error('Timed out waiting for browser state'));
      setTimeout(poll, 30);
    };
    poll();
  });
}

async function startBrowser() {
  const profile = `/tmp/molino-voting-browser-${process.pid}-${Date.now()}`;
  const child = spawn(process.env.CHROME_BIN || 'chromium', [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const debuggerUrl = await waitFor(() => {
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    return match?.[1];
  });
  const port = new URL(debuggerUrl).port;
  return { child, port };
}

async function openPage(browserPort, url) {
  const target = await fetch(`http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    }
    return response.result.result.value;
  };
  await waitFor(() => evaluate('document.readyState === "complete"'));
  return {
    evaluate,
    setViewport: async (width, height = 844) => {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    },
    pressEnter: async () => {
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    },
    close: async () => {
      try {
        await fetch(`http://127.0.0.1:${browserPort}/json/close/${target.id}`);
      } catch {
        // Chromium may close the target socket before acknowledging cleanup.
      }
      socket.close();
    },
  };
}

test('homepage voting card stays visible and responsive without client-side election gating', async (t) => {
  const api = express();
  api.use(express.static(root));
  api.get('/collaborateur-du-mois', (_req, res) => {
    res.sendFile(path.join(root, 'collaborateur-du-mois.html'));
  });
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const browser = await startBrowser();
  t.after(() => browser.child.kill('SIGKILL'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await openPage(browser.port, `${base}/`);
  t.after(() => page.close());

  const selector = 'a.navigation-card[href="/collaborateur-du-mois"]';
  await waitFor(() => page.evaluate(`Boolean(document.querySelector('${selector}'))`));
  await waitFor(() => page.evaluate(`getComputedStyle(document.querySelector('${selector}')).display === 'flex'`));
  assert.equal(await page.evaluate(`
    ['Collaborateur du mois', 'Collaboratore del mese', 'Employee of the Month']
      .some((label) => document.querySelector('${selector}').textContent.includes(label))
  `), true);
  assert.equal(await page.evaluate('Boolean(document.querySelector(\'a[href="competition-mois.html"]\'))'), true);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
});

test('mobile browser completes the private atomic voting flow', async (t) => {
  const scenario = {
    election: { code: 'ELECTION_STATE', state: 'OPEN', categories: ['CUISINE', 'SERVICE'] },
    verificationError: null,
    submitted: false,
    submissionError: null,
    ballots: [],
  };
  const api = express();
  api.use(express.json());
  api.get('/api/v1/public/election', (_req, res) => res.json(scenario.election));
  api.post('/api/v1/public/election/verify-code', (_req, res) => {
    if (scenario.verificationError) return res.status(429).json({ code: scenario.verificationError });
    return res.json({
      code: 'VERIFIED',
      authorization: 'browser-test-authorization-at-least-32-characters',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  });
  api.get('/api/v1/public/election/participation', (_req, res) => res.json({
    code: 'PARTICIPATION',
    submitted: scenario.submitted,
  }));
  api.get('/api/v1/public/election/candidates', (_req, res) => res.json({
    code: 'CANDIDATES',
    candidates: {
      CUISINE: [
        { employeeId: 'chef-1', displayName: 'Élodie Martin', jobTitle: 'Cheffe', department: 'Cuisine', votingGroup: 'CUISINE', photoUrl: '/missing-photo.jpg' },
        { employeeId: 'chef-3', displayName: 'Zoë NomExtrêmementLongSansEspacesPourVérifierLaLisibilitéDesCandidats', jobTitle: 'Sous-cheffe', department: 'Cuisine', votingGroup: 'CUISINE', photoUrl: '' },
        { employeeId: 'chef-2', displayName: 'Anna Rossi', jobTitle: 'Pizzaiola', department: 'Pizzeria', votingGroup: 'CUISINE', photoUrl: '/assets/avatar-neutral.svg' },
      ],
      SERVICE: [
        { employeeId: 'service-1', displayName: 'Marco Bianchi', jobTitle: 'Chef de rang', department: 'Service', votingGroup: 'SERVICE', photoUrl: '/assets/avatar-neutral.svg' },
        { employeeId: 'service-2', displayName: 'André Dupont', jobTitle: '', department: 'Accueil', votingGroup: 'SERVICE', photoUrl: '' },
      ],
    },
  }));
  api.post('/api/v1/public/election/ballots', (req, res) => {
    if (scenario.submissionError) return res.status(409).json({ code: scenario.submissionError });
    scenario.ballots.push(req.body);
    return res.status(201).json({ code: 'SUBMITTED' });
  });
  api.use(express.static(root));
  api.get('/collaborateur-du-mois', (_req, res) => res.sendFile(path.join(root, 'collaborateur-du-mois.html')));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const browser = await startBrowser();
  t.after(() => browser.child.kill('SIGKILL'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await openPage(browser.port, `${base}/collaborateur-du-mois`);
  t.after(() => page.close());

  await waitFor(() => page.evaluate('Boolean(document.getElementById("salary"))'));
  await page.evaluate(`
    document.getElementById('locale').value = 'fr';
    document.getElementById('locale').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('salary').value = 'SAL-PRIVATE';
    document.getElementById('identity-form').requestSubmit();
  `);
  await waitFor(() => page.evaluate('Boolean(document.querySelector("[data-category=CUISINE]"))'));
  assert.equal(await page.evaluate('document.body.innerText.includes("SAL-PRIVATE")'), false);
  assert.equal(await page.evaluate('location.href.includes("SAL-PRIVATE")'), false);
  assert.deepEqual(await page.evaluate('[localStorage.length, sessionStorage.length]'), [0, 0]);
  assert.deepEqual(await page.evaluate(`
    ['CUISINE','SERVICE'].map(category => Array.from(document.querySelectorAll('#grid-' + category + ' .candidate'), b => b.dataset.candidate))
  `), [['chef-2', 'chef-1', 'chef-3'], ['service-2', 'service-1']]);
  await waitFor(() => page.evaluate('document.querySelector("[data-candidate=chef-1] img")?.hidden === true'));
  assert.equal(await page.evaluate(`
    ['chef-1','chef-2','chef-3','service-2'].every(id => {
      const row = document.querySelector('[data-candidate="' + id + '"]');
      const slot = row.querySelector('.avatar-slot');
      const fallback = slot.querySelector('.avatar-fallback');
      return row.children.length === 3 && row.children[0].classList.contains('check') &&
        row.children[1] === slot && row.children[2].classList.contains('candidate-info') &&
        slot.getBoundingClientRect().width === 48 &&
        (id === 'chef-1' || id === 'chef-3' || id === 'service-2' ? !fallback.hidden && getComputedStyle(fallback).display !== 'none' : fallback.hidden && getComputedStyle(fallback).display === 'none');
    })
  `), true);
  for (const width of [390, 768, 1280, 320]) {
    await page.setViewport(width);
    assert.equal(await page.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('.candidate')];
        const margin = 1;
        const positions = rows.map(row => {
          const [check, slot, info] = row.children;
          const r = row.getBoundingClientRect(), a = check.getBoundingClientRect(), b = slot.getBoundingClientRect(), c = info.getBoundingClientRect();
          return { row: r, check: a, slot: b, info: c };
        });
        return document.documentElement.scrollWidth <= innerWidth &&
          rows.every(row => row.clientWidth <= row.parentElement.clientWidth && row.offsetHeight >= 72) &&
          positions.every(({row, check, slot, info}) =>
            check.left < slot.left && slot.right <= info.left &&
            check.left >= row.left && info.right <= row.right + margin &&
            Math.abs(check.top + check.height / 2 - slot.top - slot.height / 2) < margin &&
            Math.abs(info.top + info.height / 2 - slot.top - slot.height / 2) < margin
          );
      })()
    `), true, `candidate layout at ${width}px`);
    assert.equal(await page.evaluate(`
      [...document.querySelectorAll('.candidate')].every(row => {
        row.scrollIntoView({ block: 'center' });
        const r = row.getBoundingClientRect();
        return [4, r.width / 2, r.width - 4].every(offset =>
          document.elementFromPoint(r.left + offset, r.top + r.height / 2)?.closest('.candidate') === row);
      })
    `), true, `whole candidate row is reachable at ${width}px`);
  }
  await page.setViewport(390);

  await page.evaluate(`
    const search = document.getElementById('search-CUISINE');
    search.value = 'cheffe';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll("#grid-CUISINE .candidate"), b => b.dataset.candidate)'), ['chef-1', 'chef-3']);
  await page.evaluate(`
    document.getElementById('search-SERVICE').value = 'accueil';
    document.getElementById('search-SERVICE').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll("#grid-SERVICE .candidate"), b => b.dataset.candidate)'), ['service-2']);
  await page.evaluate(`
    document.getElementById('search-SERVICE').value = '';
    document.getElementById('search-SERVICE').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await page.evaluate(`
    document.getElementById('search-CUISINE').value = 'elodie';
    document.getElementById('search-CUISINE').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-candidate="chef-1"]').focus();
  `);
  assert.equal(await page.evaluate('document.activeElement.dataset.candidate'), 'chef-1');
  await page.pressEnter();
  await waitFor(() => page.evaluate('document.querySelector("[data-candidate=chef-1]").getAttribute("aria-pressed") === "true"'));
  assert.equal(await page.evaluate('document.activeElement.dataset.candidate'), 'chef-1');
  await page.evaluate(`
    document.getElementById('search-CUISINE').value = '';
    document.getElementById('search-CUISINE').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.equal(await page.evaluate('document.querySelector("[data-candidate=chef-1]").getAttribute("aria-pressed")'), 'true');
  await page.evaluate(`
    document.getElementById('search-CUISINE').value = 'elodie';
    document.getElementById('search-CUISINE').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('locale').value = 'it';
    document.getElementById('locale').dispatchEvent(new Event('change', { bubbles: true }));
  `);
  assert.equal(await page.evaluate('document.getElementById("search-CUISINE").value === "elodie" && document.querySelector("[data-candidate=chef-1]").getAttribute("aria-pressed") === "true"'), true);
  await page.evaluate(`
    document.getElementById('locale').value = 'fr';
    document.getElementById('locale').dispatchEvent(new Event('change', { bubbles: true }));
  `);

  await page.evaluate(`
    document.querySelector('[data-candidate="service-1"]').click();
    document.getElementById('to-review').click();
  `);
  assert.equal(await page.evaluate('document.getElementById("choice-status").textContent.includes("10")'), true);
  await page.evaluate(`
    const cuisine = document.getElementById('comment-CUISINE');
    cuisine.value = 'Une collègue toujours exemplaire';
    cuisine.dispatchEvent(new Event('input', { bubbles: true }));
    const service = document.getElementById('comment-SERVICE');
    service.value = 'Un service attentionné et constant';
    service.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('to-review').click();
  `);
  await waitFor(() => page.evaluate('Boolean(document.getElementById("submit"))'));
  assert.equal(await page.evaluate('document.body.innerText.includes("Cheffe") && document.body.innerText.includes("Chef de rang")'), true);
  assert.equal(await page.evaluate('document.querySelectorAll(".review-person .avatar").length >= 2'), true);
  assert.equal(await page.evaluate('document.body.innerText.includes("définitif")'), true);
  await page.evaluate(`document.getElementById('back-choices').click()`);
  assert.equal(await page.evaluate(`
    document.getElementById('search-CUISINE').value === 'elodie' &&
    document.querySelector('[data-candidate="chef-1"]').getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-candidate="service-1"]').getAttribute('aria-pressed') === 'true'
  `), true);
  await page.evaluate(`document.getElementById('to-review').click()`);

  await page.evaluate(`document.getElementById('submit').click(); document.getElementById('submit').click();`);
  await waitFor(() => page.evaluate('document.body.innerText.includes("Votre vote a bien été enregistré.")'));
  assert.equal(scenario.ballots.length, 1);
  assert.deepEqual(scenario.ballots[0], {
    choices: { CUISINE: 'chef-1', SERVICE: 'service-1' },
    comments: {
      CUISINE: 'Une collègue toujours exemplaire',
      SERVICE: 'Un service attentionné et constant',
    },
  });
  assert.equal(await page.evaluate('document.body.innerText.includes("définitif") && Boolean(document.querySelector(\'a[href="index.html"]\'))'), true);
  await page.evaluate(`document.getElementById('locale').value='it';document.getElementById('locale').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await page.evaluate('document.body.innerText.includes("Il tuo voto è stato registrato.") && document.body.innerText.includes("definitivo")'), true);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
});

test('browser preserves authoritative and terminal states across locale changes', async (t) => {
  const scenario = {
    election: { code: 'ELECTION_STATE', state: 'UPCOMING', opensAt: '2026-09-25T00:00:00.000Z' },
    unavailable: false,
  };
  const api = express();
  api.get('/api/v1/public/election', (_req, res) => {
    if (scenario.unavailable) return res.status(503).json({ code: 'SERVICE_UNAVAILABLE' });
    return res.json(scenario.election);
  });
  api.use(express.static(root));
  api.get('/collaborateur-du-mois', (_req, res) => res.sendFile(path.join(root, 'collaborateur-du-mois.html')));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const browser = await startBrowser();
  t.after(() => browser.child.kill('SIGKILL'));
  const base = `http://127.0.0.1:${server.address().port}`;

  const upcoming = await openPage(browser.port, `${base}/collaborateur-du-mois`);
  await waitFor(() => upcoming.evaluate('document.body.innerText.includes("not open") || document.body.innerText.includes("pas encore")'));
  await upcoming.evaluate(`document.getElementById('locale').value='it';document.getElementById('locale').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await upcoming.evaluate('document.body.innerText.includes("non è ancora aperto") && !document.getElementById("salary")'), true);
  await upcoming.close();

  scenario.election = { code: 'ELECTION_STATE', state: 'CLOSED_PENDING_RESULTS' };
  const closed = await openPage(browser.port, `${base}/collaborateur-du-mois`);
  await waitFor(() => closed.evaluate('document.body.innerText.includes("terminé") || document.body.innerText.includes("closed")'));
  await closed.evaluate(`document.getElementById('locale').value='en';document.getElementById('locale').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await closed.evaluate('document.body.innerText.includes("Voting is closed") && !document.getElementById("salary")'), true);
  await closed.close();

  scenario.unavailable = true;
  const unavailable = await openPage(browser.port, `${base}/collaborateur-du-mois`);
  await waitFor(() => unavailable.evaluate('Boolean(document.getElementById("retry"))'));
  await unavailable.evaluate(`document.getElementById('locale').value='fr';document.getElementById('locale').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await unavailable.evaluate('Boolean(document.getElementById("retry")) && !document.getElementById("salary")'), true);
  await unavailable.close();
});

test('browser shows safe verification, participation, and submission failures', async (t) => {
  const scenario = { verificationError: 'INVALID_CREDENTIALS', submitted: false, submissionError: null };
  const api = express();
  api.use(express.json());
  api.get('/api/v1/public/election', (_req, res) => res.json({ code: 'ELECTION_STATE', state: 'OPEN' }));
  api.post('/api/v1/public/election/verify-code', (_req, res) => {
    if (scenario.verificationError) return res.status(scenario.verificationError === 'RATE_LIMITED' ? 429 : 401).json({ code: scenario.verificationError });
    return res.json({ code: 'VERIFIED', authorization: 'browser-test-authorization-at-least-32-characters', expiresAt: '2099-01-01T00:00:00.000Z' });
  });
  api.get('/api/v1/public/election/participation', (_req, res) => res.json({ code: 'PARTICIPATION', submitted: scenario.submitted }));
  api.get('/api/v1/public/election/candidates', (_req, res) => res.json({ code: 'CANDIDATES', candidates: {
    CUISINE: [{ employeeId: 'chef-1', displayName: 'Anna', jobTitle: 'Cheffe', department: 'Cuisine', votingGroup: 'CUISINE', photoUrl: '' }],
    SERVICE: [{ employeeId: 'service-1', displayName: 'Marco', jobTitle: 'Serveur', department: 'Service', votingGroup: 'SERVICE', photoUrl: '' }],
  } }));
  api.post('/api/v1/public/election/ballots', (_req, res) => res.status(409).json({ code: scenario.submissionError }));
  api.use(express.static(root));
  api.get('/collaborateur-du-mois', (_req, res) => res.sendFile(path.join(root, 'collaborateur-du-mois.html')));
  const server = api.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const browser = await startBrowser();
  t.after(() => browser.child.kill('SIGKILL'));
  const page = await openPage(browser.port, `http://127.0.0.1:${server.address().port}/collaborateur-du-mois`);
  t.after(() => page.close());

  await waitFor(() => page.evaluate('Boolean(document.getElementById("salary"))'));
  await page.evaluate(`document.getElementById('locale').value='fr';document.getElementById('locale').dispatchEvent(new Event('change',{bubbles:true}))`);
  const identify = () => page.evaluate(`document.getElementById('salary').value='SAL-1001';document.getElementById('identity-form').requestSubmit()`);
  await identify();
  await waitFor(() => page.evaluate('document.getElementById("identity-status").textContent.includes("invalide")'));

  scenario.verificationError = 'RATE_LIMITED';
  await identify();
  await waitFor(() => page.evaluate('document.getElementById("identity-status").textContent.includes("Trop de tentatives")'));

  scenario.verificationError = null;
  scenario.submitted = true;
  await identify();
  await waitFor(() => page.evaluate('document.getElementById("identity-status").textContent.includes("déjà été enregistré")'));

  scenario.submitted = false;
  await identify();
  await waitFor(() => page.evaluate('Boolean(document.querySelector("[data-candidate]"))'));
  await page.evaluate(`
    document.querySelector('[data-candidate="chef-1"]').click();
    document.querySelector('[data-candidate="service-1"]').click();
    for (const category of ['CUISINE','SERVICE']) {
      const field=document.getElementById('comment-'+category);
      field.value='Commentaire suffisamment long';
      field.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.getElementById('to-review').click();
  `);
  scenario.submissionError = 'INVALID_BALLOT';
  await page.evaluate(`document.getElementById('submit').click()`);
  await waitFor(() => page.evaluate('document.getElementById("review-status").textContent.includes("changé pendant")'));
  assert.equal(await page.evaluate('document.getElementById("submit").disabled'), false);

  scenario.submissionError = 'ELECTION_NOT_OPEN';
  await page.evaluate(`document.getElementById('submit').click()`);
  await waitFor(() => page.evaluate('document.getElementById("review-status").textContent.includes("maintenant fermé")'));
  assert.equal(await page.evaluate('Boolean(document.querySelector(".actions button:not([hidden])"))'), true);
});