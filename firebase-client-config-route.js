const REQUIRED_CLIENT_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const CLIENT_KEYS = [
  ...REQUIRED_CLIENT_KEYS,
  'messagingSenderId',
  'storageBucket',
];

function firebaseClientConfig(env) {
  return Object.fromEntries(CLIENT_KEYS.map((key) => [key, env[key]]));
}

function mountFirebaseClientConfig(app, env) {
  app.get('/api/v1/public/firebase-client-config', (_req, res) => {
    const config = firebaseClientConfig(env);
    if (REQUIRED_CLIENT_KEYS.some((key) => !config[key])) {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(config);
  });
}

module.exports = { CLIENT_KEYS, firebaseClientConfig, mountFirebaseClientConfig };