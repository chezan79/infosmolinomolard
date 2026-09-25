const { electionState, electionWindow } = require('./contract');
const { createAdministrationSessionAuthorization } = require('../employee-directory/auth');

class MonitoringError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const ELECTION_FIELDS = [
  'siteId', 'dataEnvironment', 'monthKey', 'timeZone',
  'opensAt', 'closesAt', 'eligibleVoterCount',
];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function createElectionMonitoringService({ db, siteId, dataEnvironment, timeZone, now = () => new Date() }) {
  return {
    async read() {
      if (!db || !siteId || !['development', 'production'].includes(dataEnvironment) ||
          timeZone !== 'Europe/Zurich') {
        throw new MonitoringError('MONITORING_UNAVAILABLE');
      }
      const observedAt = now();
      const window = electionWindow(observedAt, timeZone);
      const ref = db.collection('electionSites').doc(siteId)
        .collection('dataEnvironments').doc(dataEnvironment)
        .collection('elections').doc(window.monthKey);
      // Project only operational fields: never load the embedded voter/candidate snapshots.
      const [snapshot] = await db.getAll(ref, { fieldMask: ELECTION_FIELDS });
      if (!snapshot.exists) throw new MonitoringError('ELECTION_NOT_FOUND', 404);
      const election = snapshot.data();
      if (!election || election.siteId !== siteId ||
          election.dataEnvironment !== dataEnvironment ||
          election.monthKey !== window.monthKey || election.timeZone !== timeZone ||
          election.opensAt !== window.opensAt || election.closesAt !== window.closesAt ||
          !validCount(election.eligibleVoterCount)) {
        throw new MonitoringError('ELECTION_DATA_INVALID');
      }
      const [participation, ballots] = await Promise.all([
        ref.collection('participation').count().get(),
        ref.collection('ballots').count().get(),
      ]);
      const submitted = participation.data().count;
      const ballotCount = ballots.data().count;
      if (!validCount(submitted) || !validCount(ballotCount)) {
        throw new MonitoringError('MONITORING_UNAVAILABLE');
      }
      const eligible = election.eligibleVoterCount;
      return {
        month: window.monthKey,
        status: electionState(election, observedAt),
        window: { opensAt: election.opensAt, closesAt: election.closesAt },
        eligibleVoters: eligible,
        participation: {
          count: submitted,
          remaining: Math.max(eligible - submitted, 0),
          percentage: eligible ? Math.round((submitted / eligible) * 10000) / 100 : 0,
        },
        systemHealth: {
          participationRecords: submitted,
          anonymousBallots: ballotCount,
          consistency: submitted === ballotCount && submitted <= eligible ? 'OK' : 'ANOMALY',
        },
      };
    },
  };
}

function mountElectionMonitoring(app, { env, firebaseDb, firebaseAuth, now }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const administratorUid = String(env.MOLARD_ADMIN_FIREBASE_UID || '').trim();
  const service = createElectionMonitoringService({
    db: firebaseDb,
    siteId,
    dataEnvironment: env.ELECTION_DATA_ENVIRONMENT,
    timeZone: env.ELECTION_TIME_ZONE,
    now,
  });
  const authorize = firebaseAuth && siteId && administratorUid
    ? createAdministrationSessionAuthorization({ firebaseAuth, siteId, administratorUid })
    : (_req, res) => res.status(503).json({ error: 'MONITORING_UNAVAILABLE' });
  app.get('/api/v1/management/election-monitoring', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, authorize, async (_req, res) => {
    try {
      return res.json(await service.read());
    } catch (error) {
      const known = error instanceof MonitoringError;
      return res.status(known ? error.status : 503)
        .json({ error: known ? error.code : 'MONITORING_UNAVAILABLE' });
    }
  });
  return service;
}

module.exports = { createElectionMonitoringService, mountElectionMonitoring };