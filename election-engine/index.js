const express = require('express');
const { DEFAULT_GRANT_TTL_MS } = require('./contract');
const { ElectionError, FirestoreElectionStore } = require('./firestore-store');
const { ElectionService } = require('./service');

function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function networkKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').toLowerCase().split('%')[0];
  const ipv4 = ip.match(/(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  if (ip.includes(':')) {
    const compressed = ip.split('::');
    if (compressed.length === 1) {
      const groups = compressed[0].split(':');
      if (groups.length === 8 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(':')}::/64`;
      }
    } else if (compressed.length === 2) {
      const [leftText, rightText] = compressed;
      const left = leftText ? leftText.split(':') : [];
      const right = rightText ? rightText.split(':') : [];
      if (left.length + right.length < 8 &&
          [...left, ...right].every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
        return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(':')}::/64`;
      }
    }
  }
  return 'unknown';
}

function createElectionRuntime({ env, firebaseDb, directoryService, electionService = null }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const dataEnvironment = env.ELECTION_DATA_ENVIRONMENT || '';
  const store = firebaseDb && siteId && ['development', 'production'].includes(dataEnvironment)
    ? new FirestoreElectionStore(firebaseDb, siteId, dataEnvironment)
    : null;
  const service = electionService || new ElectionService({
    store, directoryService, siteId,
    timeZone: env.ELECTION_TIME_ZONE || '',
    pepper: env.EMPLOYEE_DIRECTORY_PEPPER || '',
    grantSecret: env.ELECTION_GRANT_SECRET || '',
    grantTtlMs: Number.parseInt(env.ELECTION_GRANT_TTL_MS, 10) || DEFAULT_GRANT_TTL_MS,
  });
  const handler = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return await fn(req, res); } catch (error) {
      const code = error instanceof ElectionError ? error.code : 'SERVICE_UNAVAILABLE';
      const status = code === 'RATE_LIMITED' ? 429 :
        ['INVALID_CREDENTIALS', 'INVALID_AUTHORIZATION'].includes(code) ? 401 :
        ['INVALID_BALLOT'].includes(code) ? 400 :
        ['ALREADY_VOTED', 'ELECTION_NOT_OPEN', 'RESULTS_SEALED'].includes(code) ? 409 : 503;
      return res.status(status).json({ code });
    }
  };
  function mount(app) {
    app.set('trust proxy', Number.parseInt(env.ELECTION_TRUST_PROXY_HOPS, 10) || 1);
    const parseJson = express.json({ limit: '16kb' });
    const electionJson = (req, res, next) => parseJson(req, res, (error) => {
      if (!error) return next();
      return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: 'INVALID_REQUEST' });
    });
    app.get('/api/v1/public/election', handler(async (_req, res) => res.json(await service.publicState())));
    app.post('/api/v1/public/election/verify-code', electionJson, handler(async (req, res) => {
      return res.json(await service.verify(req.body?.salaireId, networkKey(req)));
    }));
    app.get('/api/v1/public/election/candidates', handler(async (req, res) => res.json(await service.candidates(bearer(req)))));
    app.get('/api/v1/public/election/participation', handler(async (req, res) => res.json(await service.participation(bearer(req)))));
    app.post('/api/v1/public/election/ballots', electionJson, handler(async (req, res) => res.status(201).json(await service.submit(bearer(req), req.body))));
  }
  function readiness() {
    const directory = directoryService?.getStatus?.() || { configured: false, sourceHealth: 'not_configured' };
    const checks = {
      firebaseAdmin: Boolean(firebaseDb),
      siteIdentity: Boolean(siteId),
      directorySheet: Boolean(env.EMPLOYEE_DIRECTORY_SHEET_ID),
      directoryVerifier: Boolean(env.EMPLOYEE_DIRECTORY_PEPPER),
      electionTimeZone: env.ELECTION_TIME_ZONE === 'Europe/Zurich',
      electionAuthorization: typeof env.ELECTION_GRANT_SECRET === 'string' && env.ELECTION_GRANT_SECRET.length >= 32,
      trustedProxy: Number.isInteger(Number.parseInt(env.ELECTION_TRUST_PROXY_HOPS, 10)) &&
        Number.parseInt(env.ELECTION_TRUST_PROXY_HOPS, 10) > 0,
      developmentIsolation: dataEnvironment === 'development',
      validDirectorySnapshot: Boolean(directory.lastSuccessfulRefreshAt),
    };
    return {
      ready: Object.values(checks).every(Boolean),
      checks,
      siteId: siteId || null,
      timeZone: env.ELECTION_TIME_ZONE || null,
      dataEnvironment: dataEnvironment || null,
      directory,
    };
  }
  return { service, mount, readiness };
}

module.exports = { createElectionRuntime, networkKey };