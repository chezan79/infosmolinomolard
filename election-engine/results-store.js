const { FieldPath } = require('firebase-admin/firestore');
const { ResultError, MAX_BALLOTS, checkElection, assertSettled, canonical,
  buildPublication, verifyPublication, validMonth } = require('./results-contract');

const META_FIELDS = ['schemaVersion', 'siteId', 'dataEnvironment', 'monthKey',
  'timeZone', 'opensAt', 'closesAt', 'eligibleVoterCount'];

class FirestoreResultsStore {
  constructor(db, binding) {
    this.db = db;
    this.binding = binding;
    this.root = db.collection('electionSites').doc(binding.siteId)
      .collection('dataEnvironments').doc(binding.environment);
  }

  election(month) { return this.root.collection('elections').doc(month); }
  operation(month) { return this.election(month).collection('resultOperations').doc('state'); }
  final(month) { return this.election(month).collection('resultInternals').doc('final'); }
  publication(month) { return this.election(month).collection('publication').doc('public'); }
  latestRef() { return this.root.collection('publicationState').doc('latest'); }
  heartbeatRef() { return this.root.collection('publicationState').doc('worker'); }
  async recoveryAuthorization() {
    const doc = await this.root.collection('publicationState').doc('septemberRecoveryAuthorization').get();
    return doc.exists ? doc.data() : null;
  }

  async metadata(month) {
    const [doc] = await this.db.getAll(this.election(month), { fieldMask: META_FIELDS });
    return doc.exists ? doc.data() : null;
  }

