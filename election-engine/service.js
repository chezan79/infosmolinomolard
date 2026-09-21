const crypto = require('node:crypto');
const { createSalaireVerifier } = require('../employee-directory/contract');
const {
  CATEGORIES, DEFAULT_GRANT_TTL_MS, electionState, electionWindow,
  safeCandidate, tokenHash, validTimeZone, validateBallot, winnersFromCounts,
} = require('./contract');
const { ElectionError } = require('./firestore-store');

class ElectionService {
  constructor({ store, directoryService, siteId, timeZone, pepper, grantSecret, grantTtlMs = DEFAULT_GRANT_TTL_MS, now = () => new Date() }) {
    this.store = store; this.directoryService = directoryService; this.siteId = siteId;
    this.timeZone = timeZone; this.pepper = pepper; this.grantSecret = grantSecret;
    this.grantTtlMs = grantTtlMs; this.now = now;
  }

  configured() {
    return Boolean(this.store && this.directoryService && this.siteId && validTimeZone(this.timeZone) && this.pepper && this.grantSecret.length >= 32);
  }

  async current() {
    if (!this.configured() || !this.directoryService.snapshot) throw new ElectionError('SERVICE_UNAVAILABLE');
    const now = this.now();
    const window = { ...electionWindow(now, this.timeZone), timeZone: this.timeZone };
    const election = await this.store.ensureElection(window, this.directoryService.snapshot, now);
    return { election, now, state: electionState(election, now) };
  }

  async publicState() {
    const { election, now, state } = await this.current();
    const submitted = await this.store.participationCount(election.monthKey);
    return {
      code: 'ELECTION_STATE', monthKey: election.monthKey, state,
      timeZone: election.timeZone, opensAt: election.opensAt, closesAt: election.closesAt,
      serverTime: now.toISOString(), categories: CATEGORIES,
      participation: { eligible: election.eligibleVoterCount, submitted },
    };
  }

  async verify(salaireId, networkKey = 'unknown') {
    const { election, now, state } = await this.current();
    if (state !== 'OPEN') throw new ElectionError('ELECTION_NOT_OPEN');
    if (typeof salaireId !== 'string' || salaireId.length > 128) throw new ElectionError('INVALID_CREDENTIALS');
    const verifier = createSalaireVerifier(salaireId.trim(), this.pepper);
    const network = tokenHash(`network:${networkKey}`, this.grantSecret).slice(0, 32);
    const fingerprint = tokenHash(`credential:${verifier}`, this.grantSecret).slice(0, 32);
    const permitted = await this.store.checkRateLimit([`network-${network}`, `site-${election.monthKey}`, `credential-${fingerprint}`], now.getTime(), [30, 300, 8]);
    if (!permitted) {
      await this.store.audit(election.monthKey, 'VERIFY', 'RATE_LIMITED', now);
      throw new ElectionError('RATE_LIMITED');
    }
    const voter = Object.values(election.voters).find((item) =>
      typeof item.verifier === 'string' &&
      item.verifier.length === verifier.length &&
      crypto.timingSafeEqual(Buffer.from(item.verifier), Buffer.from(verifier)));
    if (!voter) {
      await this.store.audit(election.monthKey, 'VERIFY', 'REJECTED', now);
      throw new ElectionError('INVALID_CREDENTIALS');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = tokenHash(token, this.grantSecret);
    const expiresAtMs = now.getTime() + this.grantTtlMs;
    await this.store.createGrant({ hash, siteId: this.siteId, monthKey: election.monthKey, employeeId: voter.employeeId, verifierVersion: voter.verifierVersion, expiresAtMs, consumed: false });
    await this.store.audit(election.monthKey, 'VERIFY', 'ACCEPTED', now);
    return { code: 'VERIFIED', authorization: token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async authorize(token, options) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw new ElectionError('INVALID_AUTHORIZATION');
    const { election, now } = await this.current();
    const grant = await this.store.authorize(election.monthKey, tokenHash(token, this.grantSecret), now.getTime(), options);
    return { election, now, grant, hash: tokenHash(token, this.grantSecret) };
  }

  async candidates(token) {
    const { election, grant } = await this.authorize(token);
    const grouped = { CUISINE: [], SERVICE: [] };
    for (const candidate of Object.values(election.candidates)) {
      if (candidate.employeeId !== grant.employeeId) grouped[candidate.votingGroup].push(safeCandidate(candidate));
    }
    for (const category of CATEGORIES) grouped[category].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
    return { code: 'CANDIDATES', monthKey: election.monthKey, candidates: grouped };
  }

  async participation(token) {
    const { election, grant } = await this.authorize(token);
    return { code: 'PARTICIPATION', submitted: await this.store.hasParticipated(election.monthKey, grant.employeeId) };
  }

  async submit(token, body) {
    const ballot = validateBallot(body);
    if (!ballot) throw new ElectionError('INVALID_BALLOT');
    const { election, hash } = await this.authorize(token, { allowConsumed: true });
    const result = await this.store.submit({ monthKey: election.monthKey, grantHash: hash, ballot, now: this.now, stateFor: electionState });
    try {
      await this.store.audit(election.monthKey, 'SUBMIT', result.replayed ? 'REPLAYED' : 'ACCEPTED', this.now());
    } catch {
      // The committed ballot outcome is authoritative; audit availability must not reverse it.
    }
    return result;
  }

  summarize(counts) {
    return Object.fromEntries(CATEGORIES.map((category) => [
      category, { counts: counts[category], ...winnersFromCounts(counts[category]) },
    ]));
  }

  async finalize(monthKey) {
    if (!this.configured() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new ElectionError('SERVICE_UNAVAILABLE');
    const result = await this.store.finalize(monthKey, this.now, electionState, (counts) => this.summarize(counts));
    return { code: 'RESULTS_FINAL', monthKey, results: result.results };
  }
}

module.exports = { ElectionService };