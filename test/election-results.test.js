const assert = require('node:assert/strict');
const test = require('node:test');
const { electionWindow } = require('../election-engine/contract');
const { ResultError, publicPublication } = require('../election-engine/results-contract');
const { fixture } = require('./helpers/results-fixture');

test('automatic processing preserves canonical category ties and exposes no private result fields', async () => {
  const f = fixture();
  const result = await f.service.run();
  assert.equal(result.processed, 1);
  const publication = await f.service.latest();
  assert.equal(publication.month, '2026-10');
  assert.deepEqual(publication.categories.CUISINE.winners.map((winner) => winner.name), ['Chef One', 'Chef Two']);
  assert.equal(publication.categories.SERVICE.winners.length, 1);
  const json = JSON.stringify(publication);
  for (const secret of ['counts', 'highestCount', 'employeeId', 'verifier', 'comments', 'choices', 'ballot', 'fixture-secret']) {
    assert.equal(json.includes(secret), false, secret);
  }
  assert.equal(f.db.reads.some((read) => read[0] === 'query' && read[1].endsWith('/ballots') &&
    read[2].includes('comments')), false);
});

test('repeated finalization/publication is idempotent and public reads perform zero writes', async () => {
  const f = fixture();
  await f.service.processMonth(f.month);
  const finalBefore = structuredClone(f.db.docs.get(`${f.path}/resultInternals/final`));
  const published = await f.service.latest();
  const writes = f.db.writes.length;
  await f.service.processMonth(f.month, { recovery: true });
  for (let i = 0; i < 5; i += 1) assert.deepEqual(await f.service.latest(), published);
  assert.equal(f.db.writes.length, writes);
  assert.deepEqual(f.db.docs.get(`${f.path}/resultInternals/final`), finalBefore);
});

test('no publication exists before the pipeline; zero votes do not fabricate winners', async () => {
  const f = fixture({ votes: 0 });
  assert.equal(await f.service.latest(), null);
  await f.service.processMonth(f.month);
  const published = await f.service.latest();
  for (const category of ['CUISINE', 'SERVICE']) {
    assert.deepEqual(published.categories[category], { outcome: 'NO_WINNER', winners: [] });
  }
});

test('parallel scheduler deliveries produce one immutable result and publication', async () => {
  const f = fixture();
  await Promise.all([f.service.run(), f.service.run(), f.service.run()]);
  assert.equal(f.db.writes.filter(([kind, path]) => kind === 'create' && path.endsWith('/resultInternals/final')).length, 1);
  assert.equal(f.db.writes.filter(([kind, path]) => kind === 'create' && path.endsWith('/publication/public')).length, 1);
});

test('September recovery hold prevents every data access and write from recovery or worker processing', async () => {
  const f = fixture({ month: '2026-09' });
  const before = structuredClone([...f.db.docs]);
  await assert.rejects(f.service.processMonth('2026-09', { recovery: true }),
    (error) => error.code === 'SEPTEMBER_RECOVERY_HOLD');
  assert.equal(f.db.reads.length, 0);
  assert.equal(f.db.writes.length, 0);
  await f.service.run();
  assert.equal(f.db.writes.some(([, path]) => path.includes('/elections/2026-09/')), false);
  assert.deepEqual([...f.db.docs].filter(([path]) => path.includes('/elections/2026-09')), before);
  const monitor = await f.service.monitor();
  assert.equal(monitor.months[0].held, true);
  assert.equal(monitor.months[0].reason, 'SEPTEMBER_RECOVERY_HOLD');
  assert.equal(f.db.reads.some((read) => read[1].endsWith('/ballots')), false);
});

test('open, upcoming, and unsettled elections do not finalize or read ballot choices', async () => {
  for (const instant of ['2026-10-10T12:00:00Z', '2026-10-26T12:00:00Z', '2026-10-31T23:02:00Z']) {
    const f = fixture({ now: instant });
    await assert.rejects(f.service.processMonth(f.month),
      (error) => ['RESULTS_SEALED', 'AWAITING_SETTLEMENT'].includes(error.code));
    assert.equal(f.db.writes.length, 0);
    assert.equal(f.db.reads.some((read) => read[1].endsWith('/ballots')), false);
  }
});

