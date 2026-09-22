import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

const copy = {
  fr:{area:'Administration',private:'Accès privé',title:'Connexion Administration',email:'E-mail',password:'Mot de passe',connect:'Se connecter',error:'Identifiants invalides ou accès insuffisant.',session:'Votre session a expiré ou a été révoquée. Reconnectez-vous.',config:'La connexion Administration est temporairement indisponible. Réessayez plus tard.'},
  it:{area:'Amministrazione',private:'Accesso privato',title:'Accesso Amministrazione',email:'E-mail',password:'Password',connect:'Accedi',error:'Credenziali non valide o accesso insufficiente.',session:'La sessione è scaduta o è stata revocata. Accedi di nuovo.',config:'L’accesso Amministrazione è temporaneamente non disponibile. Riprova più tardi.'},
  en:{area:'Administration',private:'Private access',title:'Administration sign in',email:'Email',password:'Password',connect:'Sign in',error:'Invalid credentials or insufficient access.',session:'Your session expired or was revoked. Please sign in again.',config:'Administration sign-in is temporarily unavailable. Please try again later.'},
};

const locale = document.getElementById('locale');
const node = document.getElementById('app');
const state = {
  language: 'fr',
  auth: null,
  configurationUnavailable: false,
};
const t = (key) => copy[state.language][key];

function render() {
  document.documentElement.lang = state.language;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  const sessionExpired = new URLSearchParams(location.search).get('error') === 'session';
  const status = state.configurationUnavailable ? t('config') : sessionExpired ? t('session') : '';
  node.innerHTML = `<section class="card login"><form id="login"><div class="field"><label for="email">${t('email')}</label><input id="email" type="email" autocomplete="username" required ${state.configurationUnavailable?'disabled':''}></div><div class="field"><label for="password">${t('password')}</label><input id="password" type="password" autocomplete="current-password" required ${state.configurationUnavailable?'disabled':''}></div><button class="button" ${state.configurationUnavailable?'disabled':''}>${t('connect')}</button><p class="status" id="status">${status}</p></form></section>`;
  document.getElementById('login').addEventListener('submit', login);
}

async function login(event) {
  event.preventDefault();
  const status = document.getElementById('status');
  if (!state.auth) {
    state.configurationUnavailable = true;
    render();
    return;
  }
  try {
    const credential = await signInWithEmailAndPassword(
      state.auth,
      event.target.email.value,
      event.target.password.value,
    );
    const token = await credential.user.getIdToken(true);
    const response = await fetch('/api/v1/management/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('MANAGEMENT_SESSION_REJECTED');
    location.replace('/administration');
  } catch {
    if (state.auth) await signOut(state.auth).catch(() => {});
    status.textContent = t('error');
  }
}

locale.addEventListener('change', (event) => {
  state.language = event.target.value;
  render();
});

async function initialize() {
  try {
    const response = await fetch('/api/v1/public/firebase-client-config', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');
    const config = await response.json();
    for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
      if (typeof config[key] !== 'string' || !config[key]) {
        throw new Error('AUTH_CONFIGURATION_INVALID');
      }
    }
    state.auth = getAuth(initializeApp(config));
    await setPersistence(state.auth, inMemoryPersistence);
  } catch {
    state.auth = null;
    state.configurationUnavailable = true;
  }
  render();
}

initialize().catch(() => {
  state.auth = null;
  state.configurationUnavailable = true;
  render();
});