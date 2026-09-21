const crypto = require('node:crypto');

const CATEGORIES = Object.freeze(['CUISINE', 'SERVICE']);
const COMMENT_MIN = 10;
const COMMENT_MAX = 1000;
const DEFAULT_GRANT_TTL_MS = 10 * 60 * 1000;
const STATES = Object.freeze({
  UPCOMING: 'UPCOMING',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED_PENDING_RESULTS',
});

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date());
    return typeof timeZone === 'string' && timeZone.length <= 100;
  } catch {
    return false;
  }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

function localMidnightUtc(year, month, day, timeZone) {
  let guess = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 4; i += 1) {
    const actual = localParts(new Date(guess), timeZone);
    const desiredAsUtc = Date.UTC(year, month - 1, day);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = desiredAsUtc - actualAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  const result = new Date(guess);
  const check = localParts(result, timeZone);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== 0 || check.minute !== 0) {
    throw new Error('TIMEZONE_BOUNDARY_UNAVAILABLE');
  }
  return result;
}

function electionWindow(now, timeZone) {
  if (!validTimeZone(timeZone)) throw new Error('INVALID_TIMEZONE');
  const local = localParts(now, timeZone);
  const monthKey = `${local.year}-${String(local.month).padStart(2, '0')}`;
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  return {
    monthKey,
    opensAt: localMidnightUtc(local.year, local.month, 25, timeZone).toISOString(),
    closesAt: localMidnightUtc(nextYear, nextMonth, 1, timeZone).toISOString(),
  };
}

function electionState(election, now) {
  const at = now.getTime();
  if (at < Date.parse(election.opensAt)) return STATES.UPCOMING;
  if (at < Date.parse(election.closesAt)) return STATES.OPEN;
  return STATES.CLOSED;
}

function validateBallot(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join('|') !== 'choices|comments') return null;
  if (!body.choices || !body.comments ||
      Object.keys(body.choices).sort().join('|') !== CATEGORIES.slice().sort().join('|') ||
      Object.keys(body.comments).sort().join('|') !== CATEGORIES.slice().sort().join('|')) return null;
  const choices = {};
  const comments = {};
  for (const category of CATEGORIES) {
    if (typeof body.choices[category] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(body.choices[category])) return null;
    if (typeof body.comments[category] !== 'string') return null;
    const comment = body.comments[category].trim();
    if (comment.length < COMMENT_MIN || comment.length > COMMENT_MAX) return null;
    choices[category] = body.choices[category];
    comments[category] = comment;
  }
  return { choices, comments };
}

function safeCandidate(employee) {
  return {
    employeeId: employee.employeeId,
    displayName: employee.displayName,
    jobTitle: employee.jobTitle,
    photoUrl: employee.photoUrl,
  };
}

function winnersFromCounts(counts) {
  const entries = Object.entries(counts || {});
  const highestCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);
  return {
    highestCount,
    winnerEmployeeIds: entries.filter(([, count]) => count === highestCount && highestCount > 0).map(([id]) => id).sort(),
  };
}

function tokenHash(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('base64url');
}

module.exports = {
  CATEGORIES, COMMENT_MIN, COMMENT_MAX, DEFAULT_GRANT_TTL_MS, STATES,
  electionState, electionWindow, safeCandidate, tokenHash, validTimeZone,
  validateBallot, winnersFromCounts,
};