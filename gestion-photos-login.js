import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

const copy = {
  fr:{area:'Administration',private:'Accès privé',title:'Connexion Administration',email:'E-mail',password:'Mot de passe',connect:'Se connecter',error:'Identifiants invalides ou accès insuffisant.',session:'Votre session a expiré ou a été révoquée. Reconnectez-vous.'},
  it:{area:'Amministrazione',private:'Accesso privato',title:'Accesso Amministrazione',email:'E-mail',password:'Password',connect:'Accedi',error:'Credenziali non valide o accesso insufficiente.',session:'La sessione è scaduta o è stata revocata. Accedi di nuovo.'},
  en:{area:'Administration',private:'Private access',title:'Administration sign in',email:'Email',password:'Password',connect:'Sign in',error:'Invalid credentials or insufficient access.',session:'Your session expired or was revoked. Please sign in again.'},
};
const locale=document.getElementById('locale'), node=document.getElementById('app');
let language='fr', auth;
const t=(key)=>copy[language][key];
function render(){document.documentElement.lang=language;document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));const sessionError=new URLSearchParams(location.search).get('error')==='session';node.innerHTML=`<section class="card login"><form id="login"><div class="field"><label for="email">${t('email')}</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">${t('password')}</label><input id="password" type="password" autocomplete="current-password" required></div><button class="button">${t('connect')}</button><p class="status" id="status">${sessionError?t('session'):''}</p></form></section>`;document.getElementById('login').addEventListener('submit',login)}
async function login(event){event.preventDefault();const status=document.getElementById('status');try{const credential=await signInWithEmailAndPassword(auth,event.target.email.value,event.target.password.value);const token=await credential.user.getIdToken(true);const response=await fetch('/api/v1/management/session',{method:'POST',headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error();location.replace('/administration')}catch{await signOut(auth).catch(()=>{});status.textContent=t('error')}}
locale.addEventListener('change',event=>{language=event.target.value;render()});
const config=await fetch('/api/v1/public/firebase-client-config').then(response=>{if(!response.ok)throw new Error();return response.json()});
auth=getAuth(initializeApp(config));render();