const status = document.getElementById('runtime-diagnostic-status');
const checks = document.getElementById('runtime-diagnostic-checks');
const refresh = document.getElementById('runtime-diagnostic-refresh');
const labels = {
  firebaseAdminProjectId: 'Projet Admin : infosmolinomoard',
  firestoreDatabaseId: 'Base Firestore : (default)',
  siteId: 'Site : molard',
  dataEnvironment: 'Archive : production',
  nodeEnv: 'Runtime Node : production',
  timeZone: 'Fuseau : Europe/Zurich',
  resultsProjectId: 'Projet résultats : infosmolinomoard',
  resultsDatabaseId: 'Base résultats : (default)',
  emulators: 'Émulateurs : absents',
};
const statuses = { MATCH: 'Conforme', MISSING: 'Manquant', MISMATCH: 'Non conforme', UNAVAILABLE: 'Indisponible' };
refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  checks.replaceChildren();
  status.textContent = 'Vérification en cours…';
  try {
    const response = await fetch('/api/v1/management/election-runtime-diagnostic', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      location.replace(`/gestion-photos-login.html?error=${response.status === 403 ? 'access' : 'session'}`);
      return;
    }
    if (!response.ok) throw new Error();
    const report = await response.json();
    if (report?.scope !== 'OFFICIAL_PRODUCTION' || !['VERIFIED', 'BLOCKED'].includes(report.status) ||
        report.inspection !== 'CLIENT_METADATA_AND_CONFIGURATION_ONLY' ||
        !report.checks || Object.keys(report.checks).length !== Object.keys(labels).length ||
        Object.keys(labels).some((key) => !Object.hasOwn(statuses, report.checks[key])) ||
        (report.status === 'VERIFIED') !== Object.keys(labels).every((key) => report.checks[key] === 'MATCH')) throw new Error();
    status.textContent = report.status === 'VERIFIED'
      ? 'Configuration officielle conforme pour le processus qui répond à cette requête. Aucun vote n’a été lu.'
      : 'Liaison officielle non attestée. Ne pas utiliser les données de cet environnement comme résultats officiels. En Preview, un échec est attendu.';
    for (const [key, label] of Object.entries(labels)) {
      const row = document.createElement('div');
      const name = document.createElement('dt');
      name.textContent = label;
      const result = document.createElement('dd');
      result.textContent = statuses[report.checks[key]];
      row.append(name, result);
      checks.append(row);
    }
  } catch {
    checks.replaceChildren();
    status.textContent = 'Diagnostic indisponible. Aucune liaison officielle ne peut être attestée.';
  } finally {
    refresh.disabled = false;
  }
});
// Do not accept clicks before this module has attached its handler.
refresh.disabled = false;
