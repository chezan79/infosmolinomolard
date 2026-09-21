import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

const copy = {
  fr:{area:'Espace de gestion',private:'Accès privé',title:'Connexion management',email:'E-mail',password:'Mot de passe',connect:'Se connecter',error:'Connexion refusée ou accès insuffisant.'},
  it:{area:'Area gestione',private:'Accesso privato',title:'Accesso management',email:'E-mail',password:'Password',connect:'Accedi',error:'Accesso negato o autorizzazioni insufficienti.'},
  en:{area:'Management area',private:'Private access',title:'Management sign in',email:'Email',password:'Password',connect:'Sign in',error:'Sign-in failed or access is insufficient.'},
};
const locale=document.getElementById('locale'), node=document.getElementById('app');
let language='fr', auth;
const t=(key)=>copy[language][key];
function render(){document.documentElement.lang=language;document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));node.innerHTML=`<section class="card login"><form id="login"><div class="field"><label for="email">${t('email')}</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">${t('password')}</label><input id="password" type="password" autocomplete="current-password" required></div><button class="button">${t('connect')}</button><p class="status" id="status"></p></form></section>`;document.getElementById('login').addEventListener('submit',login)}
async function login(event){event.preventDefault();const status=document.getElementById('status');try{const credential=await signInWithEmailAndPassword(auth,event.target.email.value,event.target.password.value);const token=await credential.user.getIdToken();const response=await fetch('/api/v1/management/session',{method:'POST',headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error();location.replace('/gestion-photos-collaborateurs')}catch{await signOut(auth).catch(()=>{});status.textContent=t('error')}}
locale.addEventListener('change',event=>{language=event.target.value;render()});
const config=await fetch('/api/v1/public/firebase-client-config').then(response=>{if(!response.ok)throw new Error();return response.json()});
auth=getAuth(initializeApp(config));render();