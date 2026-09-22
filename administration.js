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