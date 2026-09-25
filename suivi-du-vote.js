const endpoint = '/api/v1/management/election-monitoring';
const byId = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFormatter = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const statusLabels = { OPEN: 'Vote ouvert', UPCOMING: 'Vote à venir', CLOSED: 'Vote clôturé' };
let inFlight = false;

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
      !data.window || !data.participation || !data.systemHealth) return null;
  const opens = dateValue(data.window.opensAt);
  const closes = dateValue(data.window.closesAt);
  if (!opens || !closes || opens >= closes ||
      !validCount(data.eligibleVoters) || !validCount(data.participation.count) ||
      !validCount(data.participation.remaining) ||
      !Number.isFinite(data.participation.percentage) || data.participation.percentage < 0 ||
      !validCount(data.systemHealth.participationRecords) ||
      !validCount(data.systemHealth.anonymousBallots) ||
      !['OK', 'ANOMALY'].includes(data.systemHealth.consistency)) return null;
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
  };
}

function showMessage(text, retry = false) {
  byId('loading').hidden = true;
  byId('dashboard').hidden = true;
  byId('message').hidden = false;
  byId('message-text').textContent = text;
  byId('retry').hidden = !retry;
}

function render(data) {
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
  const coherent = data.consistency === 'OK' && data.records === data.ballots && data.records <= data.eligible;
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
      byId('dashboard').hidden = true;
      location.replace('/gestion-photos-login.html?error=session');
      return;
    }
    if (response.status === 403) {
      byId('dashboard').hidden = true;
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
load();