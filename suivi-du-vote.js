const endpoint = '/api/v1/management/election-monitoring';
const byId = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFormatter = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const statusLabels = { OPEN: 'Vote ouvert', UPCOMING: 'Vote à venir', CLOSED: 'Vote clôturé' };
let inFlight = false;
let voters = [];
let filter = 'all';
const collator = new Intl.Collator('fr', { sensitivity: 'base' });
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function approved(data) {
  if (!data || typeof data !== 'object' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) ||
      !Object.hasOwn(statusLabels, data.status) ||
      !data.window || !data.participation || !data.systemHealth || !data.individual ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(data.individual.status)) return null;
  const opens = dateValue(data.window.opensAt);
  const closes = dateValue(data.window.closesAt);
  if (!opens || !closes || opens >= closes ||
      !validCount(data.eligibleVoters) || !validCount(data.participation.count) ||
      !validCount(data.participation.remaining) ||
      !Number.isFinite(data.participation.percentage) || data.participation.percentage < 0 ||
      !validCount(data.systemHealth.participationRecords) ||
      !validCount(data.systemHealth.anonymousBallots) ||
       !['OK', 'ANOMALY'].includes(data.systemHealth.consistency) ||
       (data.individual.status === 'UNAVAILABLE' && Object.hasOwn(data.individual, 'voters')) ||
       (data.individual.status === 'AVAILABLE' &&
        (!Array.isArray(data.individual.voters) ||
        data.individual.voters.length !== data.eligibleVoters ||
        data.individual.voters.some((voter) => !voter || typeof voter.name !== 'string' ||
         !voter.name.trim() || typeof voter.department !== 'string' || !voter.department.trim() ||
          typeof voter.hasVoted !== 'boolean')))) return null;
  return {
    month: data.month,
    status: data.status,
    opens, closes,
    eligible: data.eligibleVoters,
    voted: data.participation.count,
    remaining: data.participation.remaining,
    percentage: data.participation.percentage,
    records: data.systemHealth.participationRecords,
    ballots: data.systemHealth.anonymousBallots,
    consistency: data.systemHealth.consistency,
    voters: data.individual.status === 'AVAILABLE'
      ? data.individual.voters.map(({ name, department, hasVoted }) => ({ name, department, hasVoted }))
      : null,
  };
}

function renderVoters() {
  const voted = voters.filter((voter) => voter.hasVoted).length;
  for (const [id, label, count, value] of [
    ['filter-all', 'Tous', voters.length, 'all'],
    ['filter-voted', 'A voté', voted, 'voted'],
    ['filter-pending', 'À voter', voters.length - voted, 'pending'],
  ]) {
    byId(id).textContent = `${label} (${number.format(count)})`;
    byId(id).setAttribute('aria-pressed', String(filter === value));
  }
  const query = normalize(byId('voter-search').value.trim());
  const visible = voters.filter((voter) =>
    (filter === 'all' || voter.hasVoted === (filter === 'voted')) &&
    (!query || normalize(`${voter.name} ${voter.department}`).includes(query)));
  const list = byId('voter-list');
  list.replaceChildren();
  for (const voter of visible) {
    const item = document.createElement('li');
    const identity = document.createElement('div');
    identity.className = 'voter-identity';
    const name = document.createElement('strong');
    name.textContent = voter.name;
    const department = document.createElement('span');
    department.textContent = voter.department;
    identity.append(name, department);
    const status = document.createElement('span');
    status.className = `voter-state${voter.hasVoted ? ' voted' : ''}`;
    status.textContent = voter.hasVoted ? 'A voté' : 'À voter';
    item.append(identity, status);
    list.append(item);
  }
  byId('voter-summary').textContent = `${number.format(visible.length)} collaborateur${visible.length > 1 ? 's' : ''} affiché${visible.length > 1 ? 's' : ''}`;
}

function clearDashboard() {
  voters = [];
  byId('voter-list').replaceChildren();
  byId('voter-controls').hidden = true;
  byId('voter-unavailable').hidden = true;
  for (const id of ['month', 'election-status', 'window', 'eligible', 'voted', 'remaining',
    'percentage', 'progress-count', 'progress-label', 'records', 'ballots', 'consistency',
    'results-state', 'results-explanation', 'voter-summary',
    'filter-all', 'filter-voted', 'filter-pending']) byId(id).textContent = '';
  byId('progress').removeAttribute('aria-valuenow');
  byId('progress').removeAttribute('aria-valuetext');
  byId('progress-fill').style.width = '0%';
  byId('dashboard').hidden = true;
}

function showMessage(text, retry = false) {
  clearDashboard();
  byId('loading').hidden = true;
  byId('message').hidden = false;
  byId('message-text').textContent = text;
  byId('retry').hidden = !retry;
}

