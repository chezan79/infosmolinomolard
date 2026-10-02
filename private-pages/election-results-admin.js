const LIST_ENDPOINT = '/api/v1/management/election-results';
const LOGIN_PATH = '/gestion-photos-login.html';
const loading = document.getElementById('loading');
const message = document.getElementById('message');
const messageTitle = document.getElementById('message-title');
const messageText = document.getElementById('message-text');
const retryButton = document.getElementById('retry');
const dashboard = document.getElementById('dashboard');
const refreshButton = document.getElementById('refresh');
const refreshStatus = document.getElementById('refresh-status');
const monthsList = document.getElementById('months-list');
const monthsEmpty = document.getElementById('months-empty');
const recoveryInFlight = new Set();

const stateLabels = {
  VOTING_UPCOMING: 'Vote à venir',
  VOTING_OPEN: 'Vote ouvert',
  VOTING_CLOSED: 'Vote clôturé',
  FINALIZING: 'Finalisation automatique',
  PUBLISHED: 'Publié',
  RESULT_REQUIRES_VERIFICATION: 'Résultat à vérifier',
};

const reasonLabels = {
  OK: 'Fonctionnement normal',
  ERROR: 'Le dernier passage a rencontré une erreur.',
  RUNNING: 'Un passage est en cours.',
  VERIFICATION_REQUIRED: 'Une ou plusieurs périodes nécessitent une vérification.',
  SEPTEMBER_RECOVERY_HOLD: 'Septembre 2026 reste en attente de vérification de la source de production. Aucune finalisation ni publication n’est autorisée.',
  ELECTION_DATA_INVALID: 'Les métadonnées de cette élection ne correspondent pas à la source attendue.',
  ELECTION_WINDOW_INVALID: 'Les dates de cette élection ne correspondent pas à la fenêtre canonique.',
  RESULTS_SEALED: 'La période de vote n’est pas clôturée.',
  AWAITING_SETTLEMENT: 'Clôture confirmée. Le délai de sécurité des soumissions en cours doit encore se terminer.',
  COUNT_MISMATCH: 'Le nombre de bulletins et les participations ne sont pas cohérents.',
  BALLOT_INVALID: 'Un bulletin ne respecte pas le format canonique attendu.',
  LATE_BALLOT: 'Un bulletin a été enregistré après la limite de clôture.',
  CANDIDATE_INVALID: 'Une référence de candidat ne correspond pas à la catégorie ou à la sauvegarde de cette élection.',
  RESULT_MISMATCH: 'Le résultat finalisé ne correspond pas au calcul canonique.',
  SOURCE_CHANGED: 'La source a changé pendant le traitement. Une vérification est nécessaire.',
  PUBLICATION_MISMATCH: 'La publication existante ne correspond pas au résultat canonique.',
  PUBLICATION_INVALID: 'La publication existante ne peut pas être vérifiée.',
  UNEXPECTED_STATE: 'Un état de traitement inattendu doit être vérifié.',
  LEASE_LOST: 'Un autre traitement a pris le relais. La tentative sera reprise en sécurité.',
  VOTING_NOT_CLOSED: 'La période de vote est toujours ouverte.',
  VOTES_STILL_ACCEPTED: 'Le système de vote n’a pas encore confirmé sa clôture.',
  INTEGRITY_CHECK_FAILED: 'Une vérification d’intégrité nécessite un contrôle.',
  SNAPSHOT_UNAVAILABLE: 'La sauvegarde temporaire est momentanément indisponible.',
  STORAGE_UNAVAILABLE: 'Le stockage des résultats est momentanément indisponible.',
  STORAGE_DISABLED: 'Le stockage des résultats est désactivé.',
  PIPELINE_RETRY_SCHEDULED: 'Une nouvelle tentative automatique est programmée.',
  RESULT_ALREADY_PUBLISHED: 'Les résultats de cette période sont publiés.',
  NO_WINNERS: 'Aucune personne ne remplit les critères de distinction.',
  RETRY_LIMIT_REACHED: 'Le traitement a atteint sa limite de tentatives automatiques.',
  HEALTHY: 'Le système fonctionne normalement.',
  SUCCESS: 'La dernière opération s’est terminée correctement.',
  SUCCEEDED: 'La dernière opération s’est terminée correctement.',
  RUNNING: 'Un traitement est actuellement en cours.',
  FAILED: 'La dernière opération a rencontré une erreur.',
  ERROR: 'Une erreur a été signalée par le système.',
  WAITING: 'Le système attend la prochaine tentative.',
  IDLE: 'Aucun traitement n’est en cours.',
  UNKNOWN: 'Le traitement attend une vérification du système.',
};

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validMonth(value) { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function validIso(value, nullable = true) {
  return (nullable && value === null) || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function validateMonth(item) {
  const states = Object.keys(stateLabels);
  if (!isObject(item) || !validMonth(item.month) || !states.includes(item.state) ||
      !(item.reason === null || typeof item.reason === 'string') ||
      !validIso(item.publishedAt) || !validIso(item.lastAttemptAt) || !validIso(item.retryAt) ||
      typeof item.held !== 'boolean') return null;
  return { month: item.month, state: item.state, reason: item.reason, publishedAt: item.publishedAt, lastAttemptAt: item.lastAttemptAt, retryAt: item.retryAt, held: item.held };
}

function validatePayload(data) {
  if (!isObject(data) || typeof data.enabled !== 'boolean' || typeof data.automationEnabled !== 'boolean' ||
      !['AVAILABLE', 'DISABLED', 'UNAVAILABLE'].includes(data.storageStatus) ||
      !(data.heartbeat === null || (isObject(data.heartbeat) && validIso(data.heartbeat.lastAttemptAt, false) &&
        validIso(data.heartbeat.lastSuccessAt) && typeof data.heartbeat.status === 'string' && data.heartbeat.status.length <= 100)) ||
      !Array.isArray(data.months) || data.months.length > 120) return null;
  const months = data.months.map(validateMonth);
  if (months.some((month) => !month)) return null;
  return { enabled: data.enabled, automationEnabled: data.automationEnabled, storageStatus: data.storageStatus, heartbeat: data.heartbeat, months };
}

function formatMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
function formatDate(value) {
  if (!value) return 'Non disponible';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function safeReason(reason) {
  if (!reason) return 'Aucun diagnostic complémentaire.';
  return reasonLabels[reason] || reasonLabels.UNKNOWN;
}
function setPill(node, label, mood) {
  node.textContent = label;
  node.className = `state-pill${mood ? ` ${mood}` : ''}`;
}
function appendCell(parent, label, value) {
  const cell = document.createElement('div');
  cell.className = 'heartbeat-cell';
  const title = document.createElement('span');
  title.textContent = label;
  const content = document.createElement('strong');
  content.textContent = value;
  cell.append(title, content);
  parent.append(cell);
}

function showError(title, copy, canRetry = true) {
  loading.hidden = true;
  dashboard.hidden = true;
  message.hidden = false;
  messageTitle.textContent = title;
  messageText.textContent = copy;
  retryButton.hidden = !canRetry;
}

function renderMonth(item, globallyEnabled) {
  const row = document.createElement('article');
  row.className = 'month-row';
  const month = document.createElement('strong');
  month.className = 'month-period';
  month.textContent = formatMonth(item.month);
  const statusArea = document.createElement('div');
  statusArea.className = 'month-status';
  const pill = document.createElement('span');
  const stateMood = item.state === 'PUBLISHED' ? '' : item.state === 'RESULT_REQUIRES_VERIFICATION' ? 'error' : item.state === 'VOTING_OPEN' || item.state === 'FINALIZING' ? 'warning' : '';
  setPill(pill, stateLabels[item.state], stateMood);
  statusArea.append(pill);
  if (item.held) {
    const held = document.createElement('small');
    held.className = 'hold-note';
    held.textContent = 'Traitement suspendu pour contrôle.';
    statusArea.append(held);
  }
  const diagnostics = document.createElement('div');
  diagnostics.className = 'month-diagnostics';
  const reason = document.createElement('span');
  reason.textContent = safeReason(item.reason);
  diagnostics.append(reason);
  if (item.publishedAt) {
    const date = document.createElement('span');
    date.textContent = `Publié le ${formatDate(item.publishedAt)}`;
    diagnostics.append(date);
  }
  if (item.lastAttemptAt) {
    const attempt = document.createElement('span');
    attempt.textContent = `Dernier essai : ${formatDate(item.lastAttemptAt)}`;
    diagnostics.append(attempt);
  }
  if (item.retryAt) {
    const retry = document.createElement('span');
    retry.textContent = `Prochaine tentative : ${formatDate(item.retryAt)}`;
    diagnostics.append(retry);
  }
  const actions = document.createElement('div');
  actions.className = 'month-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.textContent = recoveryInFlight.has(item.month) ? 'Récupération…' : 'Relancer le traitement';
  button.disabled = !globallyEnabled || item.held || recoveryInFlight.has(item.month) ||
    !['VOTING_CLOSED', 'RESULT_REQUIRES_VERIFICATION'].includes(item.state);
  button.setAttribute('aria-label', `Relancer le traitement automatique pour ${formatMonth(item.month)}`);
  button.addEventListener('click', () => recover(item.month));
  actions.append(button);
  row.append(month, statusArea, diagnostics, actions);
  if (recoveryInFlight.has(item.month)) row.classList.add('recovering');
  return row;
}

function render(data) {
  message.hidden = true;
  loading.hidden = true;
  dashboard.hidden = false;

  const enabled = document.getElementById('enabled-state');
  const automation = document.getElementById('automation-state');
  const storage = document.getElementById('storage-state');
  const summary = document.getElementById('system-summary');
  setPill(enabled, data.enabled ? 'Activée' : 'Désactivée', data.enabled ? '' : 'warning');
  setPill(automation, data.automationEnabled ? 'Active' : 'Inactive', data.automationEnabled ? '' : 'warning');
  const storageLabels = { AVAILABLE: 'Disponible', DISABLED: 'Désactivé', UNAVAILABLE: 'Indisponible' };
  setPill(storage, storageLabels[data.storageStatus], data.storageStatus === 'AVAILABLE' ? '' : data.storageStatus === 'DISABLED' ? 'warning' : 'error');

  summary.className = 'system-summary';
  if (!data.enabled) {
    summary.textContent = 'Le service des résultats est désactivé. Les récupérations manuelles ne sont pas disponibles.';
    summary.classList.add('warning');
  } else if (data.storageStatus === 'UNAVAILABLE') {
    summary.textContent = 'Le stockage ne répond pas. Le traitement ne peut pas progresser pour le moment.';
    summary.classList.add('error');
  } else if (data.storageStatus === 'DISABLED') {
    summary.textContent = 'Le stockage est désactivé. Le service ne peut pas publier de résultats.';
    summary.classList.add('warning');
  } else if (!data.automationEnabled) {
    summary.textContent = 'Le traitement automatique est à l’arrêt. Une relance sécurisée reste possible pour les périodes éligibles.';
    summary.classList.add('warning');
  } else {
    summary.textContent = 'Le traitement automatique est prêt. Les périodes clôturées sont vérifiées et publiées par le pipeline sécurisé.';
  }

  const heartbeat = document.getElementById('heartbeat-details');
  heartbeat.replaceChildren();
  if (data.heartbeat) {
    appendCell(heartbeat, 'Dernière tentative', formatDate(data.heartbeat.lastAttemptAt));
    appendCell(heartbeat, 'Dernier succès', formatDate(data.heartbeat.lastSuccessAt));
    appendCell(heartbeat, 'État du signal', safeReason(data.heartbeat.status));
    const stale = Date.now() - Date.parse(data.heartbeat.lastAttemptAt) > 15 * 60 * 1000;
    if (data.automationEnabled && stale) {
      summary.textContent = 'Le signal du traitement automatique est ancien. Vérifiez le planificateur avant de relancer une période.';
      summary.classList.add('warning');
    }
  } else {
    appendCell(heartbeat, 'Signal de surveillance', 'Aucune activité enregistrée');
    if (data.automationEnabled) {
      summary.textContent = 'L’automatisation est activée mais aucun passage n’a été enregistré. Vérifiez le planificateur.';
      summary.classList.add('warning');
    }
  }

  monthsList.replaceChildren();
  const sorted = [...data.months].sort((a, b) => b.month.localeCompare(a.month));
  document.getElementById('month-count').textContent = `${sorted.length} ${sorted.length === 1 ? 'période' : 'périodes'}`;
  monthsEmpty.hidden = sorted.length !== 0;
  for (const item of sorted) monthsList.append(renderMonth(item, data.enabled));
}

async function loadResults() {
  loading.hidden = false;
  message.hidden = true;
  dashboard.hidden = true;
  retryButton.disabled = true;
  try {
    const response = await fetch(LIST_ENDPOINT, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) {
      window.location.assign(LOGIN_PATH);
      return;
    }
    if (response.status === 503) {
      showError('Service momentanément indisponible.', 'Le tableau des résultats ne peut pas être chargé. Réessayez dans un instant.');
      return;
    }
    if (!response.ok) {
      showError('Impossible de charger le suivi.', 'Une erreur empêche la lecture de l’état des résultats. Réessayez.');
      return;
    }
    const data = validatePayload(await response.json());
    if (!data) {
      showError('Réponse de suivi invalide.', 'Les informations reçues ne peuvent pas être affichées de façon fiable. Réessayez plus tard.');
      return;
    }
    render(data);
  } catch (_) {
    showError('Connexion indisponible.', 'Le suivi n’a pas pu être chargé. Vérifiez votre connexion puis réessayez.');
  } finally {
    retryButton.disabled = false;
  }
}

async function recover(month) {
  if (recoveryInFlight.has(month)) return;
  recoveryInFlight.add(month);
  refreshStatus.textContent = `Relance du traitement de ${formatMonth(month)}…`;
  await loadResults();
  const button = [...monthsList.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === `Relancer le traitement automatique pour ${formatMonth(month)}`);
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${LIST_ENDPOINT}/${encodeURIComponent(month)}/recover`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      window.location.assign(LOGIN_PATH);
      return;
    }
    if (response.status === 409) {
      refreshStatus.textContent = 'La récupération est bloquée pour protéger l’intégrité du résultat. Consultez le diagnostic de cette période.';
      return;
    }
    if (response.status === 503) {
      refreshStatus.textContent = 'Le traitement ne peut pas redémarrer pour le moment. Le système pourra réessayer lorsque le service sera disponible.';
      return;
    }
    if (!response.ok) {
      refreshStatus.textContent = 'La relance n’a pas abouti. Réessayez après avoir vérifié l’état du service.';
      return;
    }
    const result = await response.json();
    if (!isObject(result) || result.month !== month || !Object.keys(stateLabels).includes(result.state) ||
        !(result.reason === null || typeof result.reason === 'string') || typeof result.held !== 'boolean') {
      refreshStatus.textContent = 'Le traitement a répondu avec des informations non reconnues. Actualisez le tableau.';
      return;
    }
    refreshStatus.textContent = result.held
      ? `Le traitement de ${formatMonth(month)} est suspendu pour vérification.`
      : `Le pipeline de ${formatMonth(month)} a été relancé : ${stateLabels[result.state]}.`;
  } catch (_) {
    refreshStatus.textContent = 'La relance a échoué en raison d’un problème de connexion.';
  } finally {
    recoveryInFlight.delete(month);
    await loadResults();
  }
}

refreshButton.addEventListener('click', async () => {
  refreshStatus.textContent = 'Actualisation en cours…';
  await loadResults();
  if (!message.hidden) refreshStatus.textContent = '';
  else refreshStatus.textContent = 'État actualisé.';
});
retryButton.addEventListener('click', loadResults);
loadResults();