test('integrity failures are visible, do not publish, and manual recovery cannot bypass them', async () => {
  for (const defect of ['mismatch', 'choice', 'category', 'late', 'corrupt', 'result']) {
    const f = fixture();
    if (defect === 'mismatch') f.db.docs.delete(`${f.path}/participation/fixture-0`);
    if (defect === 'choice') f.db.docs.get(`${f.path}/ballots/random-0`).choices.CUISINE = 'unknown-candidate';
    if (defect === 'category') f.db.docs.get(`${f.path}/ballots/random-0`).choices.CUISINE = 'service-one';
    if (defect === 'late') f.db.times.set(`${f.path}/ballots/random-0`, Date.parse(f.election.closesAt));
    if (defect === 'corrupt') f.db.docs.get(`${f.path}/ballots/random-0`).schemaVersion = 9;
    if (defect === 'result') f.db.seed(`${f.path}/resultInternals/final`, {
      schemaVersion: 1, monthKey: f.month, finalizedAt: f.now().toISOString(), results: {},
    });
    await assert.rejects(f.service.processMonth(f.month), ResultError);
    assert.equal(await f.service.latest(), null);
    const op = await f.store.readOperation(f.month);
    assert.equal(op.state, 'RESULT_REQUIRES_VERIFICATION');
    await assert.rejects(f.service.processMonth(f.month, { recovery: true }), ResultError);
    assert.equal(await f.service.latest(), null);
    assert.equal(JSON.stringify((await f.service.monitor()).months).includes('choices'), false);
  }
});

test('crash after finalization resumes using the same final result and preserves attempt history', async () => {
  const f = fixture();
  const publish = f.store.publish.bind(f.store);
  f.store.publish = async () => { throw new Error('simulated network interruption'); };
  await assert.rejects(f.service.processMonth(f.month), (error) => error.code === 'STORAGE_UNAVAILABLE');
  const final = structuredClone(f.db.docs.get(`${f.path}/resultInternals/final`));
  assert.equal(await f.service.latest(), null);
  f.store.publish = publish;
  await f.service.processMonth(f.month, { recovery: true });
  assert.deepEqual(f.db.docs.get(`${f.path}/resultInternals/final`), final);
  assert.equal((await f.store.readOperation(f.month)).attempts, 2);
});

test('expired worker leases recover, active leases prevent duplicate work, and retry backoff is respected', async () => {
  const f = fixture();
  f.db.seed(`${f.path}/resultOperations/state`, { state: 'FINALIZING', token: 'crashed', leaseUntilMs: f.now().getTime() + 1000 });
  assert.equal((await f.service.processMonth(f.month)).state, 'FINALIZING');
  assert.equal(await f.service.latest(), null);
  f.advance('2026-11-01T01:01:00Z');
  await f.service.processMonth(f.month);
  assert.equal((await f.service.latest()).month, f.month);
  const retry = fixture();
  retry.db.seed(`${retry.path}/resultOperations/state`, {
    state: 'VOTING_CLOSED', reason: 'STORAGE_UNAVAILABLE', retryAt: '2026-11-01T03:00:00Z',
  });
  await retry.service.processMonth(retry.month);
  assert.equal(retry.db.writes.length, 0);
});

test('source changes after validation prevent publication and require verification', async () => {
  const f = fixture();
  const finalize = f.store.finalize.bind(f.store);
  f.store.finalize = async (...args) => {
    f.db.docs.get(`${f.path}/ballots/random-0`).choices.CUISINE = 'chef-two';
    return finalize(...args);
  };
  await assert.rejects(f.service.processMonth(f.month), (error) => error.code === 'SOURCE_CHANGED');
  assert.equal(await f.service.latest(), null);
});

test('December to January and September to October rollover never hide a published result', async () => {
  const december = fixture({ month: '2026-12', now: '2027-01-01T01:00:00Z' });
  await december.service.processMonth(december.month);
  december.advance('2027-01-26T12:00:00Z');
  assert.equal(electionWindow(december.now(), 'Europe/Zurich').monthKey, '2027-01');
  assert.equal((await december.service.latest()).month, '2026-12');
  // September remains untouched. An earlier fixture publication proves visibility across this rollover.
  const august = fixture({ month: '2026-08', now: '2026-09-01T01:00:00Z' });
  await august.service.processMonth(august.month);
  august.advance('2026-09-30T21:59:59Z');
  assert.equal(electionWindow(august.now(), 'Europe/Zurich').monthKey, '2026-09');
  august.advance('2026-09-30T22:00:00Z');
  assert.equal(electionWindow(august.now(), 'Europe/Zurich').monthKey, '2026-10');
  assert.equal((await august.service.latest()).month, '2026-08');
});

test('older late publication does not replace a newer latest publication', async () => {
  const f = fixture();
  await f.service.processMonth(f.month);
  const old = fixture({ month: '2026-08' });
  for (const [path, value] of old.db.docs) f.db.seed(path, value, old.db.times.get(path));
  await f.service.processMonth('2026-08');
  assert.equal((await f.service.latest()).month, '2026-10');
});

test('missing/inactive current directory and missing portraits do not change the election snapshot winners', async () => {
  const f = fixture();
  // There is deliberately no current directory dependency in the result service.
  await f.service.processMonth(f.month);
  const dto = await f.service.latest();
  assert.equal(dto.categories.CUISINE.winners[0].name, 'Chef One');
  assert.equal(dto.categories.CUISINE.winners[0].photoUrl, null);
  const snapshot = await f.store.latest();
  snapshot.publishedAt = '2026-10-01T00:00:00Z';
  assert.throws(() => publicPublication(snapshot, f.binding, f.now()), ResultError);
});