  async listMonths(cursor = null, limit = 25, descending = false) {
    let query = this.root.collection('elections').orderBy(FieldPath.documentId(), descending ? 'desc' : 'asc')
      .select(...META_FIELDS).limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ month: doc.id, election: doc.data() }));
  }

  async readOperation(month) {
    const doc = await this.operation(month).get();
    return doc.exists ? doc.data() : null;
  }

  async heartbeat() {
    const doc = await this.heartbeatRef().get();
    return doc.exists ? doc.data() : null;
  }

  async saveHeartbeat(value) { await this.heartbeatRef().set(value, { merge: true }); }

  async claim(month, token, now, leaseMs, recovery) {
    const ref = this.operation(month);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const previous = doc.exists ? doc.data() : {};
      if (doc.exists && !['FINALIZING', 'VOTING_CLOSED', 'PUBLISHED', 'RESULT_REQUIRES_VERIFICATION'].includes(previous.state)) {
        tx.set(ref, { state: 'RESULT_REQUIRES_VERIFICATION', reason: 'UNEXPECTED_STATE',
          token: null, leaseUntilMs: 0, retryAt: null }, { merge: true });
        return null;
      }
      if (previous.state === 'PUBLISHED' ||
          (previous.leaseUntilMs > now.getTime()) ||
          (!recovery && (previous.state === 'RESULT_REQUIRES_VERIFICATION' ||
            Date.parse(previous.retryAt) > now.getTime()))) return null;
      tx.set(ref, {
        schemaVersion: 1, lastActor: recovery ? 'ADMIN_RECOVERY' : 'WORKER',
        state: 'FINALIZING', token, leaseUntilMs: now.getTime() + leaseMs,
        lastAttemptAt: now.toISOString(), attempts: (previous.attempts || 0) + 1,
        retryAt: null, reason: null,
      }, { merge: true });
      return token;
    });
  }

  async fail(month, token, error, now) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.operation(month);
      const doc = await tx.get(ref);
      if (!doc.exists || doc.data().token !== token || doc.data().state === 'PUBLISHED') return;
      const attempts = doc.data().attempts || 1;
      const delay = Math.min(60 * 60 * 1000, 300000 * (2 ** Math.min(attempts - 1, 4)));
      tx.set(ref, {
        state: error.retryable ? 'VOTING_CLOSED' : 'RESULT_REQUIRES_VERIFICATION',
        reason: error.code, token: null, leaseUntilMs: 0,
        retryAt: error.retryable ? new Date(now.getTime() + delay).toISOString() : null,
      }, { merge: true });
    });
  }

  async input(tx, month, now) {
    const [doc] = await tx.getAll(this.election(month), { fieldMask: [...META_FIELDS, 'candidates'] });
    if (!doc.exists) throw new ResultError('ELECTION_NOT_FOUND');
    const election = checkElection(doc.data(), month, this.binding);
    // Check closure BEFORE requesting anonymous choices.
    assertSettled(election, now);
    const ballots = await tx.get(this.election(month).collection('ballots')
      .select('schemaVersion', 'choices').limit(MAX_BALLOTS + 1));
    const participation = await tx.get(this.election(month).collection('participation').count());
    const final = await tx.get(this.final(month));
    return {
      election,
      ballots: ballots.docs.map((ballot) => ({ ...ballot.data(),
        committedAtMs: ballot.createTime?.toMillis() ?? NaN })),
      participationCount: participation.data().count,
      final: final.exists ? final.data() : null,
    };
  }

  async validate(month, now) {
    return this.db.runTransaction(async (tx) => canonical(await this.input(tx, month, now),
      this.binding, month, now), { readOnly: true });
  }

  async verifyPublished(month, now) {
    return this.db.runTransaction(async (tx) => {
      const input = await this.input(tx, month, now);
      const proof = canonical(input, this.binding, month, now);
      const publication = await tx.get(this.publication(month));
      if (!publication.exists) throw new ResultError('PUBLICATION_MISMATCH');
      verifyPublication(publication.data(), proof, input.final, month, this.binding, now);
    }, { readOnly: true });
  }

  async flagPublished(month, reason) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.operation(month);
      const operation = await tx.get(ref);
      if (operation.exists && operation.data().state === 'PUBLISHED') {
        tx.set(ref, { state: 'RESULT_REQUIRES_VERIFICATION', reason }, { merge: true });
      }
    });
  }

  assertLease(operation, token, now) {
    if (!operation.exists || operation.data().token !== token ||
        operation.data().leaseUntilMs <= now.getTime()) throw new ResultError('LEASE_LOST', true);
  }

  async finalize(month, token, expectedDigest, now) {
    return this.db.runTransaction(async (tx) => {
      const operation = await tx.get(this.operation(month));
      this.assertLease(operation, token, now);
      const input = await this.input(tx, month, now);
      const proof = canonical(input, this.binding, month, now);
      if (proof.digest !== expectedDigest) throw new ResultError('SOURCE_CHANGED');
      if (input.final) return input.final;
      const final = { schemaVersion: 1, monthKey: month, finalizedAt: now.toISOString(), results: proof.results };
      tx.create(this.final(month), final);
      return final;
    });
  }

  async publish(month, token, expectedDigest, now, photos) {
    return this.db.runTransaction(async (tx) => {
      const operation = await tx.get(this.operation(month));
      this.assertLease(operation, token, now);
      const input = await this.input(tx, month, now);
      const proof = canonical(input, this.binding, month, now);
      if (!input.final || proof.digest !== expectedDigest) throw new ResultError('RESULT_MISMATCH');
      const existing = await tx.get(this.publication(month));
      const latest = await tx.get(this.latestRef());
      let publication;
      if (existing.exists) {
        publication = existing.data();
        verifyPublication(publication, proof, input.final, month, this.binding, now);
      } else {
        publication = buildPublication(proof, input.final, month, this.binding, now, photos);
        tx.create(this.publication(month), publication);
      }
      if (latest.exists && !validMonth(latest.data().monthKey)) throw new ResultError('PUBLICATION_MISMATCH');
      if (!latest.exists || latest.data().monthKey < month) {
        tx.set(this.latestRef(), { monthKey: month, publishedAt: publication.publishedAt });
      }
      tx.set(this.operation(month), {
        state: 'PUBLISHED', token: null, leaseUntilMs: 0, reason: null, retryAt: null,
        publishedAt: publication.publishedAt,
      }, { merge: true });
      return publication;
    });
  }

  async latest() {
    const pointer = await this.latestRef().get();
    if (!pointer.exists) return null;
    if (!validMonth(pointer.data().monthKey)) throw new ResultError('PUBLICATION_INVALID');
    const doc = await this.publication(pointer.data().monthKey).get();
    const operation = await this.readOperation(pointer.data().monthKey);
    if (!doc.exists || operation?.state !== 'PUBLISHED' ||
        doc.data().publishedAt !== pointer.data().publishedAt) throw new ResultError('PUBLICATION_INVALID');
    return doc.data();
  }

  async photoPublication(month) {
    const operation = await this.readOperation(month);
    if (operation?.state !== 'PUBLISHED') return null;
    const doc = await this.publication(month).get();
    return doc.exists ? doc.data() : null;
  }
}

module.exports = { FirestoreResultsStore };