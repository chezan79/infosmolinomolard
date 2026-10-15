const { checkElection, publicPublication, validMonth, ResultError } = require('./results-contract');

const ELECTION_FIELDS = [
  'schemaVersion', 'siteId', 'dataEnvironment', 'monthKey', 'timeZone',
  'opensAt', 'closesAt', 'eligibleVoterCount', 'voters',
];
const PUBLICATION_FIELDS = [
  'schemaVersion', 'siteId', 'dataEnvironment', 'monthKey', 'timeZone',
  'opensAt', 'closesAt', 'finalizedAt', 'publishedAt', 'inputDigest', 'categories',
];
const GROUPS = new Set(['CUISINE', 'SERVICE']);
const DEPARTMENTS = { Cuisine: 'CUISINE', Pizzeria: 'CUISINE', Plonge: 'CUISINE', Service: 'SERVICE' };

class HistoryError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function unavailableRoster(status = 'UNVERIFIABLE') {
  return { status, voters: null };
}

function normalizeName(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}

function resolveHistoricalRoster(election, participationDocs, submitted) {
  const voters = election.voters;
  const eligible = election.eligibleVoterCount;
  if (!voters || typeof voters !== 'object' || Array.isArray(voters) ||
      Object.keys(voters).length !== eligible || !Array.isArray(participationDocs)) return unavailableRoster();
  if (participationDocs.length !== submitted) return unavailableRoster('INCONSISTENT');

  const participatingIds = participationDocs.map((doc) => doc.id);
  const participating = new Set(participatingIds);
  if (participating.size !== participatingIds.length) return unavailableRoster('INCONSISTENT');

  const rows = [];
  const names = new Set();
  for (const [employeeId, voter] of Object.entries(voters)) {
    if (!voter || voter.employeeId !== employeeId || !GROUPS.has(voter.votingGroup)) {
      return unavailableRoster();
    }
    const name = typeof voter.displayName === 'string' ? voter.displayName.trim() : '';
    const department = voter.department;
    if (!name || name.length > 160 || typeof department !== 'string' ||
        DEPARTMENTS[department] !== voter.votingGroup) return unavailableRoster();
    const normalized = normalizeName(name);
    if (names.has(normalized)) return unavailableRoster();
    names.add(normalized);
    rows.push({ name, department, hasVoted: participating.has(employeeId) });
  }

  if (participatingIds.some((id) => !Object.hasOwn(voters, id))) {
    return unavailableRoster('INCONSISTENT');
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return { status: 'VERIFIABLE', voters: rows };
}

function createElectionHistoryService({ db, binding, now = () => new Date() }) {
  return {
    async read(requestedMonth) {
      if (!db || !binding?.siteId || !['development', 'production'].includes(binding.environment)) {
        throw new HistoryError('HISTORY_UNAVAILABLE');
      }
      if (requestedMonth !== undefined && !validMonth(requestedMonth)) {
        throw new HistoryError('INVALID_MONTH', 400);
      }

      const elections = db.collection('electionSites').doc(binding.siteId)
        .collection('dataEnvironments').doc(binding.environment).collection('elections');
      const listed = await elections.select('monthKey').get();
      const availableMonths = [...new Set((listed.docs || []).flatMap((doc) => {
        const monthKey = doc.data()?.monthKey;
        return validMonth(doc.id) && monthKey === doc.id ? [monthKey] : [];
      }))].sort((a, b) => b.localeCompare(a));

      if (!availableMonths.length) {
        if (requestedMonth) throw new HistoryError('ELECTION_NOT_FOUND', 404);
        return { availableMonths: [], month: null, electionStatus: 'NO_ELECTIONS' };
      }
      const month = requestedMonth || availableMonths[0];
      if (!availableMonths.includes(month)) throw new HistoryError('ELECTION_NOT_FOUND', 404);

      const electionRef = elections.doc(month);
      const [electionSnapshot] = await db.getAll(electionRef, { fieldMask: ELECTION_FIELDS });
      if (!electionSnapshot.exists) throw new HistoryError('ELECTION_NOT_FOUND', 404);
      const election = electionSnapshot.data();
      try {
        checkElection(election, month, binding);
      } catch (error) {
        if (error instanceof ResultError) throw new HistoryError('HISTORY_DATA_INVALID');
        throw error;
      }

      let submitted;
      let participationDocs = null;
      try {
        const countSnapshot = await electionRef.collection('participation').count().get();
        submitted = countSnapshot.data().count;
      } catch {
        throw new HistoryError('HISTORY_UNAVAILABLE');
      }
      if (!Number.isSafeInteger(submitted) || submitted < 0) {
        throw new HistoryError('HISTORY_UNAVAILABLE');
      }

      try {
        participationDocs = (await electionRef.collection('participation').select().get()).docs;
      } catch { /* Counts remain useful when the historical roster cannot be read. */ }
      let individual = resolveHistoricalRoster(election, participationDocs, submitted);
      if (submitted > election.eligibleVoterCount) individual = unavailableRoster('INCONSISTENT');
      const result = await this.readPublishedResults(electionRef, month);
      const eligible = election.eligibleVoterCount;

      return {
        availableMonths,
        month,
        electionStatus: submitted > eligible || individual.status === 'INCONSISTENT' ? 'INCONSISTENT' : 'AVAILABLE',
        participation: {
          eligible,
          submitted,
          notSubmitted: Math.max(eligible - submitted, 0),
          percentage: eligible ? Math.round((submitted / eligible) * 10000) / 100 : 0,
        },
        roster: individual,
        results: result,
      };
    },

    async readPublishedResults(electionRef, month) {
      const operationRef = electionRef.collection('resultOperations').doc('state');
      const [operationSnapshot] = await db.getAll(operationRef, { fieldMask: ['state', 'publishedAt'] });
      const operation = operationSnapshot.exists ? operationSnapshot.data() : null;
      if (operation?.state !== 'PUBLISHED') return { status: 'NOT_PUBLISHED', categories: null };

      const publicationRef = electionRef.collection('publication').doc('public');
      const [publicationSnapshot] = await db.getAll(publicationRef, { fieldMask: PUBLICATION_FIELDS });
      if (!publicationSnapshot.exists) return { status: 'UNVERIFIABLE', categories: null };
      try {
        const publication = publicationSnapshot.data();
        const safe = publicPublication(publication, binding, now());
        if (safe.month !== month || operation.publishedAt !== publication.publishedAt) {
          return { status: 'UNVERIFIABLE', categories: null };
        }
        return {
          status: 'PUBLISHED',
          publishedAt: safe.publishedAt,
          categories: Object.fromEntries(['CUISINE', 'SERVICE'].map((category) => [
            category,
            {
              outcome: safe.categories[category].outcome,
              winners: safe.categories[category].winners.map(({ name, role }) => ({ name, role })),
            },
          ])),
        };
      } catch {
        return { status: 'UNVERIFIABLE', categories: null };
      }
    },
  };
}

module.exports = { createElectionHistoryService, resolveHistoricalRoster, HistoryError };
