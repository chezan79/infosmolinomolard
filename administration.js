import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

const config = await fetch('/api/v1/public/firebase-client-config').then((response) => {
  if (!response.ok) throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');
  return response.json();
});
const auth = getAuth(initializeApp(config));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/v1/management/session', { method: 'DELETE' });
  await signOut(auth).catch(() => {});
  location.replace('/gestion-photos-login.html');
});