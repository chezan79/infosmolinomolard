const { DEFAULT_PHOTO } = require('./contract');

const ORGANIZATION_LEVELS = Object.freeze([
  { id: 'manager', branch: 'management', label: 'Gérant', order: 0 },
  { id: 'service-adjoint', branch: 'service', label: 'Adjoints', order: 10 },
  { id: 'service-brigade', branch: 'service', label: 'Chefs de brigade', order: 20 },
  { id: 'service-rang', branch: 'service', label: 'Chefs de rang', order: 30 },
  { id: 'service-team', branch: 'service', label: 'Barmen / Commis de rang', order: 40 },
  { id: 'cuisine-management', branch: 'cuisine', label: 'Chef de cuisine', order: 10 },
  { id: 'cuisine-deputy', branch: 'cuisine', label: 'Sous-chefs', order: 20 },
  { id: 'cuisine-stations', branch: 'cuisine', label: 'Chefs de partie / Pizzaioli', order: 30 },
  { id: 'cuisine-support', branch: 'cuisine', label: 'Aides de cuisine / Plonge', order: 40 },
]);

const TITLE_ALIASES = new Map([
  ['gerant', 'manager'],
  ['gerante', 'manager'],
  ['adjoint', 'service-adjoint'],
  ['adjointe', 'service-adjoint'],
  ['responsable de service', 'service-adjoint'],
  ['maitre d hotel', 'service-adjoint'],
  ['chef de service', 'service-adjoint'],
  ['cheffe de service', 'service-adjoint'],
  ['chef de brigade', 'service-brigade'],
  ['cheffe de brigade', 'service-brigade'],
  ['chef de rang', 'service-rang'],
  ['cheffe de rang', 'service-rang'],
  ['assistant responsable de service', 'service-rang'],
  ['assistante responsable de service', 'service-rang'],
  ['serveur', 'service-team'],
  ['serveuse', 'service-team'],
  ['barman', 'service-team'],
  ['barmaid', 'service-team'],
  ['commis de rang', 'service-team'],
  ['runner', 'service-team'],
  ['chef de cuisine', 'cuisine-management'],
  ['cheffe de cuisine', 'cuisine-management'],
  ['sous chef', 'cuisine-deputy'],
  ['sous cheffe', 'cuisine-deputy'],
  ['souschef', 'cuisine-deputy'],
  ['chef de partie', 'cuisine-stations'],
  ['cheffe de partie', 'cuisine-stations'],
  ['pizzaiolo', 'cuisine-stations'],
  ['pizzaiola', 'cuisine-stations'],
  ['pizzaioli', 'cuisine-stations'],
  ['aide de cuisine', 'cuisine-support'],
  ['aide cuisine', 'cuisine-support'],
  ['commis de cuisine', 'cuisine-support'],
  ['commis cuisine', 'cuisine-support'],
  ['collaborateur d office', 'cuisine-support'],
  ['collaboratrice d office', 'cuisine-support'],
  ['plonge', 'cuisine-support'],
  ['plongeur', 'cuisine-support'],
  ['plongeuse', 'cuisine-support'],
]);

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function mapOrganizationTitle(jobTitle) {
  return TITLE_ALIASES.get(normalizeTitle(jobTitle)) || null;
}

function publicMember(employee, resolvePhotoUrl = (_employeeId, fallback) => fallback) {
  return {
    displayName: employee.displayName,
    jobTitle: employee.jobTitle,
    photoUrl: resolvePhotoUrl(employee.employeeId, employee.photoUrl || DEFAULT_PHOTO) || DEFAULT_PHOTO,
  };
}

function buildPublicOrganization(snapshot, resolvePhotoUrl) {
  if (!snapshot || !Array.isArray(snapshot.employees)) return null;
  const membersByLevel = new Map(ORGANIZATION_LEVELS.map((level) => [level.id, []]));
  const unmapped = new Map();

  for (const employee of snapshot.employees) {
    if (!employee.active) continue;
    const levelId = mapOrganizationTitle(employee.jobTitle);
    if (!levelId) {
      const title = String(employee.jobTitle || '').trim() || '(sans intitulé)';
      unmapped.set(title, (unmapped.get(title) || 0) + 1);
      continue;
    }
    membersByLevel.get(levelId).push(publicMember(employee, resolvePhotoUrl));
  }

  const collator = new Intl.Collator('fr', { sensitivity: 'base' });
  const levels = ORGANIZATION_LEVELS.map(({ id, branch, label, order }) => ({
    id,
    branch,
    label,
    order,
    members: membersByLevel.get(id).sort((a, b) => collator.compare(a.displayName, b.displayName)),
  }));
  return {
    publicResponse: { levels },
    report: {
      mappedTitles: [...new Set(levels.flatMap((level) => level.members.map((member) => member.jobTitle)))].sort(collator.compare),
      unmappedTitles: [...unmapped].map(([jobTitle, count]) => ({ jobTitle, count })),
    },
  };
}

module.exports = {
  ORGANIZATION_LEVELS,
  TITLE_ALIASES,
  buildPublicOrganization,
  mapOrganizationTitle,
  normalizeTitle,
};