import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityDeps, recordActivity, resetActivityState } from './activityService.ts';

const NOW = Date.UTC(2026, 9, 30, 4, 0); // 12:00 on 2026-10-30 in Manila
const DAY = 86400000;

function makeDeps(over: Partial<ActivityDeps> = {}) {
  const calls: string[] = [];
  const reports: string[] = [];
  const mem = new Map<string, string>();
  let now = NOW;
  const deps: ActivityDeps = {
    now: () => now,
    getUid: async () => 'member1',
    exists: async () => { calls.push('exists'); return false; },
    create: async (_uid, data) => { calls.push(`create ${data.firstDay} ${Object.keys(data.days)} ${data.source ?? '-'}`); },
    addDay: async (_uid, key) => { calls.push(`addDay ${key}`); },
    attributableSource: async () => 'tiktok',
    store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
    report: (code) => reports.push(code),
    ...over,
  };
  return { deps, calls, reports, mem, advance: (ms: number) => { now += ms; } };
}
const failWith = (code: string) => async () => { throw Object.assign(new Error('private detail should never be logged'), { code }); };

beforeEach(() => resetActivityState());

test('first open creates the record with the day, first day and source', async () => {
  const { deps, calls } = makeDeps();
  assert.equal(await recordActivity(deps), true);
  assert.deepEqual(calls, ['exists', 'create 20261030 d20261030 tiktok']);
});

test('a second open on the same day does nothing at all (no read, no write)', async () => {
  const { deps, calls } = makeDeps();
  await recordActivity(deps);
  calls.length = 0;
  assert.equal(await recordActivity(deps), false);
  assert.equal(await recordActivity(deps), false);
  assert.deepEqual(calls, []);
});

test('the next day writes the day directly, without reading the record first', async () => {
  const { deps, calls, advance } = makeDeps();
  await recordActivity(deps);
  calls.length = 0;
  advance(DAY);
  assert.equal(await recordActivity(deps), true);
  assert.deepEqual(calls, ['addDay d20261031']);
});

test('a missing record (new account on a device that remembered one) falls back to creating it', async () => {
  const { deps, calls, mem, advance } = makeDeps();
  await recordActivity(deps);
  advance(DAY);
  let first = true;
  const adding = deps.addDay;
  deps.addDay = async (uid, key) => { if (first) { first = false; throw Object.assign(new Error('x'), { code: 'not-found' }); } return adding(uid, key); };
  calls.length = 0;
  assert.equal(await recordActivity(deps), true);
  assert.deepEqual(calls, ['exists', 'create 20261031 d20261031 tiktok']);
  assert.equal(mem.get('queerspace_activity_created'), '1');
});

test('an existing record on a new device just adds the day', async () => {
  const { deps, calls } = makeDeps({ exists: async () => true });
  assert.equal(await recordActivity(deps), true);
  assert.deepEqual(calls, ['addDay d20261030']);
});

test('missing permissions (rules not published, or not a member yet) never throw, are reported once by code, and stop retrying', async () => {
  const { deps, reports, calls, advance } = makeDeps({ create: failWith('permission-denied') });
  assert.equal(await recordActivity(deps), false);
  advance(DAY);
  calls.length = 0;
  assert.equal(await recordActivity(deps), false); // sticky for this session: no further requests
  assert.deepEqual(calls, []);
  assert.deepEqual(reports, ['permission-denied']);
  assert.equal(JSON.stringify(reports).includes('private'), false);
});

test('an ineligible member is refused quietly and is not marked as counted', async () => {
  const { deps, mem } = makeDeps({ create: failWith('permission-denied') });
  assert.equal(await recordActivity(deps), false);
  assert.equal(mem.get('queerspace_activity_day'), undefined);
});

test('a network failure never throws, is not marked counted, and is retried after a pause', async () => {
  let fail = true;
  const { deps, calls, reports, mem, advance } = makeDeps({
    create: async () => { if (fail) throw Object.assign(new Error('offline'), { code: 'unavailable' }); },
  });
  assert.equal(await recordActivity(deps), false);
  assert.equal(mem.get('queerspace_activity_day'), undefined);
  calls.length = 0;
  assert.equal(await recordActivity(deps), false); // too soon: no request
  assert.deepEqual(calls, []);
  advance(6 * 60_000);
  fail = false;
  assert.equal(await recordActivity(deps), true);
  assert.deepEqual(reports, ['unavailable']);
});

test('sign-in problems, thrown errors of any kind and a missing user are all swallowed', async () => {
  assert.equal(await recordActivity(makeDeps({ getUid: async () => null }).deps), false);
  assert.equal(await recordActivity(makeDeps({ getUid: async () => { throw new Error('auth down'); } }).deps), false);
  assert.equal(await recordActivity(makeDeps({ store: { get: () => { throw new Error('storage blocked'); }, set: () => {} } }).deps), false);
  resetActivityState();
  const { deps, reports } = makeDeps({ create: async () => { throw 'a string, not an Error'; } });
  assert.equal(await recordActivity(deps), false);
  assert.deepEqual(reports, ['unknown']);
});

test('a failing reporter cannot break the app either', async () => {
  const { deps } = makeDeps({ create: failWith('unavailable'), report: () => { throw new Error('console gone'); } });
  assert.equal(await recordActivity(deps), false);
});
