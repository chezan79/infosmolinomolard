const { electionState, electionWindow } = require('./contract');
const { createAdministrationSessionAuthorization, requireSameOrigin } = require('../employee-directory/auth');

class MonitoringError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const ELECTION_FIELDS = [
  'siteId', 'dataEnvironment', 'monthKey', 'timeZone',
  'opensAt', 'closesAt', 'eligibleVoterCount', 'sourceGeneration',
];
const VOTER_GROUPS = new Set(['CUISINE', 'SERVICE']);
const DEPARTMENTS = {
  Cuisine: 'CUISINE',
  Pizzeria: 'CUISINE',
  Plonge: 'CUISINE',
  Service: 'SERVICE',
};
const validMonth = (value) => typeof value === 'string' &&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function resolveIndividuals(db, ref, directoryService, siteId, eligible, submitted, allowCurrentDirectory = true) {
  const unavailable = {
    status: 'UNAVAILABLE',
    eligibleIdentitiesResolved: null,
    eligibleIdentitiesTotal: eligible,
    participantIdentitiesResolved: null,
    participantIdentitiesTotal: submitted,
    voters: null,
  };
  try {
    const [snapshot] = await db.getAll(ref, { fieldMask: ['voters', 'sourceGeneration'] });
    const entries = snapshot.data()?.voters;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
        Object.keys(entries).length !== eligible) return unavailable;

    let directory = null;
    try {
      if (allowCurrentDirectory) directory = directoryService?.getElectionSnapshot();
    } catch { /* Snapshot names are optional. */ }
    const employees = new Map();
    const duplicates = new Set();
    // Employee IDs are stable. A later directory refresh must not hide a valid
    // unique ID-to-name match; the UI labels these as CURRENT_DIRECTORY.
    if (directory?.siteId === siteId && Array.isArray(directory.employees)) {
      for (const employee of directory.employees) {
        if (!employee || employee.siteId !== siteId || typeof employee.employeeId !== 'string') continue;
        if (employees.has(employee.employeeId)) duplicates.add(employee.employeeId);
        else employees.set(employee.employeeId, employee);
      }
    }
    for (const id of duplicates) employees.delete(id);

    const participation = await ref.collection('participation').select().get();
    if (!Array.isArray(participation.docs)) return unavailable;
    const ids = new Set(participation.docs.map((doc) => doc.id));
    if (ids.size !== participation.docs.length) return unavailable;

    const rows = Object.entries(entries).map(([employeeId, voter]) => {
      if (!voter || voter.employeeId !== employeeId || !VOTER_GROUPS.has(voter.votingGroup)) {
        return { employeeId, name: '', department: '', hasVoted: ids.has(employeeId), identitySource: 'UNRESOLVED' };
      }

      const hasSnapshotIdentity = Object.hasOwn(voter, 'displayName') || Object.hasOwn(voter, 'department');
      let name = '';
      let department = '';
      let identitySource = 'UNRESOLVED';

      if (hasSnapshotIdentity) {
        const snapshotName = typeof voter.displayName === 'string' ? voter.displayName.trim() : '';
        const snapshotDepartment = voter.department;
        if (snapshotName && DEPARTMENTS[snapshotDepartment] === voter.votingGroup) {
          name = snapshotName;
          department = snapshotDepartment;
          identitySource = 'ELECTION_SNAPSHOT';
        }
      } else {
        const employee = employees.get(employeeId);
        const currentName = typeof employee?.displayName === 'string' ? employee.displayName.trim() : '';
        if (currentName && DEPARTMENTS[employee.department] === voter.votingGroup &&
            employee.votingGroup === voter.votingGroup) {
          name = currentName;
          department = employee.department;
          identitySource = 'CURRENT_DIRECTORY';
        }
      }
      return { employeeId, name, department, hasVoted: ids.has(employeeId), identitySource };
    });

    const nameGroups = new Map();
    for (const row of rows) {
      if (!row.name) continue;
      const normalized = row.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      nameGroups.set(normalized, [...(nameGroups.get(normalized) || []), row]);
    }
    for (const group of nameGroups.values()) {
      if (group.length > 1) {
        for (const row of group) {
          row.name = '';
          row.department = '';
          row.identitySource = 'UNRESOLVED';
        }
      }
    }
    const resolvableIds = new Set(rows.filter((row) => row.name).map((row) => row.employeeId));
    let unresolvedOrdinal = 0;
    const voters = rows.map((row) => {
      if (row.name) {
        return { employeeId: row.employeeId, name: row.name, department: row.department,
          hasVoted: row.hasVoted, identitySource: row.identitySource };
      }
      unresolvedOrdinal += 1;
      return { employeeId: row.employeeId, name: `Identité non résolue ${unresolvedOrdinal}`, department: 'Non disponible',
        hasVoted: row.hasVoted, identitySource: 'UNRESOLVED' };
    });
    const participantIdentitiesResolved = [...ids].filter((id) => resolvableIds.has(id)).length;
    const eligibleIdentitiesResolved = resolvableIds.size;
    const complete = eligibleIdentitiesResolved === eligible &&
      participantIdentitiesResolved === submitted && ids.size === submitted;
    return {
      status: complete ? 'AVAILABLE' : 'PARTIAL',
      eligibleIdentitiesResolved,
      eligibleIdentitiesTotal: eligible,
      participantIdentitiesResolved,
      participantIdentitiesTotal: submitted,
      voters,
    };
  } catch {
    return unavailable;
  }
}

