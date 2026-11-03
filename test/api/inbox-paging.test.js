import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PAIR_LEGACY_LIMIT,
  PAIR_PAGE_DEFAULT,
  PAIR_PAGE_MAX,
  PARTNER_CACHE_MAX,
  PARTNER_CACHE_MS,
  createPartnerCache,
  decodeCursor,
  encodeCursor,
  parsePageLimit,
  partnerSummaries,
  shapePair,
} from '../../api/_inbox.js';

const read = (file) => fs.readFileSync(file, 'utf8');

test('a page size is clamped, and no page size means the full list as before', () => {
  assert.equal(parsePageLimit(undefined), null);
  assert.equal(parsePageLimit(null), null);
  assert.equal(parsePageLimit(''), null);
  assert.equal(parsePageLimit('20'), 20);
  assert.equal(parsePageLimit(5), 5);
  assert.equal(parsePageLimit('999'), PAIR_PAGE_MAX, 'a request can never ask for more than the cap');
  for (const odd of ['0', '-3', '2.5', 'abc', NaN]) assert.equal(parsePageLimit(odd), PAIR_PAGE_DEFAULT, String(odd));
  assert.equal(PAIR_PAGE_DEFAULT, 20);
  assert.equal(PAIR_LEGACY_LIMIT, 100);
});

test('a page cursor round-trips, and anything else is refused', () => {
  const cursor = encodeCursor(1_800_000_000_000, 'pair-abc12345');
  assert.deepEqual(decodeCursor(cursor), { millis: 1_800_000_000_000, id: 'pair-abc12345' });
  for (const bad of [undefined, null, '', 'nodot', '.id12345678', 'abc.pair-abc12345', '-5.pair-abc12345', '12.short', '12.bad id with spaces', '12.../../etc', 5, {}]) assert.equal(decodeCursor(bad), null, String(bad));
});

test('the partner memory keeps a summary for a minute, holds a bounded number, and can be emptied', () => {
  let t = 1000;
  const cache = createPartnerCache({ ttlMs: PARTNER_CACHE_MS, max: 3, now: () => t });
  cache.set('a', { displayName: 'A', avatar: null });
  assert.deepEqual(cache.get('a'), { displayName: 'A', avatar: null });
  t += PARTNER_CACHE_MS - 1;
  assert.ok(cache.get('a'), 'still there just before a minute');
  t += 1;
  assert.equal(cache.get('a'), undefined, 'gone at a minute');
  for (const id of ['b', 'c', 'd', 'e']) cache.set(id, { displayName: id, avatar: null });
  assert.equal(cache.size, 3, 'bounded');
  assert.equal(cache.get('b'), undefined, 'the oldest went first');
  assert.ok(cache.get('e'));
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(PARTNER_CACHE_MAX, 500);
  assert.equal(PARTNER_CACHE_MS, 60_000);
});

const fakeProfileDb = (profiles) => {
  const stats = { batches: 0, docs: 0 };
  return {
    stats,
    doc: (path) => ({ path }),
    getAll: async (...refs) => { stats.batches += 1; stats.docs += refs.length; return refs.map((ref) => ({ exists: profiles[ref.path] !== undefined, data: () => profiles[ref.path] })); },
  };
};
const summarize = (profile) => ({ displayName: profile?.displayName ?? null, avatar: profile?.avatar ?? null });

test('other members\' summaries are read in one batch, only once while remembered, and never twice for the same member', async () => {
  const db = fakeProfileDb({ 'users/a/public/profile': { displayName: 'Ana', avatar: 'cat.1.2' }, 'users/b/public/profile': { displayName: 'Bea' } });
  const cache = createPartnerCache();
  const first = await partnerSummaries(db, ['a', 'b', 'a', 'c', undefined], summarize, cache);
  assert.deepEqual([db.stats.batches, db.stats.docs], [1, 3], 'one batched read for three distinct members');
  assert.deepEqual(first.get('a'), { displayName: 'Ana', avatar: 'cat.1.2' });
  assert.deepEqual(first.get('c'), { displayName: null, avatar: null }, 'a member with no profile still has a safe answer');
  const second = await partnerSummaries(db, ['a', 'b', 'c'], summarize, cache);
  assert.deepEqual([db.stats.batches, db.stats.docs], [1, 3], 'the second time nothing is read');
  assert.deepEqual(second.get('b'), { displayName: 'Bea', avatar: null });
  const third = await partnerSummaries(db, ['a', 'd'], summarize, cache);
  assert.deepEqual([db.stats.batches, db.stats.docs], [2, 4], 'only the new member is read');
  assert.ok(third.has('d'));
  assert.deepEqual([...(await partnerSummaries(db, [], summarize, cache)).keys()], []);
});

test('only the pseudonym and avatar are ever remembered, never anything else on the profile', async () => {
  const db = fakeProfileDb({ 'users/a/public/profile': { displayName: 'Ana', avatar: 'cat.1.2', aboutMe: 'private-ish', region: 'Somewhere', birthDate: 'nope' } });
  const cache = createPartnerCache();
  const map = await partnerSummaries(db, ['a'], (p) => ({ displayName: p.displayName, avatar: p.avatar }), cache);
  const json = JSON.stringify([...map.values()]) + JSON.stringify(cache.get('a'));
  for (const secret of ['private-ish', 'Somewhere', 'birthDate', 'nope']) assert.equal(json.includes(secret), false, secret);
});

test('a connection is shaped without the other member\'s details, and the partner id is the other participant', () => {
  const data = { participants: ['u1', 'u2'], status: 'active', invitationId: 'inv1', createdAt: { toDate: () => new Date('2026-11-03T10:00:00Z') } };
  const shaped = shapePair({ id: 'pair-1', data }, 'u1');
  assert.deepEqual([shaped.partnerId, shaped.id, shaped.invitationId, shaped.status, shaped.createdAt, shaped.endedAt, shaped.endedBy], ['u2', 'pair-1', 'inv1', 'active', '2026-11-03T10:00:00.000Z', null, null]);
  assert.equal('partner' in shaped, false);
});

test('the API stays compatible: no paging asked for means the same full list, and the new parameters are opt-in', () => {
  const signals = read('api/signals.js');
  assert.match(signals, /else \{\s*found = await listPairsLegacy\(db, uid\);\s*\}/, 'the old behaviour is the default');
  assert.match(signals, /if \(pairId\) \{\s*const one = await getOnePair\(db, uid, pairId\);/);
  assert.match(signals, /pageLimit !== null/);
  assert.match(signals, /\(nextCursor !== undefined \? \{ nextCursor \} : \{\}\)/, 'the cursor appears only on a paged answer');
  assert.match(signals, /=== 'pending'/, 'pending-only invitations are opt-in');
  assert.match(signals, /const partnerCache = createPartnerCache\(\);/);
  assert.doesNotMatch(signals, /\bage\b|birthDate|birthday/i, 'Signals still never mentions age');
  const indexes = JSON.parse(read('firestore.indexes.json')).indexes.filter((i) => i.collectionGroup === 'signalsPairs');
  assert.deepEqual(indexes.map((i) => i.fields.map((f) => `${f.fieldPath}:${f.arrayConfig ?? f.order}`)), [['participants:CONTAINS', 'createdAt:DESCENDING']]);
});
