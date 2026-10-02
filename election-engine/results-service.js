const crypto = require('node:crypto');
const { electionState } = require('./contract');
const { SEPTEMBER_HOLD, LEASE_MS, ResultError, checkElection, assertSettled, publicPublication, validMonth } = require('./results-contract');

const SAFE_REASONS = new Set([
  'SEPTEMBER_RECOVERY_HOLD', 'ELECTION_DATA_INVALID', 'ELECTION_WINDOW_INVALID',
  'RESULTS_SEALED', 'AWAITING_SETTLEMENT', 'COUNT_MISMATCH', 'BALLOT_INVALID',
  'LATE_BALLOT', 'CANDIDATE_INVALID', 'RESULT_MISMATCH', 'SOURCE_CHANGED',
  'PUBLICATION_MISMATCH', 'LEASE_LOST', 'STORAGE_UNAVAILABLE', 'ELECTION_NOT_FOUND',
  'UNEXPECTED_STATE', 'PUBLICATION_INVALID',
]);
const safeReason = (reason) => SAFE_REASONS.has(reason) ? reason : reason ? 'STORAGE_UNAVAILABLE' : null;

class ElectionResultsService {
  constructor({ store, binding, enabled = false, automationEnabled = false,
    septemberRecoveryApproved = false, photos = null, now = () => new Date() }) {
    Object.assign(this, { store, binding, enabled, automationEnabled, septemberRecoveryApproved, photos, now });
  }

  assertEnabled() {
    if (!this.enabled || !this.store) throw new ResultError('RESULTS_UNAVAILABLE', true, 503);
  }

  async septemberAuthorization() {
    // Both independent approvals are mandatory. With the flag off this makes ZERO reads.
    if (!this.septemberRecoveryApproved || !this.enabled || !this.store ||
        this.binding.environment !== 'production') return null;
    const authorization = await this.store.recoveryAuthorization();
    const now = this.now().getTime();
    if (!authorization || authorization.schemaVersion !== 1 || authorization.monthKey !== SEPTEMBER_HOLD ||
        authorization.projectId !== this.binding.projectId || authorization.databaseId !== this.binding.databaseId ||
        authorization.siteId !== this.binding.siteId || authorization.dataEnvironment !== 'production' ||
        !/^[a-f0-9]{64}$/.test(authorization.integrityDigest || '') ||
        !Number.isFinite(Date.parse(authorization.verifiedAt)) ||
        !Number.isFinite(Date.parse(authorization.authorizedAt)) ||
        Date.parse(authorization.authorizedAt) < Date.parse(authorization.verifiedAt) ||
        Date.parse(authorization.authorizedAt) > now) return null;
    return authorization;
  }

  view(month, election, operation, held = month === SEPTEMBER_HOLD) {
    if (held) return {
      month, state: 'RESULT_REQUIRES_VERIFICATION', reason: 'SEPTEMBER_RECOVERY_HOLD',
      held: true, publishedAt: null, lastAttemptAt: null, retryAt: null,
    };
    let state;
    try {
      checkElection(election, month, this.binding);
      const lifecycle = electionState(election, this.now());
      state = lifecycle === 'OPEN' ? 'VOTING_OPEN' :
        lifecycle === 'UPCOMING' ? 'VOTING_UPCOMING' : operation?.state || 'VOTING_CLOSED';
      if (state === 'FINALIZING' && operation.leaseUntilMs <= this.now().getTime()) state = 'VOTING_CLOSED';
    } catch {
      state = 'RESULT_REQUIRES_VERIFICATION';
    }
    const allowed = ['VOTING_OPEN', 'VOTING_UPCOMING', 'VOTING_CLOSED', 'FINALIZING', 'PUBLISHED', 'RESULT_REQUIRES_VERIFICATION'];
    return {
      month, state: allowed.includes(state) ? state : 'RESULT_REQUIRES_VERIFICATION', held: false,
      reason: state === 'RESULT_REQUIRES_VERIFICATION' && !operation?.reason ? 'ELECTION_DATA_INVALID' : safeReason(operation?.reason),
      publishedAt: operation?.publishedAt || null, lastAttemptAt: operation?.lastAttemptAt || null,
      retryAt: operation?.retryAt || null,
    };
  }