function createElectionMonitoringService({ db, directoryService, siteId, dataEnvironment, timeZone, now = () => new Date() }) {
  return {
    async read(requestedMonth) {
      if (!db || !siteId || !['development', 'production'].includes(dataEnvironment) ||
          timeZone !== 'Europe/Zurich') {
        throw new MonitoringError('MONITORING_UNAVAILABLE');
      }
      if (requestedMonth !== undefined && !validMonth(requestedMonth)) {
        throw new MonitoringError('INVALID_MONTH', 400);
      }
      const observedAt = now();
      const currentWindow = electionWindow(observedAt, timeZone);
      const elections = db.collection('electionSites').doc(siteId)
        .collection('dataEnvironments').doc(dataEnvironment).collection('elections');
      const listed = await elections.select('monthKey').get();
      const availableMonths = [...new Set((listed.docs || []).flatMap((doc) => {
        const monthKey = doc.data()?.monthKey;
        return validMonth(doc.id) && monthKey === doc.id ? [monthKey] : [];
      }))].sort((a, b) => b.localeCompare(a));
      const month = requestedMonth || (availableMonths.includes(currentWindow.monthKey)
        ? currentWindow.monthKey : availableMonths[0]);
      if (!month || !availableMonths.includes(month)) throw new MonitoringError('ELECTION_NOT_FOUND', 404);
      const window = electionWindow(new Date(`${month}-15T12:00:00.000Z`), timeZone);
      if (window.monthKey !== month) throw new MonitoringError('INVALID_MONTH', 400);
      const ref = elections.doc(month);
      const [snapshot] = await db.getAll(ref, { fieldMask: ELECTION_FIELDS });
      if (!snapshot.exists) throw new MonitoringError('ELECTION_NOT_FOUND', 404);
      const election = snapshot.data();
      if (!election || election.siteId !== siteId ||
          election.dataEnvironment !== dataEnvironment ||
          election.monthKey !== month || election.timeZone !== timeZone ||
          election.opensAt !== window.opensAt || election.closesAt !== window.closesAt ||
          !validCount(election.eligibleVoterCount)) {
        throw new MonitoringError('ELECTION_DATA_INVALID');
      }
      const [participation] = await Promise.all([
        ref.collection('participation').count().get(),
      ]);
      const submitted = participation.data().count;
      if (!validCount(submitted)) {
        throw new MonitoringError('MONITORING_UNAVAILABLE');
      }
      const eligible = election.eligibleVoterCount;
      const individual = await resolveIndividuals(db, ref, directoryService, siteId, eligible, submitted,
        true);
      return {
        month,
        availableMonths,
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
          consistency: submitted <= eligible ? 'OK' : 'ANOMALY',
        },
        individual,
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
  }, authorize, async (req, res) => {
    try {
      return res.json(await service.read(req.query.month));
    } catch (error) {
      const known = error instanceof MonitoringError;
      return res.status(known ? error.status : 503)
        .json({ error: known ? error.code : 'MONITORING_UNAVAILABLE' });
    }
  });
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
  return service;
}

module.exports = { createElectionMonitoringService, mountElectionMonitoring };