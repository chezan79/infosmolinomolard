const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'collaborateur-du-mois.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'collaborateur-du-mois.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'collaborateur-du-mois.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const publicFiles = fs.readFileSync(path.join(root, 'public-files.js'), 'utf8');
const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const homepageNavigation = fs.readFileSync(path.join(root, 'homepage-navigation.js'), 'utf8');

test('stable extensionless voting route serves a no-store static page', () => {
  assert.match(server, /app\.get\('\/collaborateur-du-mois'/);
  assert.match(server, /collaborateur-du-mois\.html/);
  assert.match(server, /Cache-Control', 'no-store'/);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /name="viewport"/);
});

test('voting page keeps credentials and authorization out of URLs and persistent storage', () => {
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(js, /console\.(?:log|info|debug|warn|error)/);
  assert.match(js, /body: JSON\.stringify\(\{ salaireId:value \}\)/);
  assert.match(js, /Authorization: `Bearer \$\{state\.token\}`/);
  assert.doesNotMatch(html + css, /https?:\/\//);
});

test('flow uses every authoritative API and submits both categories atomically', () => {
  for (const operation of ["request('')", "request('/verify-code'", "request('/participation')", "request('/candidates')", "request('/ballots'"]) {
    assert.ok(js.includes(operation), `missing ${operation}`);
  }
  assert.match(js, /choices: state\.choices, comments: \{ CUISINE:/);
  assert.match(js, /if \(state\.busy\) return/);
  assert.match(js, /button\.disabled = true/);
  assert.match(js, /result\.code !== 'SUBMITTED'/);
});

test('candidate selection is local, safe, searchable, and photo-fallback capable', () => {
  assert.match(js, /\.normalize\('NFD'\)/);
  assert.match(js, /displayName} \$\{c\.jobTitle/);
  assert.match(js, /avatar-fallback/);
  assert.match(js, /onerror=/);
  for (const forbidden of ['verifier', 'canVote', 'canBeElected', 'salaireId']) {
    assert.doesNotMatch(js.slice(js.indexOf('function candidateCard'), js.indexOf('function renderChoices')), new RegExp(forbidden));
  }
});

test('validation, review, editing, finality, and recovery states are present', () => {
  assert.match(js, /COMMENT_MIN = 10, COMMENT_MAX = 1000/);
  assert.match(js, /state\.comments\[category\]\.trim\(\)\.length/);
  assert.match(js, /data-edit=/);
  assert.match(js, /finality/);
  assert.match(js, /restart/);
  for (const code of ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'ALREADY_VOTED', 'INVALID_AUTHORIZATION', 'ELECTION_NOT_OPEN', 'INVALID_BALLOT', 'SERVICE_UNAVAILABLE']) {
    assert.ok(js.includes(code), `missing safe mapping for ${code}`);
  }
});

test('all user-facing resources cover French, Italian, and English without results UI', () => {
  for (const locale of ['fr:', 'it:', 'en:']) assert.ok(js.includes(locale));
  assert.match(js, /document\.documentElement\.lang = state\.locale/);
  assert.match(html, /option value="fr"/);
  assert.match(html, /option value="it"/);
  assert.match(html, /option value="en"/);
  for (const forbidden of ['classement', 'ranking', 'percentuale', 'percentage', 'résultats du vote', 'vote count']) {
    assert.equal((html + js).toLowerCase().includes(forbidden), false);
  }
});

test('mobile accessibility and homepage regression protections remain in place', () => {
  assert.match(css, /width: min\(100% - 32px, 720px\)/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.match(js, /\.focus\(\)/);
  assert.match(homepage, /id="Navigation"/);
  assert.match(homepage, /competition-mois\.html/);
});

test('homepage permanently links to voting with localized public navigation copy', () => {
  assert.match(
    homepage,
    /href="\/collaborateur-du-mois"[\s\S]*data-i18n="employeeOfTheMonth"[\s\S]*Collaborateur du mois/,
  );
  assert.match(publicFiles, /'homepage-navigation\.js'/);
  assert.match(homepage, /href="competition-mois\.html"[\s\S]*🏆 Compétition du mois/);
  for (const label of [
    'Collaborateur du mois',
    'Collaboratore del mese',
    'Employee of the Month',
  ]) {
    assert.ok((homepage + homepageNavigation).includes(label), `missing ${label}`);
  }
  assert.doesNotMatch(homepageNavigation, /Date|firebase|auth|election|fetch|Salaire-ID/i);
});
