const crypto = require('node:crypto');

class ElectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class FirestoreElectionStore {
  constructor(db, siteId) {
    if (!db || !siteId) throw new Error('Election persistence is not configured');
    this.db = db;
    this.siteId = siteId;
    this.siteRef = db.collection('electionSites').doc(siteId);
  }

  electionRef(monthKey) {
    return this.siteRef.collection('elections').doc(monthKey);
  }

  async ensureElection(window, directory, now) {
    const ref = this.electionRef(window.monthKey);
    await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return;
      if (!directory || directory.siteId !== this.siteId || !Array.isArray(directory.employees)) throw new ElectionError('DIRECTORY_UNAVAILABLE');
      const voters = {};
      const candidates = {};
      const verifierByEmployee = new Map(directory.verifierRecords.map((record) => [record.employeeId, record]));
      for (const employee of directory.employees) {
        if (employee.siteId !== this.siteId) throw new ElectionError('TENANT_MISMATCH');
        if (employee.active && employee.canVote) voters[employee.employeeId] = {
          employeeId: employee.employeeId,
          votingGroup: employee.votingGroup,
          verifier: verifierByEmployee.get(employee.employeeId)?.verifier,
          verifierVersion: verifierByEmployee.get(employee.employeeId)?.verifierVersion,
        };
        if (employee.active && employee.canBeElected) candidates[employee.employeeId] = {
          employeeId: employee.employeeId, displayName: employee.displayName,
          jobTitle: employee.jobTitle, department: employee.department,
          votingGroup: employee.votingGroup, photoUrl: employee.photoUrl,
        };
      }
      tx.create(ref, {
        schemaVersion: 1, siteId: this.siteId, monthKey: window.monthKey,
        timeZone: window.timeZone, opensAt: window.opensAt, closesAt: window.closesAt,
        categories: ['CUISINE', 'SERVICE'], sourceGeneration: directory.sourceGeneration,
        voters, candidates, eligibleVoterCount: Object.keys(voters).length,
        createdAt: now.toISOString(),
      });
    });
    const saved = await ref.get();
    return saved.data();
  }

  async getElection(monthKey) {
    const doc = await this.electionRef(monthKey).get();
    return doc.exists ? doc.data() : null;
  }

  async checkRateLimit(keys, nowMs, policy) {
    const refs = keys.map((key) => this.siteRef.collection('rateLimits').doc(key));
    return this.db.runTransaction(async (tx) => {
      const docs = await Promise.all(refs.map((ref) => tx.get(ref)));
      const states = docs.map((doc) => doc.exists && doc.data().expiresAtMs > nowMs ? doc.data() : { count: 0 });
      if (states.some((state, i) => state.count >= policy[i])) return false;
      refs.forEach((ref, i) => tx.set(ref, {
        count: states[i].count + 1,
        expiresAtMs: nowMs + 15 * 60 * 1000,
      }));
      return true;
    });
  }

  async createGrant(grant) {
    await this.electionRef(grant.monthKey).collection('grants').doc(grant.hash).create(grant);
  }

  async authorize(monthKey, hash, nowMs, { allowConsumed = false } = {}) {
    const doc = await this.electionRef(monthKey).collection('grants').doc(hash).get();
    const grant = doc.exists ? doc.data() : null;
    if (!grant || grant.siteId !== this.siteId || grant.monthKey !== monthKey ||
        (!allowConsumed && grant.consumed) || (!grant.consumed && grant.expiresAtMs <= nowMs)) {
      throw new ElectionError('INVALID_AUTHORIZATION');
    }
    return grant;
  }

  async hasParticipated(monthKey, employeeId) {
    return (await this.electionRef(monthKey).collection('participation').doc(employeeId).get()).exists;
  }

  async participationCount(monthKey) {
    const snapshot = await this.electionRef(monthKey).collection('participation').get();
    return snapshot.size;
  }

  async submit({ monthKey, grantHash, ballot, now, stateFor }) {
    const electionRef = this.electionRef(monthKey);
    const grantRef = electionRef.collection('grants').doc(grantHash);
    const ballotRef = electionRef.collection('ballots').doc(crypto.randomUUID());
    return this.db.runTransaction(async (tx) => {
      const transactionNow = now();
      const [electionDoc, grantDoc] = await Promise.all([tx.get(electionRef), tx.get(grantRef)]);
      if (!electionDoc.exists) throw new ElectionError('ELECTION_UNAVAILABLE');
      const election = electionDoc.data();
      const grant = grantDoc.exists ? grantDoc.data() : null;
      if (!grant || grant.siteId !== this.siteId || grant.monthKey !== monthKey) {
        throw new ElectionError('INVALID_AUTHORIZATION');
      }
      const participationRef = electionRef.collection('participation').doc(grant.employeeId);
      const participation = await tx.get(participationRef);
      if (grant.consumed && participation.exists) return { code: 'SUBMITTED', replayed: true };
      if (grant.consumed || grant.expiresAtMs <= transactionNow.getTime()) throw new ElectionError('INVALID_AUTHORIZATION');
      if (stateFor(election, transactionNow) !== 'OPEN') throw new ElectionError('ELECTION_NOT_OPEN');
      const voter = election.voters[grant.employeeId];
      if (!voter) throw new ElectionError('NOT_ELIGIBLE');
      if (participation.exists) throw new ElectionError('ALREADY_VOTED');
      for (const category of ['CUISINE', 'SERVICE']) {
        const candidate = election.candidates[ballot.choices[category]];
        if (!candidate || candidate.votingGroup !== category || candidate.employeeId === grant.employeeId) {
          throw new ElectionError('INVALID_BALLOT');
        }
      }
      tx.create(participationRef, { status: 'SUBMITTED', submittedMonth: monthKey });
      tx.create(ballotRef, { schemaVersion: 1, choices: ballot.choices, comments: ballot.comments });
      tx.update(grantRef, { consumed: true });
      return { code: 'SUBMITTED' };
    });
  }

  async audit(monthKey, action, outcome, now) {
    await this.siteRef.collection('auditEvents').add({
      monthKey, action, outcome, timeBucket: now.toISOString().slice(0, 13),
    });
  }

  async tally(monthKey, now, stateFor) {
    const election = await this.getElection(monthKey);
    if (!election || stateFor(election, now) !== 'CLOSED_PENDING_RESULTS') throw new ElectionError('RESULTS_SEALED');
    const docs = await this.electionRef(monthKey).collection('ballots').get();
    const counts = { CUISINE: {}, SERVICE: {} };
    docs.forEach((doc) => {
      const ballot = doc.data();
      for (const category of ['CUISINE', 'SERVICE']) {
        const id = ballot.choices[category];
        counts[category][id] = (counts[category][id] || 0) + 1;
      }
    });
    return counts;
  }

  async finalize(monthKey, now, stateFor, summarize) {
    const requestedAt = now();
    const electionRef = this.electionRef(monthKey);
    const resultRef = electionRef.collection('resultInternals').doc('final');
    const existing = await resultRef.get();
    if (existing.exists) return existing.data();
    const counts = await this.tally(monthKey, requestedAt, stateFor);
    const result = {
      schemaVersion: 1, monthKey, finalizedAt: requestedAt.toISOString(),
      results: summarize(counts),
    };
    await this.db.runTransaction(async (tx) => {
      const transactionNow = now();
      const [electionDoc, resultDoc] = await Promise.all([tx.get(electionRef), tx.get(resultRef)]);
      if (!electionDoc.exists || stateFor(electionDoc.data(), transactionNow) !== 'CLOSED_PENDING_RESULTS') {
        throw new ElectionError('RESULTS_SEALED');
      }
      if (!resultDoc.exists) tx.create(resultRef, result);
    });
    const persisted = await resultRef.get();
    return persisted.data();
  }
}

module.exports = { ElectionError, FirestoreElectionStore };