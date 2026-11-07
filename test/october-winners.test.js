const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const readPage = () => fs.readFileSync(path.join(root, 'resultats_collaborateurs-du-mois.html'), 'utf8');
const winners = [
  ['Vizzi Angelo', 'Sous-chef', 'octobre-2026-vizzi-angelo.jpg'],
  ['Masbernard Loïc', 'Chef de partie', 'octobre-2026-masbernard-loic.jpg'],
  ['Duarte Alexander', 'Barman', 'octobre-2026-duarte-alexander.jpg'],
  ['Benchennouf Fares', 'Chef de brigade', 'octobre-2026-benchennouf-fares.jpg'],
];

test('October announcement precedes the byte-identical September winner cards', () => {
  const html = readPage();
  const september = html.match(/    <section class="winner-grid" aria-label="Collaborateurs distingués en septembre 2026">[\s\S]*?<\/section>/);
  assert.ok(september, 'keep the existing September cards and their accessible section label');
  assert.equal(createHash('sha256').update(september[0]).digest('hex'),
    'db969d98226c697750df327c1fc9ed9d48d22babba875d2f756aa7d1452de19b');
  assert.ok(html.indexOf('OCTOBRE 2026') < html.indexOf('SEPTEMBRE 2026'));
  const cards = html.match(/<article\b[\s\S]*?<\/article>/g) || [];
  assert.equal(cards.length, 6);
  for (const [name, role, filename] of winners) {
    const card = cards.find((value) => value.includes(`>${name}</h3>`));
    assert.ok(card, `${name} has an individual card`);
    assert.ok(card.includes(`>${role}</p>`), `${name}: exact owner-supplied role`);
    assert.ok(card.includes(`/assets/collaborateurs-du-mois/${filename}`), `${name}: correct original photo derivative`);
    assert.ok(html.indexOf(card) < september.index);
  }
  assert.doesNotMatch(html, /<script\b|\/api\/v1\/public\/election-results/);
});

test('All four October photo derivatives are portrait JPEGs with their original 3:4 proportions', async () => {
  for (const [, , filename] of winners) {
    const image = await sharp(path.join(root, 'assets/collaborateurs-du-mois', filename)).metadata();
    assert.equal(image.format, 'jpeg');
    assert.equal(image.width, 1200);
    assert.equal(image.height, 1600);
  }
});
