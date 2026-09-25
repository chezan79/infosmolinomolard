(() => {
  'use strict';
  const API = '/api/v1/public/election';
  const COMMENT_MIN = 10, COMMENT_MAX = 1000;
  const copy = {
    fr: {
      brandSub:'Espace équipe', languageLabel:'Langue', eyebrow:'Un vote, deux voix', title:'Collaborateur du mois',
      lede:'Choisissez une personne en cuisine et une personne au service. Votre regard compte, et vos réponses restent confidentielles.',
      stepIdentity:'1 · Identification', stepChoices:'2 · Vos choix', stepReview:'3 · Vérification',
      privacy:'Aucun résultat ni choix individuel ne sera affiché. Merci de voter avec attention.',
      loading:'Préparation du vote…', unavailable:'Le vote est momentanément indisponible.', retry:'Réessayer',
      upcoming:'Le prochain vote n’est pas encore ouvert.', opens:'Ouverture prévue le', closed:'Le vote est terminé pour cette période.',
      identityTitle:'Avant de commencer', identityHint:'Saisissez votre Salaire-ID. Il reste uniquement dans la mémoire de cette page.',
      entryPolicy:'Le vote est ouvert du 25 à la fin du mois. Vous devrez choisir une personne par catégorie, expliquer chaque choix, puis confirmer un envoi définitif.',
      salary:'Salaire-ID', salaryPlaceholder:'Votre identifiant professionnel', continue:'Continuer', invalidId:'Salaire-ID invalide. Vérifiez votre saisie.',
      expired:'Votre autorisation a expiré. Veuillez recommencer.', throttled:'Trop de tentatives. Patientez un moment avant de réessayer.',
      unavailableAuth:'Ce vote n’est pas accessible avec cette autorisation.', already:'Votre vote a déjà été enregistré. Merci pour votre participation.',
      categoryCuisine:'Cuisine', categoryService:'Service', choose:'Choisissez une personne', search:'Rechercher par nom ou métier…',
      noMatch:'Aucun collègue ne correspond à cette recherche.', commentLabel:'Pourquoi cette personne ?', commentHint:'10 à 1000 caractères. Un mot précis vaut mieux qu’un long discours.',
      commentError:'Le commentaire doit contenir entre 10 et 1000 caractères.', choiceError:'Choisissez une personne dans chaque catégorie.', noCandidates:'Aucun collègue éligible n’est disponible dans cette catégorie.', selected:'Sélectionné', next:'Continuer', back:'Retour',
      reviewTitle:'Relisez votre vote', reviewHint:'Vérifiez vos deux choix et vos commentaires avant l’envoi.', edit:'Modifier', submit:'Envoyer mon vote',
      finality:'Après l’envoi, votre vote sera définitif et ne pourra plus être modifié.', restart:'Recommencer en sécurité', leave:'Quitter le vote',
      sending:'Envoi en cours…', submitted:'Votre vote a bien été enregistré.', thanks:'Merci pour votre confiance. Votre voix compte dans l’équipe.',
      network:'La connexion n’a pas abouti. Votre vote n’a pas été envoyé.', server:'Le service est indisponible. Réessayez dans quelques instants.',
      invalidBallot:'Le vote a changé pendant votre session. Rechargez la liste et vérifiez vos choix.', changed:'Les conditions du vote ont changé. Veuillez recommencer.',
      authorizationExpired:'Votre session de vote a expiré. Recommencez pour protéger votre vote.', closedError:'Le vote est maintenant fermé.',
      status:'État du vote', unavailableState:'Le vote ne peut pas être ouvert pour le moment.'
    },
    it: {
      brandSub:'Spazio squadra', languageLabel:'Lingua', eyebrow:'Un voto, due voci', title:'Collaboratore del mese',
      lede:'Scegli una persona in cucina e una nel servizio. Il tuo punto di vista conta e le risposte restano riservate.',
      stepIdentity:'1 · Identificazione', stepChoices:'2 · Le tue scelte', stepReview:'3 · Verifica',
      privacy:'Nessun risultato o scelta individuale sarà mostrato. Grazie per votare con attenzione.',
      loading:'Preparazione del voto…', unavailable:'Il voto non è momentaneamente disponibile.', retry:'Riprova',
      upcoming:'Il prossimo voto non è ancora aperto.', opens:'Apertura prevista il', closed:'Il voto è terminato per questo periodo.',
      identityTitle:'Prima di iniziare', identityHint:'Inserisci il tuo Salaire-ID. Rimane solo nella memoria di questa pagina.',
      entryPolicy:'Il voto è aperto dal 25 alla fine del mese. Dovrai scegliere una persona per categoria, spiegare ogni scelta e confermare un invio definitivo.',
      salary:'Salaire-ID', salaryPlaceholder:'Il tuo identificativo professionale', continue:'Continua', invalidId:'Salaire-ID non valido. Controlla i dati.',
      expired:'La tua autorizzazione è scaduta. Ricomincia.', throttled:'Troppi tentativi. Attendi prima di riprovare.',
      unavailableAuth:'Questo voto non è accessibile con questa autorizzazione.', already:'Il tuo voto è già stato registrato. Grazie per la partecipazione.',
      categoryCuisine:'Cucina', categoryService:'Servizio', choose:'Scegli una persona', search:'Cerca per nome o mestiere…',
      noMatch:'Nessun collega corrisponde alla ricerca.', commentLabel:'Perché questa persona?', commentHint:'Da 10 a 1000 caratteri.',
      commentError:'Il commento deve contenere da 10 a 1000 caratteri.', choiceError:'Scegli una persona in ogni categoria.', noCandidates:'Nessun collega idoneo è disponibile in questa categoria.', selected:'Selezionato', next:'Continua', back:'Indietro',
      reviewTitle:'Rileggi il tuo voto', reviewHint:'Controlla scelte e commenti prima dell’invio.', edit:'Modifica', submit:'Invia il mio voto',
      finality:'Dopo l’invio, il voto sarà definitivo e non potrà essere modificato.', restart:'Ricomincia in sicurezza', leave:'Esci dal voto',
      sending:'Invio in corso…', submitted:'Il tuo voto è stato registrato.', thanks:'Grazie per la fiducia. La tua voce conta.',
      network:'La connessione non è riuscita. Il voto non è stato inviato.', server:'Servizio non disponibile. Riprova tra poco.',
      invalidBallot:'Il voto è cambiato durante la sessione. Controlla le tue scelte.', changed:'Le condizioni sono cambiate. Ricomincia.',
      authorizationExpired:'La sessione è scaduta. Ricomincia per proteggere il voto.', closedError:'Il voto è ora chiuso.', status:'Stato del voto', unavailableState:'Il voto non può essere aperto ora.'
    },
    en: {
      brandSub:'Team space', languageLabel:'Language', eyebrow:'One vote, two voices', title:'Colleague of the month',
      lede:'Choose one colleague in kitchen and one in service. Your perspective matters, and your answers stay confidential.',
      stepIdentity:'1 · Identification', stepChoices:'2 · Your choices', stepReview:'3 · Check',
      privacy:'No results or individual choices will be shown. Thank you for voting thoughtfully.',
      loading:'Preparing the vote…', unavailable:'Voting is temporarily unavailable.', retry:'Try again',
      upcoming:'The next vote is not open yet.', opens:'Opens on', closed:'Voting is closed for this period.',
      identityTitle:'Before you begin', identityHint:'Enter your Salaire-ID. It stays only in this page’s memory.',
      entryPolicy:'Voting is open from the 25th through the end of the month. Choose one person per category, explain each choice, then confirm one final submission.',
      salary:'Salaire-ID', salaryPlaceholder:'Your work identifier', continue:'Continue', invalidId:'Invalid Salaire-ID. Check your entry.',
      expired:'Your authorization expired. Please start again.', throttled:'Too many attempts. Wait a little before trying again.',
      unavailableAuth:'This vote is not available with this authorization.', already:'Your vote has already been recorded. Thank you.',
      categoryCuisine:'Kitchen', categoryService:'Service', choose:'Choose one colleague', search:'Search by name or role…',
      noMatch:'No colleague matches this search.', commentLabel:'Why this person?', commentHint:'10 to 1000 characters. Be specific.',
      commentError:'Your comment must be between 10 and 1000 characters.', choiceError:'Choose one colleague in each category.', noCandidates:'No eligible colleague is available in this category.', selected:'Selected', next:'Continue', back:'Back',
      reviewTitle:'Review your vote', reviewHint:'Check both choices and comments before sending.', edit:'Edit', submit:'Submit my vote',
      finality:'After submission, your vote is final and cannot be changed.', restart:'Start again securely', leave:'Leave voting',
      sending:'Sending…', submitted:'Your vote has been recorded.', thanks:'Thank you for your trust. Your voice matters.',
      network:'The connection failed. Your vote was not sent.', server:'The service is unavailable. Try again shortly.',
      invalidBallot:'Voting eligibility changed during your session. Check your choices again.', changed:'Voting conditions changed. Please start again.',
      authorizationExpired:'Your voting session expired. Start again to protect your vote.', closedError:'Voting is now closed.', status:'Voting status', unavailableState:'Voting cannot be opened right now.'
    }
  };
  const browserLocale = String(navigator.language || '').slice(0, 2).toLowerCase();
  const state = { locale: copy[browserLocale] ? browserLocale : 'fr', election: null, token: null, candidates: { CUISINE: [], SERVICE: [] }, choices: {}, comments: { CUISINE:'', SERVICE:'' }, searches: { CUISINE:'', SERVICE:'' }, step: 1, busy: false, screen: 'flow' };
  const app = document.getElementById('app'), locale = document.getElementById('locale');
  const t = key => (copy[state.locale] && copy[state.locale][key]) || copy.fr[key] || key;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase();
  const dateText = value => value ? new Intl.DateTimeFormat(state.locale, { dateStyle:'long', timeStyle:'short' }).format(new Date(value)) : '';
  function setLocale(value) { state.locale = copy[value] ? value : 'fr'; document.documentElement.lang = state.locale; locale.value = state.locale; locale.setAttribute('aria-label', t('languageLabel')); document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); }); render(); }
  locale.addEventListener('change', e => setLocale(e.target.value));
  function progress(step) { state.step = step; document.querySelectorAll('.progress-step').forEach(el => { const n = Number(el.dataset.step); el.classList.toggle('active', n === step); el.classList.toggle('done', n < step); }); }
  async function request(path, options = {}) {
    const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) };
    const res = await fetch(`${API}${path}`, { ...options, headers, credentials:'same-origin' });
    let body = {}; try { body = await res.json(); } catch (_) {}
    if (!res.ok) { const error = new Error(body.code || 'SERVICE_UNAVAILABLE'); error.status = res.status; throw error; }
    return body;
  }
  function errorMessage(error) {
    const map = { INVALID_CREDENTIALS:'invalidId', RATE_LIMITED:'throttled', ALREADY_VOTED:'already', INVALID_AUTHORIZATION:'expired', ELECTION_NOT_OPEN:'closedError', RESULTS_SEALED:'closed', INVALID_BALLOT:'invalidBallot', SERVICE_UNAVAILABLE:'server' };
    return t(map[error.message] || (error instanceof TypeError ? 'network' : 'server'));
  }
  function render() {
    progress(state.step);
    if (state.screen === 'unavailable') return renderUnavailable();
    if (state.step === 4) return renderSuccess();
    if (state.election && state.election.state !== 'OPEN') return renderState(state.election);
    if (state.step === 1) return renderIdentity();
    if (state.step === 2) return renderChoices();
    if (state.step === 3) return renderReview();
  }
  function renderIdentity(message = '') {
    app.innerHTML = `<section class="card view" aria-labelledby="identity-title"><h2 id="identity-title">${t('identityTitle')}</h2><p class="hint">${t('identityHint')}</p><p class="notice">${t('entryPolicy')}</p><form id="identity-form" novalidate><div class="field"><label for="salary">${t('salary')}</label><input id="salary" name="salary" autocomplete="off" required minlength="4" maxlength="64" placeholder="${t('salaryPlaceholder')}"></div><div class="status" id="identity-status" role="alert">${esc(message)}</div><div class="actions"><button class="button primary" type="submit">${t('continue')}</button></div></form></section>`;
    document.getElementById('identity-form').addEventListener('submit', verify);
    document.getElementById('salary').focus();
  }
  async function verify(event) {
    event.preventDefault(); if (state.busy) return;
    const input = document.getElementById('salary'), value = input.value.trim(), status = document.getElementById('identity-status');
    if (value.length < 4) { status.textContent = t('invalidId'); input.focus(); return; }
    state.busy = true; status.textContent = t('loading');
    try {
      const election = state.election || await request('');
      state.election = election;
      if (election.state !== 'OPEN') { state.busy = false; renderState(election); return; }
      const verification = await request('/verify-code', { method:'POST', body: JSON.stringify({ salaireId:value }) });
      state.token = verification.authorization;
      if (!state.token || (verification.expiresAt && Date.parse(verification.expiresAt) <= Date.now())) throw new Error('INVALID_AUTHORIZATION');
      const participation = await request('/participation');
      if (participation.submitted) throw new Error('ALREADY_VOTED');
      const data = await request('/candidates');
      state.candidates = data.candidates || { CUISINE:[], SERVICE:[] };
      state.busy = false; state.screen = 'flow'; state.step = 2; render(); focusHeading();
    } catch (error) { state.busy = false; status.textContent = errorMessage(error); input.focus(); }
  }
  function renderState(election) {
    const isUpcoming = election.state === 'UPCOMING';
    app.innerHTML = `<section class="card view center" aria-labelledby="state-title"><div class="eyebrow">${t('status')}</div><h2 id="state-title">${isUpcoming ? t('upcoming') : t('closed')}</h2><p class="hint">${isUpcoming && election.opensAt ? `${t('opens')} ${esc(dateText(election.opensAt))}.` : t('privacy')}</p></section>`;
    state.busy = false; focusHeading();
  }
  function candidateCard(candidate, category) {
    const selected = state.choices[category] === candidate.employeeId;
    const fallback = initials(candidate.displayName);
    const photo = candidate.photoUrl ? `<img class="avatar" src="${esc(candidate.photoUrl)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : '';
    return `<button type="button" class="candidate ${selected ? 'selected':''}" data-candidate="${esc(candidate.employeeId)}" data-category="${category}" aria-pressed="${selected}"><span class="check" aria-hidden="true">${selected ? '✓' : ''}</span><span class="avatar-slot">${photo}<span class="avatar avatar-fallback" aria-hidden="true" ${photo ? 'hidden' : ''}>${esc(fallback)}</span></span><span class="candidate-info"><strong>${esc(candidate.displayName)}</strong><span>${esc(candidate.jobTitle || candidate.department || '')}</span></span></button>`;
  }
  function renderChoices() {
    app.innerHTML = `<section class="card view" aria-labelledby="choices-title"><h2 id="choices-title">${t('choose')}</h2><p class="hint">${t('commentHint')}</p><div id="category-panels"></div><div class="status" id="choice-status" role="alert"></div><div class="actions"><button class="button secondary" id="back-identity" type="button">${t('back')}</button><button class="button primary" id="to-review" type="button">${t('next')}</button></div></section>`;
    ['CUISINE','SERVICE'].forEach(category => renderCategory(category));
    document.getElementById('back-identity').addEventListener('click', () => { state.token = null; state.step = 1; render(); });
    document.getElementById('to-review').addEventListener('click', () => { if (validChoices()) { state.step = 3; render(); focusHeading(); } });
  }
  function renderCategory(category) {
    const panel = document.createElement('fieldset'); panel.className = 'field'; panel.innerHTML = `<legend><h3>${t(category === 'CUISINE' ? 'categoryCuisine' : 'categoryService')}</h3></legend><label class="hidden" for="search-${category}">${t('search')}</label><input class="search" id="search-${category}" placeholder="${t('search')}" type="search" value="${esc(state.searches[category])}"><div class="candidate-grid" id="grid-${category}"></div><label for="comment-${category}">${t('commentLabel')}</label><textarea id="comment-${category}" maxlength="${COMMENT_MAX}" minlength="${COMMENT_MIN}" placeholder="${t('commentHint')}">${esc(state.comments[category])}</textarea><div class="counter" id="counter-${category}">0 / ${COMMENT_MAX}</div>`;
    document.getElementById('category-panels').appendChild(panel);
    const update = () => { state.comments[category] = document.getElementById(`comment-${category}`).value; document.getElementById(`counter-${category}`).textContent = `${state.comments[category].length} / ${COMMENT_MAX}`; };
    document.getElementById(`comment-${category}`).addEventListener('input', update);
    document.getElementById(`search-${category}`).addEventListener('input', e => { state.searches[category] = e.target.value; drawCandidates(category, e.target.value); });
    drawCandidates(category, state.searches[category]);
  }
  function drawCandidates(category, query) {
    const needle = normalize(query), list = (state.candidates[category] || []).filter(c => normalize(`${c.displayName} ${c.jobTitle || c.department || ''}`).includes(needle)).sort((a, b) => a.displayName.localeCompare(b.displayName, state.locale, { sensitivity:'accent' }));
    const all = state.candidates[category] || [];
    const grid = document.getElementById(`grid-${category}`); grid.innerHTML = list.length ? list.map(c => candidateCard(c, category)).join('') : `<p class="hint">${t(all.length ? 'noMatch' : 'noCandidates')}</p>`;
    grid.querySelectorAll('.candidate').forEach(button => button.addEventListener('click', () => { state.choices[category] = button.dataset.candidate; drawCandidates(category, document.getElementById(`search-${category}`).value); Array.from(grid.querySelectorAll('.candidate')).find(candidate => candidate.dataset.candidate === state.choices[category])?.focus(); }));
  }
  function validChoices() {
    const status = document.getElementById('choice-status');
    for (const category of ['CUISINE','SERVICE']) {
      if (!state.choices[category]) { status.textContent = t('choiceError'); document.getElementById(`search-${category}`).focus(); return false; }
      if (state.comments[category].trim().length < COMMENT_MIN || state.comments[category].trim().length > COMMENT_MAX) { status.textContent = t('commentError'); document.getElementById(`comment-${category}`).focus(); return false; }
    }
    return true;
  }
  function selectedName(category) { return (state.candidates[category] || []).find(c => c.employeeId === state.choices[category])?.displayName || ''; }
  function selectedCandidate(category) { return (state.candidates[category] || []).find(c => c.employeeId === state.choices[category]); }
  function reviewCandidate(category) {
    const candidate = selectedCandidate(category);
    if (!candidate) return '';
    const photo = candidate.photoUrl ? `<img class="avatar" src="${esc(candidate.photoUrl)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : '';
    return `<div class="review-person">${photo}<span class="avatar avatar-fallback" aria-hidden="true" ${photo ? 'hidden' : ''}>${esc(initials(candidate.displayName))}</span><span class="candidate-info"><strong>${esc(candidate.displayName)}</strong><span>${esc(candidate.jobTitle || candidate.department || '')}</span></span></div>`;
  }
  function renderReview() {
    app.innerHTML = `<section class="card view" aria-labelledby="review-title"><h2 id="review-title">${t('reviewTitle')}</h2><p class="hint">${t('reviewHint')}</p>${['CUISINE','SERVICE'].map(category => `<div class="review-block"><div class="review-label">${t(category === 'CUISINE' ? 'categoryCuisine' : 'categoryService')}</div>${reviewCandidate(category)}<div class="choice-summary"><p>${esc(state.comments[category].trim())}</p></div><button class="button secondary edit-button" type="button" data-edit="${category}">${t('edit')}</button></div>`).join('')}<p class="notice finality">${t('finality')}</p><div class="status" id="review-status" role="alert"></div><div class="actions"><button class="button secondary" id="back-choices" type="button">${t('back')}</button><button class="button primary" id="submit" type="button">${t('submit')}</button></div></section>`;
    document.querySelectorAll('.edit-button').forEach(b => b.addEventListener('click', () => { state.step = 2; render(); setTimeout(() => document.getElementById(`comment-${b.dataset.edit}`).focus(), 0); }));
    document.getElementById('back-choices').addEventListener('click', () => { state.step = 2; render(); });
    document.getElementById('submit').addEventListener('click', submit);
  }
  async function submit() {
    if (state.busy) return; const status = document.getElementById('review-status'), button = document.getElementById('submit'); state.busy = true; button.disabled = true; status.textContent = t('sending');
    try { const result = await request('/ballots', { method:'POST', body: JSON.stringify({ choices: state.choices, comments: { CUISINE:state.comments.CUISINE.trim(), SERVICE:state.comments.SERVICE.trim() } }) }); if (result.code !== 'SUBMITTED') throw new Error('INVALID_BALLOT'); state.token = null; state.step = 4; render(); }
    catch (error) {
      state.busy = false; button.disabled = false; status.textContent = errorMessage(error);
      if (['INVALID_AUTHORIZATION', 'ALREADY_VOTED', 'ELECTION_NOT_OPEN'].includes(error.message)) {
        state.token = null;
        button.hidden = true;
        const restart = document.createElement('button');
        restart.type = 'button'; restart.className = 'button primary'; restart.textContent = t('restart');
        restart.addEventListener('click', () => { state.choices = {}; state.comments = { CUISINE:'', SERVICE:'' }; state.step = 1; render(); });
        button.parentElement.appendChild(restart);
      }
    }
  }
  function renderSuccess() { document.querySelectorAll('.progress-step').forEach(el => el.classList.add('done')); app.innerHTML = `<section class="card view center notice success" aria-labelledby="success-title"><h2 id="success-title">${t('submitted')}</h2><p>${t('thanks')}</p><p class="finality">${t('finality')}</p><div class="actions"><a class="button secondary" href="index.html">${t('leave')}</a></div></section>`; focusHeading(); }
  function focusHeading() { const h = app.querySelector('h2'); if (h) { h.setAttribute('tabindex','-1'); h.focus(); } }
  function renderUnavailable() { app.innerHTML = `<section class="card view center notice error"><p>${t('unavailable')}</p><button class="button primary" id="retry">${t('retry')}</button></section>`; document.getElementById('retry').addEventListener('click', init); }
  async function init() { state.screen = 'flow'; setLocale(state.locale); try { state.election = await request(''); render(); } catch (_) { state.screen = 'unavailable'; render(); } }
  init();
})();