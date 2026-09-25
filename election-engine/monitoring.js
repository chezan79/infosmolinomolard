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
  'opensAt', 'closesAt', 'eligibleVoterCount', 'voters',
];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function createElectionMonitoringService({ db, directoryService, siteId, dataEnvironment, timeZone, now = () => new Date() }) {
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
      // Voters are needed server-side; never load candidates, grants or individual ballots.
      const [snapshot] = await db.getAll(ref, { fieldMask: ELECTION_FIELDS });
      if (!snapshot.exists) throw new MonitoringError('ELECTION_NOT_FOUND', 404);
      const election = snapshot.data();
      if (!election || election.siteId !== siteId ||
          election.dataEnvironment !== dataEnvironment ||
          election.monthKey !== window.monthKey || election.timeZone !== timeZone ||
          election.opensAt !== window.opensAt || election.closesAt !== window.closesAt ||
          !validCount(election.eligibleVoterCount) ||
          !election.voters || typeof election.voters !== 'object' ||
          Array.isArray(election.voters) ||
          Object.keys(election.voters).length !== election.eligibleVoterCount) {
        throw new MonitoringError('ELECTION_DATA_INVALID');
      }
      const directory = directoryService?.getElectionSnapshot();
      if (!directory || directory.siteId !== siteId || !Array.isArray(directory.employees)) {
        throw new MonitoringError('DIRECTORY_UNAVAILABLE');
      }
      const employees = new Map();
      for (const employee of directory.employees) {
        if (!employee || employee.siteId !== siteId || !employee.employeeId ||
            employees.has(employee.employeeId)) throw new MonitoringError('DIRECTORY_UNAVAILABLE');
        employees.set(employee.employeeId, employee);
      }
      const names = new Set();
      const voters = Object.entries(election.voters).map(([employeeId, voter]) => {
        const employee = employees.get(employeeId);
        const name = employee?.displayName?.trim();
        const department = employee?.department;
        if (!voter || voter.employeeId !== employeeId || !['CUISINE', 'SERVICE'].includes(voter.votingGroup) ||
            !name || typeof department !== 'string' || !['Cuisine', 'Pizzeria', 'Plonge', 'Service'].includes(department) ||
            employee.votingGroup !== voter.votingGroup || names.has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())) {
          throw new MonitoringError('VOTER_MAPPING_UNAVAILABLE');
        }
        names.add(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
        return { employeeId, name, department };
      });
      const participationRef = ref.collection('participation');
      const [participation, ballots, participationIds] = await Promise.all([
        participationRef.count().get(),
        ref.collection('ballots').count().get(),
        participationRef.select().get(), // document references only; no participation payload
      ]);
      const submitted = participation.data().count;
      const ballotCount = ballots.data().count;
      if (!validCount(submitted) || !validCount(ballotCount) || !Array.isArray(participationIds.docs)) {
        throw new MonitoringError('MONITORING_UNAVAILABLE');
      }
      const ids = new Set(participationIds.docs.map((doc) => doc.id));
      if (ids.size !== participationIds.docs.length) throw new MonitoringError('MONITORING_UNAVAILABLE');
      const list = voters.map(({ employeeId, name, department }) => ({
        name, department, hasVoted: ids.has(employeeId),
      }));
      const identified = list.filter((voter) => voter.hasVoted).length;
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
          consistency: submitted === ballotCount && submitted === identified &&
            submitted === ids.size && submitted <= eligible ? 'OK' : 'ANOMALY',
        },
        voters: list,
      };
    },
  };
}

function mountElectionMonitoring(app, { env, firebaseDb, firebaseAuth, directoryService, now }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const administratorUid = String(env.MOLARD_ADMIN_FIREBASE_UID || '').trim();
  const service = createElectionMonitoringService({
    db: firebaseDb,
    directoryService,
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