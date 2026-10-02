const { electionWindow } = require('../../election-engine/contract');
const { FirestoreResultsStore } = require('../../election-engine/results-store');
const { ElectionResultsService } = require('../../election-engine/results-service');

const copy = (value) => value === undefined ? undefined : structuredClone(value);

class MemoryFirestore {
  constructor() {
    this.docs = new Map();
    this.times = new Map();
    this.reads = [];
    this.writes = [];
    this.queue = Promise.resolve();
    this.projectId = 'fixture-project';
    this.databaseId = '(default)';
  }
  collection(path) { return new MemoryQuery(this, path); }
  seed(path, value, time = 0) { this.docs.set(path, copy(value)); this.times.set(path, time); }
  snapshot(ref, fields) {
    const value = this.docs.get(ref.path);
    return {
      exists: value !== undefined, id: ref.path.split('/').pop(), ref,
      createTime: { toMillis: () => this.times.get(ref.path) || 0 },
      data: () => value === undefined ? undefined : fields
        ? Object.fromEntries(fields.filter((key) => Object.hasOwn(value, key)).map((key) => [key, copy(value[key])]))
        : copy(value),
    };
  }
  async getAll(ref, options) {
    this.reads.push(['projection', ref.path, options?.fieldMask]);
    return [this.snapshot(ref, options?.fieldMask)];
  }
  async runTransaction(callback, options = {}) {
    const execute = async () => {
      const pending = [];
      const tx = {
        get: (query) => query.get(),
        getAll: (...args) => this.getAll(...args),
      };
      for (const method of ['set', 'create', 'update', 'delete']) {
        tx[method] = (ref, value, opts) => {
          if (options.readOnly) throw new Error('read-only transaction attempted a write');
          pending.push([method, ref, copy(value), opts]);
        };
      }
      const result = await callback(tx);
      for (const [method, ref, value, opts] of pending) {
        if (method === 'create' && this.docs.has(ref.path)) throw new Error('already exists');
        if (method === 'delete') this.docs.delete(ref.path);
        else this.docs.set(ref.path, opts?.merge || method === 'update'
          ? { ...this.docs.get(ref.path), ...value } : value);
        this.writes.push([method, ref.path]);
      }
      return result;
    };
    const result = this.queue.then(execute);
    this.queue = result.catch(() => {});
    return result;
  }
}

class MemoryRef {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new MemoryQuery(this.db, `${this.path}/${name}`); }
  async get() {
    this.db.reads.push(['doc', this.path]);
    return this.db.snapshot(this);
  }
  async set(value, opts) {
    this.db.seed(this.path, opts?.merge ? { ...this.db.docs.get(this.path), ...value } : value);
    this.db.writes.push(['set', this.path]);
  }
}

class MemoryQuery {
  constructor(db, path, opts = {}) { Object.assign(this, { db, path, opts }); }
  doc(id) { return new MemoryRef(this.db, `${this.path}/${id}`); }
  with(opts) { return new MemoryQuery(this.db, this.path, { ...this.opts, ...opts }); }
  orderBy(_field, direction = 'asc') { return this.with({ direction }); }
  startAfter(cursor) { return this.with({ cursor }); }
  limit(limit) { return this.with({ limit }); }
  select(...fields) { return this.with({ fields }); }
  async get() {
    this.db.reads.push(['query', this.path, this.opts.fields]);
    let keys = [...this.db.docs.keys()].filter((path) =>
      path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/')).sort();
    if (this.opts.direction === 'desc') keys.reverse();
    if (this.opts.cursor) keys = keys.filter((path) => this.opts.direction === 'desc'
      ? path.split('/').pop() < this.opts.cursor : path.split('/').pop() > this.opts.cursor);
    keys = keys.slice(0, this.opts.limit || Infinity);
    return { docs: keys.map((path) => this.db.snapshot(new MemoryRef(this.db, path), this.opts.fields)) };
  }
  count() {
    return { get: async () => {
      this.db.reads.push(['aggregate', this.path]);
      const snapshot = await this.get();
      return { data: () => ({ count: snapshot.docs.length }) };
    } };
  }
}

function fixture({ month = '2026-10', now: instant = '2026-11-01T01:00:00.000Z', votes = 2,
  enabled = true, automationEnabled = true } = {}) {
  const db = new MemoryFirestore();
  const binding = { projectId: 'fixture-project', databaseId: '(default)', siteId: 'molard', environment: 'development' };
  let current = new Date(instant);
  const now = () => new Date(current);
  const window = electionWindow(new Date(`${month}-15T12:00:00.000Z`), 'Europe/Zurich');
  const path = `electionSites/molard/dataEnvironments/development/elections/${month}`;
  const election = {
    schemaVersion: 1, siteId: 'molard', dataEnvironment: 'development',
    monthKey: month, timeZone: 'Europe/Zurich', opensAt: window.opensAt, closesAt: window.closesAt,
    eligibleVoterCount: 4, voters: { 'fixture-secret': { verifier: 'NEVER_READ' } },
    candidates: {
      'chef-one': { employeeId: 'chef-one', displayName: 'Chef One', jobTitle: 'Chef', votingGroup: 'CUISINE' },
      'chef-two': { employeeId: 'chef-two', displayName: 'Chef Two', jobTitle: '', votingGroup: 'CUISINE' },
      'service-one': { employeeId: 'service-one', displayName: 'Service One', jobTitle: 'Service', votingGroup: 'SERVICE' },
    },
  };
  db.seed(path, election);
  for (let i = 0; i < votes; i += 1) {
    db.seed(`${path}/ballots/random-${i}`, {
      schemaVersion: 1, choices: { CUISINE: i % 2 ? 'chef-two' : 'chef-one', SERVICE: 'service-one' },
      comments: { CUISINE: 'PRIVATE_NEVER_READ', SERVICE: 'PRIVATE_NEVER_READ' },
    }, Date.parse(window.closesAt) - 60000);
    db.seed(`${path}/participation/fixture-${i}`, { status: 'SUBMITTED' });
  }
  const store = new FirestoreResultsStore(db, binding);
  const service = new ElectionResultsService({ store, binding, enabled, automationEnabled, now });
  return { db, store, service, month, path, election, binding, now,
    advance: (value) => { current = new Date(value); } };
}

module.exports = { fixture, MemoryFirestore };