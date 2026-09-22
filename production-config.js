const DEVELOPMENT_ONLY_VARIABLES = [
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
];

const REQUIRED_PRODUCTION_VARIABLES = [
  'APP_CANONICAL_ORIGIN',
  'ELECTION_DATA_ENVIRONMENT',
  'ELECTION_GRANT_SECRET',
  'ELECTION_TIME_ZONE',
  'ELECTION_TRUST_PROXY_HOPS',
  'EMPLOYEE_DIRECTORY_PEPPER',
  'EMPLOYEE_DIRECTORY_SHEET_ID',
  'EMPLOYEE_DIRECTORY_SHEET_RANGE',
  'EMPLOYEE_DIRECTORY_SITE_ID',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_STORAGE_BUCKET',
  'MOLARD_ADMIN_FIREBASE_UID',
  'SESSION_SECRET',
  'apiKey',
  'appId',
  'authDomain',
  'projectId',
  'storageBucket',
];

const APPROVED_RAILWAY_CANONICAL_ORIGIN =
  'https://infosmolinomolard-production.up.railway.app';

function parsePort(value, fallback = 5000) {
  const port = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseCanonicalOrigin(value) {
  let origin;
  try {
    const exactValue = String(value || '');
    const parsed = new URL(exactValue);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error();
    }
    const railwayHostname = parsed.hostname.endsWith('.railway.app') ||
      parsed.hostname.endsWith('.railway.app.');
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
        (railwayHostname && exactValue !== APPROVED_RAILWAY_CANONICAL_ORIGIN)) {
      throw new Error();
    }
    origin = parsed.origin;
  } catch {
    throw new Error('APP_CANONICAL_ORIGIN must be an exact HTTPS custom origin');
  }
  return origin;
}

function validateProductionConfig(env) {
  if (env.NODE_ENV !== 'production') {
    return {
      production: false,
      port: parsePort(env.PORT),
      host: '0.0.0.0',
      canonicalOrigin: null,
      trustProxyHops: Number.parseInt(env.ELECTION_TRUST_PROXY_HOPS, 10) || 1,
    };
  }

  const missing = REQUIRED_PRODUCTION_VARIABLES.filter((name) => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required production variables: ${missing.join(', ')}`);
  }
  const forbidden = DEVELOPMENT_ONLY_VARIABLES.filter((name) => String(env[name] || '').trim());
  if (forbidden.length) {
    throw new Error(`Development-only variables are forbidden in production: ${forbidden.join(', ')}`);
  }
  if (env.ELECTION_DATA_ENVIRONMENT !== 'production') {
    throw new Error('ELECTION_DATA_ENVIRONMENT must equal production');
  }
  if (env.ELECTION_TIME_ZONE !== 'Europe/Zurich') {
    throw new Error('ELECTION_TIME_ZONE must equal Europe/Zurich');
  }
  if (env.EMPLOYEE_DIRECTORY_SITE_ID !== 'molard') {
    throw new Error('EMPLOYEE_DIRECTORY_SITE_ID must equal molard');
  }
  if (env.storageBucket !== env.FIREBASE_STORAGE_BUCKET) {
    throw new Error('storageBucket and FIREBASE_STORAGE_BUCKET must identify the same bucket');
  }
  for (const name of ['ELECTION_GRANT_SECRET', 'EMPLOYEE_DIRECTORY_PEPPER', 'SESSION_SECRET']) {
    if (String(env[name]).length < 32) throw new Error(`${name} must be at least 32 characters`);
  }
  const trustProxyHops = Number(env.ELECTION_TRUST_PROXY_HOPS);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops !== 1) {
    throw new Error('ELECTION_TRUST_PROXY_HOPS must equal 1 for the approved Railway topology');
  }
  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) throw new Error();
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid service-account JSON');
  }
  return {
    production: true,
    port: parsePort(env.PORT),
    host: '0.0.0.0',
    canonicalOrigin: parseCanonicalOrigin(env.APP_CANONICAL_ORIGIN),
    trustProxyHops,
  };
}

module.exports = {
  APPROVED_RAILWAY_CANONICAL_ORIGIN,
  DEVELOPMENT_ONLY_VARIABLES,
  REQUIRED_PRODUCTION_VARIABLES,
  parseCanonicalOrigin,
  parsePort,
  validateProductionConfig,
};