test('disabled services and workers have no data reads or writes', async () => {
  const f = fixture({ enabled: false, automationEnabled: false });
  await assert.rejects(f.service.run(), (error) => error.code === 'RESULTS_UNAVAILABLE');
  await assert.rejects(f.service.processMonth(f.month), (error) => error.code === 'RESULTS_UNAVAILABLE');
  assert.equal((await f.service.monitor()).storageStatus, 'DISABLED');
  assert.equal(f.db.reads.length, 0);
  assert.equal(f.db.writes.length, 0);
});

test('unexpected processing states are blocked rather than overwritten or published', async () => {
  const f = fixture();
  f.db.seed(`${f.path}/resultOperations/state`, { state: 'FORCE_PUBLISH_UNKNOWN' });
  const view = await f.service.processMonth(f.month);
  assert.equal(view.state, 'RESULT_REQUIRES_VERIFICATION');
  assert.equal(view.reason, 'UNEXPECTED_STATE');
  assert.equal(await f.service.latest(), null);
});

test('inconsistent published state is blocked without modifying its immutable snapshot', async () => {
  const f = fixture();
  await f.service.processMonth(f.month);
  const snapshotBefore = structuredClone(f.db.docs.get(`${f.path}/publication/public`));
  f.db.docs.get(`${f.path}/ballots/random-0`).choices.CUISINE = 'chef-two';
  await assert.rejects(f.service.processMonth(f.month), (error) => error.code === 'RESULT_MISMATCH');
  assert.deepEqual(f.db.docs.get(`${f.path}/publication/public`), snapshotBefore);
  await assert.rejects(f.service.latest(), (error) => error.code === 'PUBLICATION_INVALID');
});

test('fingerprinting is stable when equivalent map fields are reordered', async () => {
  const f = fixture();
  await f.service.processMonth(f.month);
  f.db.docs.get(f.path).candidates = Object.fromEntries(Object.entries(f.election.candidates).reverse());
  await f.service.processMonth(f.month);
  assert.equal((await f.service.latest()).month, f.month);
});

test('missed scheduled runs catch up existing closed elections without creating current/future elections', async () => {
  const f = fixture({ automationEnabled: false });
  const initialKeys = [...f.db.docs.keys()].filter((path) => /\/elections\/[^/]+$/.test(path));
  f.advance('2026-12-28T12:00:00Z');
  f.service.automationEnabled = true;
  await f.service.run();
  assert.equal((await f.service.latest()).month, '2026-10');
  assert.deepEqual([...f.db.docs.keys()].filter((path) => /\/elections\/[^/]+$/.test(path)), initialKeys);
});

test('a failed next-month publication preserves the previous published winners and independent voting state', async () => {
  const f = fixture();
  await f.service.processMonth(f.month);
  const november = fixture({ month: '2026-11', now: '2026-12-01T01:00:00Z' });
  for (const [path, data] of november.db.docs) f.db.seed(path, data, november.db.times.get(path));
  f.advance('2026-11-26T12:00:00Z');
  const view = await f.service.monitor();
  assert.equal(view.months.find((month) => month.month === '2026-11').state, 'VOTING_OPEN');
  assert.equal((await f.service.latest()).month, '2026-10');
  f.advance('2026-12-01T01:00:00Z');
  f.db.docs.delete(`${november.path}/participation/fixture-0`);
  await assert.rejects(f.service.processMonth('2026-11'));
  assert.equal((await f.service.latest()).month, '2026-10');
});

test('a crash after publication commit cannot undo or duplicate the published snapshot', async () => {
  const f = fixture();
  const publish = f.store.publish.bind(f.store);
  f.store.publish = async (...args) => { await publish(...args); throw new Error('response lost'); };
  await assert.rejects(f.service.processMonth(f.month), (error) => error.code === 'STORAGE_UNAVAILABLE');
  const published = await f.service.latest();
  assert.equal((await f.store.readOperation(f.month)).state, 'PUBLISHED');
  f.store.publish = publish;
  const writes = f.db.writes.length;
  await f.service.processMonth(f.month, { recovery: true });
  assert.deepEqual(await f.service.latest(), published);
  assert.equal(f.db.writes.length, writes);
});

test('September recovery flag alone cannot release hold or load September choices', async () => {
  const f = fixture({ month: '2026-09' });
  f.service.septemberRecoveryApproved = true;
  // Non-production fixture cannot release hold at all.
  await assert.rejects(f.service.processMonth('2026-09'), (error) => error.code === 'SEPTEMBER_RECOVERY_HOLD');
  assert.equal(f.db.reads.length, 0);
  // Even with a production binding, absent authorization permits only its record read.
  f.service.binding = { ...f.binding, environment: 'production' };
  await assert.rejects(f.service.processMonth('2026-09'), (error) => error.code === 'SEPTEMBER_RECOVERY_HOLD');
  assert.equal(f.db.reads.some((read) => read[1].includes('/elections/2026-09')), false);
  assert.equal(f.db.writes.length, 0);
});