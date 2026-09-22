const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { createDirectoryRuntime } = require('../employee-directory');
const {
  ORGANIZATION_LEVELS,
  buildPublicOrganization,
  mapOrganizationTitle,
  normalizeTitle,
} = require('../employee-directory/organization');
const { mountPublicFiles, publicRootFile } = require('../public-files');

const root = path.join(__dirname, '..');

function employee(overrides = {}) {
  return {
    employeeId: 'emp-1',
    displayName: 'Anna Rossi',
    jobTitle: 'Cheffe de cuisine',
    department: 'Cuisine',
    votingGroup: 'CUISINE',
    active: true,
    canVote: true,
    canBeElected: true,
    photoUrl: '/legacy.jpg',
    siteId: 'molard',
    salaireId: 'must-not-leak',
    verifier: 'must-not-leak',
    permissions: ['admin'],
    participation: { votes: 4 },
    ...overrides,
  };
}

function snapshot(employees) {
  return {
    schemaVersion: 1,
    siteId: 'molard',
    sourceGeneration: 1,
    refreshedAt: '2026-09-22T10:00:00.000Z',
    employees,
    verifierRecords: [],
    warnings: [],
  };
}

test('organization title mapping is accent and case tolerant but never guesses unknown titles', () => {
  assert.equal(normalizeTitle("  MAÎTRE D’HÔTEL "), 'maitre d hotel');
  assert.equal(mapOrganizationTitle('GÉRANTE'), 'manager');
  assert.equal(mapOrganizationTitle('Chef de Brigade'), 'service-brigade');
  assert.equal(mapOrganizationTitle('Souschef'), 'cuisine-deputy');
  assert.equal(mapOrganizationTitle("Collaborateur d'office"), 'cuisine-support');
  assert.equal(mapOrganizationTitle('Pizzaiola'), 'cuisine-stations');
  assert.equal(mapOrganizationTitle('Plongeuse'), 'cuisine-support');
  assert.equal(mapOrganizationTitle('Chef'), null);
  assert.deepEqual(ORGANIZATION_LEVELS.map((level) => level.id), [
    'manager',
    'service-adjoint',
    'service-brigade',
    'service-rang',
    'service-team',
    'cuisine-management',
    'cuisine-deputy',
    'cuisine-stations',
    'cuisine-support',
  ]);
});

test('public organization filters inactive and unknown titles and uses an exact public allowlist', () => {
  const result = buildPublicOrganization(snapshot([
    employee(),
    employee({
      employeeId: 'pizza-1',
      displayName: 'Luca',
      jobTitle: 'Pizzaiolo',
      department: 'Pizzeria',
      photoUrl: '/pizza.jpg',
    }),
    employee({
      employeeId: 'plonge-1',
      displayName: 'Mia',
      jobTitle: 'Plonge',
      department: 'Plonge',
    }),
    employee({ employeeId: 'inactive', displayName: 'Inactive', active: false }),
    employee({ employeeId: 'unknown', displayName: 'Unknown', jobTitle: 'Chef' }),
  ]), (employeeId, fallback) => employeeId === 'pizza-1' ? '/managed.webp' : fallback);

  const station = result.publicResponse.levels.find((level) => level.id === 'cuisine-stations');
  const support = result.publicResponse.levels.find((level) => level.id === 'cuisine-support');
  assert.equal(station.branch, 'cuisine');
  assert.equal(station.members[0].photoUrl, '/managed.webp');
  assert.equal(support.members[0].displayName, 'Mia');
  assert.deepEqual(Object.keys(station.members[0]).sort(), ['displayName', 'jobTitle', 'photoUrl']);
  assert.deepEqual(result.report.unmappedTitles, [{ jobTitle: 'Chef', count: 1 }]);
  const json = JSON.stringify(result.publicResponse);
  for (const prohibited of [
    'must-not-leak', 'employeeId', 'siteId', 'votingGroup', 'canVote',
    'canBeElected', 'permissions', 'participation', 'verifier', 'photoStatus',
  ]) {
    assert.equal(json.includes(prohibited), false, `public response leaked ${prohibited}`);
  }
  assert.equal(json.includes('Inactive'), false);
  assert.equal(json.includes('Unknown'), false);
});

test('public organization route serves only the last-known-good public model and handles unavailability', async (t) => {
  const runtime = createDirectoryRuntime({
    env: { EMPLOYEE_DIRECTORY_SITE_ID: 'molard', EMPLOYEE_DIRECTORY_PEPPER: 'test-pepper' },
    firebaseDb: null,
    firebaseAuth: null,
    firebaseBucket: null,
  });
  const app = express();
  runtime.mount(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const unavailable = await fetch(`${base}/api/v1/public/organization`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'DIRECTORY_UNAVAILABLE' });

  runtime.service.snapshot = snapshot([employee()]);
  runtime.service.resolvePhotoUrl = () => '/managed.webp';
  const response = await fetch(`${base}/api/v1/public/organization`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(body), ['levels']);
  assert.equal(body.levels.find((level) => level.id === 'cuisine-management').members[0].photoUrl, '/managed.webp');
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
});

test('organigramme assets preserve hierarchy, safe rendering, image fallback and responsive layout', async (t) => {
  const html = fs.readFileSync(path.join(root, 'organigramme.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'organigramme.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'organigramme.css'), 'utf8');
  const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(homepage, /href="organigramme\.html"[\s\S]*👥 Organigramme/);
  assert.ok(html.indexOf('id="manager-title"') < html.indexOf('id="service-title"'));
  assert.ok(html.indexOf('id="service-title"') < html.indexOf('id="cuisine-title"'));
  assert.match(js, /\.textContent = person\.displayName/);
  assert.match(js, /\.textContent = person\.jobTitle/);
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(js, /avatar-neutral\.svg/);
  assert.match(js, /addEventListener\('error'/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.equal(publicRootFile('/organigramme.html'), 'organigramme.html');
  assert.equal(publicRootFile('/organigramme.css'), 'organigramme.css');
  assert.equal(publicRootFile('/organigramme.js'), 'organigramme.js');

  const app = express();
  mountPublicFiles(app, root);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  for (const asset of ['organigramme.html', 'organigramme.css', 'organigramme.js']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${asset}`);
    assert.equal(response.status, 200, `${asset} should be public`);
  }
});