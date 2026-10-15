const byId = (id) => document.getElementById(id);
const endpoint = '/api/v1/management/election-history';
const validMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const formatter = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const numbers = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 });
let inFlight = false;

function validate(data) {
  if (!data || !Array.isArray(data.availableMonths) || data.availableMonths.some((month) => !validMonth(month))) return null;
  if (!data.availableMonths.length) return data.month === null && data.electionStatus === 'NO_ELECTIONS' ? data : null;
  if (!validMonth(data.month) || !data.availableMonths.includes(data.month) ||
      !['AVAILABLE', 'INCONSISTENT'].includes(data.electionStatus)) return null;
  const p = data.participation;
  if (!p || !['eligible', 'submitted', 'notSubmitted'].every((key) => count(p[key])) ||
      !Number.isFinite(p.percentage) || p.percentage < 0) return null;
  if (!data.results || !['PUBLISHED', 'NOT_PUBLISHED', 'UNVERIFIABLE'].includes(data.results.status)) return null;
  if (data.results.status === 'PUBLISHED') {
    for (const category of ['CUISINE', 'SERVICE']) {
      const entry = data.results.categories?.[category];
      if (!entry || !Array.isArray(entry.winners) ||
          entry.outcome !== (entry.winners.length ? 'WINNERS' : 'NO_WINNER') ||
          entry.winners.some((winner) => typeof winner.name !== 'string' || !winner.name.trim() ||
            typeof winner.role !== 'string')) return null;
    }
  }
  const roster = data.roster;
  if (!roster || !['VERIFIABLE', 'UNVERIFIABLE', 'INCONSISTENT', 'UNAVAILABLE'].includes(roster.status)) return null;
  if (roster.status === 'VERIFIABLE' && (data.electionStatus !== 'AVAILABLE' ||
      !Array.isArray(roster.voters) || roster.voters.length !== p.eligible ||
      roster.voters.some((voter) => typeof voter.name !== 'string' || !voter.name.trim() ||
        typeof voter.department !== 'string' || typeof voter.hasVoted !== 'boolean') ||
      roster.voters.filter((voter) => voter.hasVoted).length !== p.submitted)) return null;
  return data;
}

function clear() {
  byId('dashboard').hidden = true;
  byId('winners').replaceChildren();
  byId('voter-list').replaceChildren();
}

function render(data) {
  const selector = byId('month-select');
  selector.replaceChildren(...data.availableMonths.map((month) => {
    const option = document.createElement('option');
    const [year, number] = month.split('-').map(Number);
    option.value = month;
    option.textContent = formatter.format(new Date(Date.UTC(year, number - 1, 1)));
    return option;
  }));
  if (!data.availableMonths.length) {
    byId('message').textContent = 'Aucune élection enregistrée. La consultation ne crée aucune période.';
    byId('message').hidden = false;
    return;
  }
  selector.value = data.month;
  selector.disabled = false;
  const p = data.participation;
  for (const [id, value] of [['eligible', p.eligible], ['submitted', p.submitted], ['not-submitted', p.notSubmitted]]) {
    byId(id).textContent = numbers.format(value);
  }
  byId('percentage').textContent = `${numbers.format(p.percentage)} %`;
  byId('consistency').textContent = data.electionStatus === 'INCONSISTENT'
    ? 'Anomalie entre les participations et les éligibles enregistrés. Aucune correction automatique n’est effectuée.' : '';
  const published = data.results.status === 'PUBLISHED';
  byId('results-state').textContent = published
    ? 'Résultats définitifs publiés. Les éventuels ex æquo sont tous conservés.'
    : data.results.status === 'UNVERIFIABLE'
      ? 'Les résultats enregistrés ne peuvent pas être vérifiés. Aucun gagnant n’est affiché.'
      : 'Aucun résultat définitif publié pour cette période.';
  if (published) {
    for (const [category, label] of [['CUISINE', 'Cuisine'], ['SERVICE', 'Service']]) {
      const card = document.createElement('article');
      card.className = 'card';
      const heading = document.createElement('h3');
      heading.textContent = label;
      card.append(heading);
      const entry = data.results.categories[category];
      if (!entry.winners.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Aucun gagnant pour cette catégorie.';
        card.append(empty);
      }
      for (const winner of entry.winners) {
        const item = document.createElement('p');
        item.className = 'history-winner';
        const name = document.createElement('strong');
        name.textContent = winner.name;
        const role = document.createElement('span');
        role.textContent = winner.role;
        item.append(name, role);
        card.append(item);
      }
      byId('winners').append(card);
    }
  }
  const verified = data.roster.status === 'VERIFIABLE';
  byId('roster-state').textContent = verified
    ? 'Liste complète issue des identités conservées dans cette élection.'
    : 'Roster historique non vérifiable : les noms et les états individuels ne sont pas affichés. Les chiffres enregistrés restent disponibles.';
  if (verified) {
    for (const voter of data.roster.voters) {
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
      status.textContent = voter.hasVoted ? 'A voté' : 'N’a pas voté';
      item.append(identity, status);
      byId('voter-list').append(item);
    }
  }
  byId('dashboard').hidden = false;
}

async function load(month = byId('month-select').value) {
  if (inFlight) return;
  inFlight = true;
  clear();
  byId('loading').hidden = false;
  byId('message').hidden = true;
  byId('month-select').disabled = true;
  byId('refresh').disabled = true;
  try {
    const response = await fetch(month ? `${endpoint}?month=${encodeURIComponent(month)}` : endpoint, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      location.replace(`/gestion-photos-login.html?error=${response.status === 403 ? 'access' : 'session'}`);
      return;
    }
    if (!response.ok) throw new Error();
    const data = validate(await response.json());
    if (!data || (month && data.month !== month)) throw new Error();
    render(data);
  } catch {
    byId('message').textContent = 'Historique indisponible ou période absente. Aucun résultat ni nom ne peut être déduit. Vous pouvez réessayer avec « Actualiser ».';
    byId('message').hidden = false;
  } finally {
    byId('loading').hidden = true;
    byId('refresh').disabled = false;
    byId('month-select').disabled = !byId('month-select').children.length;
    inFlight = false;
  }
}

byId('month-select').addEventListener('change', (event) => load(event.target.value));
byId('refresh').addEventListener('click', () => load());
load();