function render(data) {
  voters = data.voters ? data.voters.sort((a, b) => collator.compare(a.name, b.name)) : [];
  byId('voter-controls').hidden = !data.voters;
  byId('voter-unavailable').hidden = Boolean(data.voters);
  if (data.voters) renderVoters();
  else {
    byId('voter-list').replaceChildren();
    byId('voter-summary').textContent = '';
  }
  const monthParts = data.month.split('-').map(Number);
  byId('month').textContent = monthFormatter.format(new Date(Date.UTC(monthParts[0], monthParts[1] - 1, 1)));
  byId('election-status').textContent = statusLabels[data.status];
  byId('election-status').className = `state-badge ${data.status.toLowerCase()}`;
  // The end instant is exclusive: present the final calendar day included in the voting window.
  byId('window').textContent = `Du ${dayFormatter.format(data.opens)} au ${dayFormatter.format(new Date(data.closes.getTime() - 1))}`;
  byId('eligible').textContent = number.format(data.eligible);
  byId('voted').textContent = number.format(data.voted);
  byId('remaining').textContent = number.format(data.remaining);
  byId('percentage').textContent = `${number.format(data.percentage)} %`;
  byId('progress-count').textContent = `${number.format(data.voted)} / ${number.format(data.eligible)}`;
  byId('progress-label').textContent = `${number.format(data.percentage)} %`;
  byId('progress').setAttribute('aria-valuenow', String(Math.min(data.percentage, 100)));
  byId('progress').setAttribute('aria-valuetext', `${number.format(data.percentage)} % — ${number.format(data.voted)} sur ${number.format(data.eligible)} électeurs`);
  byId('progress-fill').style.width = `${Math.min(data.percentage, 100)}%`;
  byId('records').textContent = number.format(data.records);
  byId('ballots').textContent = number.format(data.ballots);
  const coherent = data.consistency === 'OK' && data.records === data.ballots &&
    (!data.voters || data.records === voters.filter((voter) => voter.hasVoted).length) &&
    data.records <= data.eligible;
  byId('consistency').textContent = coherent ? 'Système cohérent' : 'Anomalie détectée';
  byId('consistency').className = coherent ? '' : 'anomaly';
  byId('results-state').textContent = data.status === 'CLOSED' ? 'Résultats indisponibles' : '🔒 Résultats masqués';
  byId('results-explanation').textContent = data.status === 'CLOSED'
    ? 'Le suivi du vote ne fournit pas encore les résultats définitifs.'
    : data.status === 'UPCOMING'
      ? 'Les résultats resteront masqués jusqu’à la clôture du vote.'
      : 'Les résultats seront disponibles après la clôture du vote.';
  byId('loading').hidden = true;
  byId('message').hidden = true;
  byId('dashboard').hidden = false;
}

async function load() {
  if (inFlight) return;
  inFlight = true;
  const wasVisible = !byId('dashboard').hidden;
  // Never retain named status while a refresh is pending.
  voters = [];
  byId('voter-list').replaceChildren();
  byId('voter-controls').hidden = true;
  byId('voter-unavailable').hidden = false;
  byId('voter-summary').textContent = '';
  byId('refresh').disabled = true;
  byId('retry').disabled = true;
  if (wasVisible) {
    byId('dashboard').setAttribute('aria-busy', 'true');
    byId('refresh-status').textContent = 'Actualisation en cours…';
  } else {
    byId('message').hidden = true;
    byId('loading').hidden = false;
  }
  try {
    const response = await fetch(endpoint, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      clearDashboard();
      location.replace('/gestion-photos-login.html?error=session');
      return;
    }
    if (response.status === 403) {
      clearDashboard();
      location.replace('/gestion-photos-login.html?error=access');
      return;
    }
    if (response.status === 404) {
      const body = await response.json();
      if (body?.error === 'ELECTION_NOT_FOUND') {
        showMessage('Aucune élection active trouvée pour cette période.');
        return;
      }
    }
    if (!response.ok) throw new Error('MONITORING_UNAVAILABLE');
    const data = approved(await response.json());
    if (!data) throw new Error('INVALID_MONITORING_RESPONSE');
    render(data);
  } catch {
    showMessage('Les données de suivi du vote sont momentanément indisponibles.', true);
  } finally {
    byId('dashboard').removeAttribute('aria-busy');
    byId('refresh-status').textContent = '';
    byId('refresh').disabled = false;
    byId('retry').disabled = false;
    inFlight = false;
  }
}

byId('refresh').addEventListener('click', load);
byId('retry').addEventListener('click', load);
for (const id of ['filter-all', 'filter-voted', 'filter-pending']) {
  byId(id).addEventListener('click', () => {
    filter = { 'filter-all': 'all', 'filter-voted': 'voted', 'filter-pending': 'pending' }[id];
    renderVoters();
  });
}
byId('voter-search').addEventListener('input', renderVoters);
load();