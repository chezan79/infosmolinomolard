const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { browserSession, waitFor } = require('./helpers/browser-session');
const { mountPublicFiles } = require('../public-files');

test('September winners page is static, responsive, and independent from election results', async (t) => {
  const app = express();
  const root = path.join(__dirname, '..');
  let latestResultsRequests = 0;

  app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
  app.get('/api/v1/public/election-results/latest', (_req, res) => {
    latestResultsRequests += 1;
    res.status(503).json({ code: 'RESULTS_UNAVAILABLE' });
  });
  mountPublicFiles(app, root);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { call, evaluate, errors } = await browserSession(t);

  await call('Page.navigate', { url: `${base}/resultats_collaborateurs-du-mois.html` });
  await waitFor(() => evaluate('document.readyState === "complete" && document.querySelectorAll(".portrait").length === 2'));
  await waitFor(() => evaluate('[...document.querySelectorAll(".portrait")].every(image => image.complete && image.naturalWidth > 0)'));

  assert.deepEqual(await evaluate(`({
    label: document.querySelector(".eyebrow").textContent.trim(),
    title: document.querySelector("h1").innerText.replace(/\\s+/g, " ").trim(),
    subtitle: document.querySelector(".intro-copy").textContent.replace(/\\s+/g, " ").trim(),
    month: document.querySelector(".month-heading").textContent,
    categories: [...document.querySelectorAll(".card-heading h2")].map(node => node.textContent),
    names: [...document.querySelectorAll(".winner-name")].map(node => node.textContent),
    roles: [...document.querySelectorAll(".winner-role")].map(node => node.textContent),
    closing: document.querySelector("#closing-title").textContent,
    closingCopy: document.querySelector(".closing-copy").textContent.replace(/\\s+/g, " ").trim(),
    returnLink: document.querySelector(".return-link").textContent.replace(/\\s+/g, " ").trim(),
    returnTarget: document.querySelector(".return-link").getAttribute("href"),
    images: [...document.querySelectorAll(".portrait")].map(image => ({
      src: new URL(image.src).pathname,
      alt: image.alt,
      fit: getComputedStyle(image).objectFit,
      position: getComputedStyle(image).objectPosition,
      width: image.naturalWidth,
    })),
    scripts: document.scripts.length,
    hasUnavailableMessage: document.body.innerText.includes("Résultats momentanément indisponibles.")
  })`), {
    label: 'LES TALENTS DE MOLINO MOLARD',
    title: '🏆 Les Gagnants : Collaborateurs du mois',
    subtitle: 'Bravo à nos deux collaborateurs pour leur engagement, leur professionnalisme et leur contribution exceptionnelle !',
    month: 'SEPTEMBRE 2026',
    categories: ['Cuisine', 'Service'],
    names: ['Filogamo Andrea', 'Cocco Axel Jean-Claude San'],
    roles: ['Chef de partie', 'Commis de rang'],
    closing: 'Félicitations à nos collaborateurs du mois !',
    closingCopy: 'Merci pour votre engagement quotidien et votre contribution à l’esprit de Molino Molard.',
    returnLink: '← Retour à l’accueil',
    returnTarget: '/',
    images: [
      {
        src: '/assets/collaborateurs-du-mois/septembre-2026-andrea-filogamo.jpg',
        alt: 'Filogamo Andrea, collaborateur du mois en cuisine',
        fit: 'cover',
        position: '49% 38%',
        width: 1170,
      },
      {
        src: '/assets/collaborateurs-du-mois/septembre-2026-axel-cocco.jpg',
        alt: 'Cocco Axel Jean-Claude San, collaborateur du mois au service',
        fit: 'cover',
        position: '53% 35%',
        width: 4284,
      },
    ],
    scripts: 0,
    hasUnavailableMessage: false,
  });

  for (let tab = 0; tab < 3; tab += 1) {
    await call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
  }
  assert.deepEqual(await evaluate(`({
    visibleFocus: document.activeElement.matches(":focus-visible"),
    outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth
  })`), { visibleFocus: true, outlineStyle: 'solid', outlineWidth: '3px' });

  await call('Page.navigate', { url: `${base}/` });
  assert.equal(await evaluate(`document.querySelector('a[href="resultats_collaborateurs-du-mois.html"]')?.getAttribute("href")`), 'resultats_collaborateurs-du-mois.html');

  for (const width of [1440, 768, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await call('Page.navigate', { url: `${base}/resultats_collaborateurs-du-mois.html` });
    await waitFor(() => evaluate('document.querySelectorAll(".portrait").length === 2 && [...document.querySelectorAll(".portrait")].every(image => image.complete && image.naturalWidth > 0)'));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `no horizontal overflow at ${width}px`);
    assert.equal(await evaluate('document.querySelectorAll(".winner-card").length === 2 && document.querySelector(".winner-grid").getBoundingClientRect().width > 0'), true);
    assert.equal(await evaluate(`(() => {
      const [cuisine, service] = [...document.querySelectorAll(".winner-card")].map(card => card.getBoundingClientRect());
      return ${width} > 680 ? Math.abs(cuisine.left - service.left) > 1 : Math.abs(cuisine.top - service.top) > 1;
    })()`), true, `winner card layout at ${width}px`);
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(latestResultsRequests, 0, 'the static page must not request latest election results');
  assert.deepEqual(errors, []);
});