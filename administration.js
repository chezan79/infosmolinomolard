document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/api/v1/management/session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } finally {
    location.replace('/gestion-photos-login.html');
  }
});
const sync = document.getElementById('directory-sync');
const add = document.getElementById('voter-only-add');
const status = document.getElementById('directory-sync-status');
async function request(path, body) {
  sync.disabled = add.disabled = true;
  status.textContent = 'Vérification en cours…';
  try {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 401 || response.status === 403) { location.replace('/gestion-photos-login.html'); return; }
    const data = await response.json();
    if (!response.ok) { status.textContent = 'Opération refusée ou indisponible : ' + (data.code || data.error || 'ERREUR'); return; }
    status.textContent = data.code === 'VOTER_ADDED' ? 'Électeur ajouté au scrutin ' + data.month :
      data.code === 'ALREADY_ELIGIBLE' ? 'Cet électeur est déjà inscrit.' :
      'Annuaire synchronisé. Électeurs dans l’annuaire : ' + data.counts.voters + '.';
  } catch { status.textContent = 'Connexion indisponible. Vérifiez avant de réessayer.'; }
  finally { sync.disabled = add.disabled = false; }
}
sync.addEventListener('click', () => request('/api/v1/management/employee-directory/refresh'));
add.addEventListener('click', () => {
  const employeeId = document.getElementById('voter-only-id').value.trim();
  if (!/^MOL-[0-9]+$/.test(employeeId)) { status.textContent = 'Employee ID invalide.'; return; }
  if (window.confirm('Ajouter cet électeur non candidat au scrutin en cours ?')) {
    void request('/api/v1/management/election-add-voter-only', { employeeId });
  }
});