  async monitor() {
    const base = { enabled: this.enabled, automationEnabled: this.automationEnabled, heartbeat: null, months: [] };
    if (!this.enabled || !this.store) return { ...base, storageStatus: 'DISABLED' };
    try {
      const months = await this.store.listMonths(null, 60, true);
      const heartbeat = await this.store.heartbeat();
      const septemberAuthorization = await this.septemberAuthorization();
      return {
        ...base, storageStatus: 'AVAILABLE',
        heartbeat: heartbeat ? {
          lastAttemptAt: heartbeat.lastAttemptAt, lastSuccessAt: heartbeat.lastSuccessAt || null,
          status: ['OK', 'ERROR', 'RUNNING', 'VERIFICATION_REQUIRED'].includes(heartbeat.status) ? heartbeat.status : 'ERROR',
        } : null,
        months: await Promise.all(months.filter(({ month }) => validMonth(month)).map(async ({ month, election }) =>
          this.view(month, election,
            month === SEPTEMBER_HOLD && !septemberAuthorization ? null : await this.store.readOperation(month),
            month === SEPTEMBER_HOLD && !septemberAuthorization))),
      };
    } catch {
      return { ...base, storageStatus: 'UNAVAILABLE' };
    }
  }

  async latest() {
    this.assertEnabled();
    const snapshot = await this.store.latest();
    if (!snapshot) return null;
    return publicPublication(snapshot, this.binding, this.now());
  }

  async processMonth(month, { recovery = false } = {}) {
    // Deliberately before ANY datastore access, including operation-state writes.
    if (!validMonth(month)) throw new ResultError('INVALID_MONTH', false, 400);
    const authorization = month === SEPTEMBER_HOLD ? await this.septemberAuthorization() : null;
    if (month === SEPTEMBER_HOLD && !authorization) throw new ResultError('SEPTEMBER_RECOVERY_HOLD');
    this.assertEnabled();
    const election = await this.store.metadata(month);
    if (!election) throw new ResultError('ELECTION_NOT_FOUND', false, 404);
    const token = crypto.randomUUID();
    const now = this.now();
    // Never claim or mutate open/upcoming elections.
    try {
      checkElection(election, month, this.binding);
      assertSettled(election, now);
    } catch (error) {
      if (error.code === 'RESULTS_SEALED' || error.code === 'AWAITING_SETTLEMENT') throw error;
      // Invalid closed metadata still needs a visible verification status.
    }
    const claimed = await this.store.claim(month, token, now, LEASE_MS, recovery);
    if (!claimed) {
      const operation = await this.store.readOperation(month);
      if (operation?.state === 'PUBLISHED') {
        try {
          await this.store.verifyPublished(month, this.now());
        } catch (error) {
          if (error instanceof ResultError) await this.store.flagPublished(month, safeReason(error.code));
          throw error instanceof ResultError ? error : new ResultError('STORAGE_UNAVAILABLE', true, 503);
        }
      }
      return this.view(month, election, operation, false);
    }
    try {
      const proof = await this.store.validate(month, this.now());
      if (authorization && authorization.integrityDigest !== proof.digest) throw new ResultError('SOURCE_CHANGED');
      await this.store.finalize(month, token, proof.digest, this.now());
      const photos = this.photos ? await this.photos.prepare(month, proof) : {};
      await this.store.publish(month, token, proof.digest, this.now(), photos);
    } catch (error) {
      const known = error instanceof ResultError ? error : new ResultError('STORAGE_UNAVAILABLE', true, 503);
      await this.store.fail(month, token, known, this.now());
      throw known;
    }
    return this.view(month, election, await this.store.readOperation(month), false);
  }

  async run() {
    this.assertEnabled();
    if (!this.automationEnabled) throw new ResultError('AUTOMATION_DISABLED', false, 503);
    const previous = await this.store.heartbeat();
    const cursor = validMonth(previous?.cursor) ? previous.cursor : null;
    await this.store.saveHeartbeat({ lastAttemptAt: this.now().toISOString(), status: 'RUNNING' });
    try {
      const page = await this.store.listMonths(cursor, 25);
      let processed = 0;
      let blocked = 0;
      for (const { month, election } of page) {
        if (!validMonth(month) || (month === SEPTEMBER_HOLD && !this.septemberRecoveryApproved)) continue;
        try {
          checkElection(election, month, this.binding);
          if (electionState(election, this.now()) !== 'CLOSED_PENDING_RESULTS') continue;
          const result = await this.processMonth(month);
          if (result.state === 'PUBLISHED') processed += 1;
          if (result.state === 'RESULT_REQUIRES_VERIFICATION') blocked += 1;
        } catch (error) {
          if (error instanceof ResultError && error.code === 'AWAITING_SETTLEMENT') continue;
          blocked += 1;
        }
      }
      await this.store.saveHeartbeat({
        cursor: page.length === 25 ? page[page.length - 1].month : null,
        status: blocked ? 'VERIFICATION_REQUIRED' : 'OK', lastSuccessAt: this.now().toISOString(),
      });
      return { processed, verificationRequired: blocked };
    } catch {
      await this.store.saveHeartbeat({ status: 'ERROR' });
      throw new ResultError('STORAGE_UNAVAILABLE', true, 503);
    }
  }
}

module.exports = { ElectionResultsService };