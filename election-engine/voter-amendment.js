const { electionState, electionWindow } = require('./contract');
const { createAdministrationSessionAuthorization, requireSameOrigin } = require('../employee-directory/auth');
class MonitoringError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
const DEPARTMENTS = { Cuisine: 'CUISINE', Pizzeria: 'CUISINE', Plonge: 'CUISINE', Service: 'SERVICE' };
function mountVoterAmendment(app, { env, firebaseDb, firebaseAuth, directoryService, now }) {
  const siteId = env.EMPLOYEE_DIRECTORY_SITE_ID || '';
  const administratorUid = String(env.MOLARD_ADMIN_FIREBASE_UID || '').trim();
  const authorize = firebaseAuth && siteId && administratorUid
    ? createAdministrationSessionAuthorization({ firebaseAuth, siteId, administratorUid })
    : (_req, res) => res.status(503).json({ code: 'ADMINISTRATION_UNAVAILABLE' });
  app.post('/api/v1/management/election-add-voter-only', requireSameOrigin, authorize, require('express').json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!firebaseDb || siteId !== 'molard' || env.NODE_ENV !== 'production' ||
          env.ELECTION_DATA_ENVIRONMENT !== 'production' || env.ELECTION_TIME_ZONE !== 'Europe/Zurich' ||
          require('./runtime-diagnostic').inspectOfficialRuntime(env, firebaseDb).status !== 'VERIFIED') {
        return res.status(503).json({ code: 'BINDING_UNVERIFIED' });
      }
      const employeeId = req.body?.employeeId;
      if (typeof employeeId !== 'string' || !/^MOL-[0-9]+$/.test(employeeId)) return res.status(400).json({ code: 'INVALID_EMPLOYEE' });
      await directoryService.refresh();
      const directory = directoryService.getElectionSnapshot();
      const employee = directory?.employees.find(e => e.employeeId === employeeId);
      const verifier = directory?.verifierRecords.find(e => e.employeeId === employeeId);
      if (directory?.siteId !== siteId || employee?.siteId !== siteId || !employee.active || !employee.canVote ||
          employee.canBeElected || DEPARTMENTS[employee.department] !== employee.votingGroup ||
          !verifier?.verifier || !verifier.verifierVersion) {
        return res.status(409).json({ code: 'NOT_ELIGIBLE_VOTER_ONLY' });
      }
      const clock = now || (() => new Date());
      const window = electionWindow(clock(), env.ELECTION_TIME_ZONE);
      const ref = firebaseDb.collection('electionSites').doc(siteId).collection('dataEnvironments')
        .doc('production').collection('elections').doc(window.monthKey);
      const added = await firebaseDb.runTransaction(async tx => {
        const doc = await tx.get(ref);
        const election = doc.data();
        if (!doc.exists || election.siteId !== siteId || election.dataEnvironment !== 'production' ||
            election.monthKey !== window.monthKey || election.timeZone !== env.ELECTION_TIME_ZONE ||
            election.opensAt !== window.opensAt || election.closesAt !== window.closesAt ||
            electionState(election, clock()) !== 'OPEN' || !election.voters || !election.candidates ||
            Object.keys(election.voters).length !== election.eligibleVoterCount) throw new MonitoringError('ELECTION_NOT_OPEN_OR_INVALID', 409);
        if (Object.hasOwn(election.voters, employeeId)) return false;
        if (Object.hasOwn(election.candidates, employeeId) ||
            Object.values(election.voters).some(v => v.verifier === verifier.verifier)) throw new MonitoringError('IDENTITY_CONFLICT', 409);
        const participation = await tx.get(ref.collection('participation').doc(employeeId));
        if (participation.exists) throw new MonitoringError('IDENTITY_CONFLICT', 409);
        tx.update(ref, { voters: { ...election.voters, [employeeId]: {
          employeeId, votingGroup: employee.votingGroup, displayName: employee.displayName,
          department: employee.department, verifier: verifier.verifier, verifierVersion: verifier.verifierVersion
        } }, eligibleVoterCount: election.eligibleVoterCount + 1 });
        tx.create(ref.collection('rosterAmendments').doc(employeeId), {
          employeeId, action: 'ADD_VOTER_ONLY', monthKey: window.monthKey,
          sourceGeneration: directory.sourceGeneration, createdAt: clock().toISOString()
        });
        return true;
      });
      return res.json({ code: added ? 'VOTER_ADDED' : 'ALREADY_ELIGIBLE', month: window.monthKey });
    } catch (error) {
      return res.status(error instanceof MonitoringError ? error.status : 503)
        .json({ code: error instanceof MonitoringError ? error.code : 'SYNC_UNAVAILABLE' });
    }
  });
}
module.exports = { mountVoterAmendment };
