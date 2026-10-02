const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { CATEGORIES, electionWindow, electionState, validateChoices, summarizeResults } = require('./contract');

const SEPTEMBER_HOLD = '2026-09';
const SETTLEMENT_MS = 15 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const MAX_BALLOTS = 10000;
const validMonth = (month) => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const validCount = (count) => Number.isSafeInteger(count) && count >= 0;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stable(value[key])]));
  return value;
}

class ResultError extends Error {
  constructor(code, retryable = false, status = 409) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function checkElection(election, month, binding) {
  if (!validMonth(month) || !election || election.schemaVersion !== 1 ||
      election.monthKey !== month || election.siteId !== binding.siteId ||
      election.dataEnvironment !== binding.environment || election.timeZone !== 'Europe/Zurich' ||
      !validCount(election.eligibleVoterCount) || election.eligibleVoterCount > MAX_BALLOTS) {
    throw new ResultError('ELECTION_DATA_INVALID');
  }
  // A mid-month anchor selects the desired month even at December/January rollover.
  const window = electionWindow(new Date(`${month}-15T12:00:00.000Z`), 'Europe/Zurich');
  if (election.opensAt !== window.opensAt || election.closesAt !== window.closesAt) {
    throw new ResultError('ELECTION_WINDOW_INVALID');
  }
  return election;
}

function assertSettled(election, now) {
  if (electionState(election, now) !== 'CLOSED_PENDING_RESULTS') throw new ResultError('RESULTS_SEALED');
  if (now.getTime() < Date.parse(election.closesAt) + SETTLEMENT_MS) {
    throw new ResultError('AWAITING_SETTLEMENT', true);
  }
}

function canonical(input, binding, month, now) {
  const election = checkElection(input.election, month, binding);
  assertSettled(election, now);
  if (!validCount(input.participationCount) || input.ballots.length > MAX_BALLOTS ||
      input.ballots.length !== input.participationCount ||
      input.participationCount > election.eligibleVoterCount) throw new ResultError('COUNT_MISMATCH');
  const counts = { CUISINE: Object.create(null), SERVICE: Object.create(null) };
  for (const ballot of input.ballots) {
    const choices = validateChoices(ballot.choices);
    if (ballot.schemaVersion !== 1 || !choices) throw new ResultError('BALLOT_INVALID');
    // Inspect commit timing only for closure integrity; never retain it in public data or diagnostics.
    if (!Number.isFinite(ballot.committedAtMs)) throw new ResultError('BALLOT_INVALID');
    if (ballot.committedAtMs >= Date.parse(election.closesAt)) throw new ResultError('LATE_BALLOT');
    for (const category of CATEGORIES) {
      const candidate = election.candidates?.[choices[category]];
      if (!candidate || candidate.employeeId !== choices[category] || candidate.votingGroup !== category ||
          typeof candidate.displayName !== 'string' || !candidate.displayName.trim() ||
          candidate.displayName.length > 200 ||
          (candidate.jobTitle !== undefined && (typeof candidate.jobTitle !== 'string' || candidate.jobTitle.length > 200))) {
        throw new ResultError('CANDIDATE_INVALID');
      }
      counts[category][candidate.employeeId] = (counts[category][candidate.employeeId] || 0) + 1;
    }
  }
  const results = summarizeResults(counts);
  if (input.final && (input.final.schemaVersion !== 1 || input.final.monthKey !== month ||
      !Number.isFinite(Date.parse(input.final.finalizedAt)) ||
      Date.parse(input.final.finalizedAt) < Date.parse(election.closesAt) ||
      !isDeepStrictEqual(JSON.parse(JSON.stringify(input.final.results)), JSON.parse(JSON.stringify(results))))) {
    throw new ResultError('RESULT_MISMATCH');
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(stable({
    month, opensAt: election.opensAt, closesAt: election.closesAt,
    eligible: election.eligibleVoterCount, results, candidates: election.candidates,
  }))).digest('hex');
  return { election, results, digest };
}

function verifyPublication(publication, proof, final, month, binding, now) {
  publicPublication(publication, binding, now);
  if (!final || publication.inputDigest !== proof.digest ||
      publication.finalizedAt !== final.finalizedAt) throw new ResultError('PUBLICATION_MISMATCH');
  const expected = buildPublication(proof, final, month, binding, new Date(publication.publishedAt));
  for (const category of CATEGORIES) {
    const identity = (entry) => entry.winners.map(({ employeeId, name, role }) => ({ employeeId, name, role }));
    if (JSON.stringify(identity(publication.categories[category])) !==
        JSON.stringify(identity(expected.categories[category]))) throw new ResultError('PUBLICATION_MISMATCH');
  }
}

function buildPublication(proof, final, month, binding, now, photos = {}) {
  return {
    schemaVersion: 1, monthKey: month, siteId: binding.siteId, dataEnvironment: binding.environment,
    timeZone: 'Europe/Zurich', opensAt: proof.election.opensAt, closesAt: proof.election.closesAt,
    finalizedAt: final.finalizedAt, publishedAt: now.toISOString(), inputDigest: proof.digest,
    categories: Object.fromEntries(CATEGORIES.map((category) => {
      const ids = proof.results[category].winnerEmployeeIds;
      return [category, {
        outcome: ids.length ? 'WINNERS' : 'NO_WINNER',
        winners: ids.map((id) => {
          const candidate = proof.election.candidates[id];
          return {
            employeeId: id, name: candidate.displayName.trim(), role: candidate.jobTitle || '',
            photoKey: photos[id]?.key || null, photoPath: photos[id]?.path || null,
          };
        }),
      }];
    })),
  };
}

function publicPublication(snapshot, binding, now = new Date()) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.siteId !== binding.siteId ||
      snapshot.dataEnvironment !== binding.environment || !validMonth(snapshot.monthKey) ||
      snapshot.timeZone !== 'Europe/Zurich' || !Number.isFinite(Date.parse(snapshot.publishedAt)) ||
      Date.parse(snapshot.publishedAt) > now.getTime() || !Number.isFinite(Date.parse(snapshot.finalizedAt)) ||
      Date.parse(snapshot.finalizedAt) < Date.parse(snapshot.closesAt) ||
      Date.parse(snapshot.publishedAt) < Date.parse(snapshot.finalizedAt) ||
      !/^[a-f0-9]{64}$/.test(snapshot.inputDigest || '')) throw new ResultError('PUBLICATION_INVALID');
  const window = electionWindow(new Date(`${snapshot.monthKey}-15T12:00:00Z`), 'Europe/Zurich');
  if (snapshot.opensAt !== window.opensAt || snapshot.closesAt !== window.closesAt ||
      Date.parse(snapshot.closesAt) > now.getTime()) throw new ResultError('PUBLICATION_INVALID');
  const categories = {};
  for (const category of CATEGORIES) {
    const entry = snapshot.categories?.[category];
    if (!entry || !Array.isArray(entry.winners) || entry.winners.length > MAX_BALLOTS ||
        entry.outcome !== (entry.winners.length ? 'WINNERS' : 'NO_WINNER')) throw new ResultError('PUBLICATION_INVALID');
    const winners = entry.winners.map((winner) => {
      if (typeof winner.name !== 'string' || !winner.name.trim() || winner.name.length > 200 ||
          typeof winner.role !== 'string' || winner.role.length > 200) throw new ResultError('PUBLICATION_INVALID');
      const safeKey = typeof winner.photoKey === 'string' &&
        new RegExp(`^${snapshot.monthKey}\\.[a-f0-9-]{36}$`).test(winner.photoKey);
      return { name: winner.name, role: winner.role,
        photoUrl: safeKey ? `/api/v1/public/winner-photos/${winner.photoKey}` : null };
    });
    categories[category] = { outcome: entry.outcome, winners };
  }
  return { code: 'PUBLISHED_RESULT', month: snapshot.monthKey, publishedAt: snapshot.publishedAt, categories };
}

module.exports = {
  SEPTEMBER_HOLD, SETTLEMENT_MS, LEASE_MS, MAX_BALLOTS, validMonth,
  ResultError, checkElection, assertSettled, canonical, buildPublication, publicPublication, verifyPublication,
};