import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INBOX_CACHE_MS,
  LIST_REQUEST_TIMEOUT_MS,
  PAIR_PAGE_SIZE,
  appendPage,
  inboxCacheKey,
  inboxFreshness,
  mergeFirstPage,
} from './signalsList.ts';
import { getShared, readInboxCache, requestCounts, writeInboxCache, clearInboxCache, fetchPairsPage, ListRequestError } from '../services/signalsListService.ts';

const pair = (n: number, createdAt = `2026-11-${String(30 - n).padStart(2, '0')}T10:00:00.000Z`) => ({ id: `pair-${String(n).padStart(3, '0')}`, createdAt });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => pair(from + i));

test('the inbox asks for twenty connections at a time', () => {
  assert.equal(PAIR_PAGE_SIZE, 20);
});

test('a refreshed first page replaces what it contains and keeps the pages scrolled to below it', () => {
  const current = range(1, 40);
  const merged = mergeFirstPage(current, range(1, 20));
  assert.deepEqual(merged.map((p) => p.id), range(1, 40).map((p) => p.id), 'nothing is lost or repeated');
});

test('a connection that was on the first page and is gone from the fresh one is dropped, not kept from the old list', () => {
  const current = range(1, 40);
  const fresh = range(1, 20).filter((p) => p.id !== 'pair-005');
  const merged = mergeFirstPage(current, fresh);
  assert.equal(merged.some((p) => p.id === 'pair-005'), false);
  assert.equal(merged.length, 39);
  assert.deepEqual(merged.slice(0, 19).map((p) => p.id), fresh.map((p) => p.id), 'the fresh page comes first, in its order');
});

test('a connection newer than everything before still appears first, and the old page-two items are kept below', () => {
  const current = range(1, 40);
  const newest = { id: 'pair-new', createdAt: '2026-12-31T10:00:00.000Z' };
  const fresh = [newest, ...range(1, 19)];
  const merged = mergeFirstPage(current, fresh);
  assert.equal(merged[0].id, 'pair-new');
  assert.equal(merged.length, 41, 'the item that slid off the first page is kept from the older list');
  assert.equal(merged.filter((p) => p.id === 'pair-020').length, 1);
  assert.equal(new Set(merged.map((p) => p.id)).size, merged.length, 'no duplicates');
});

test('an empty fresh page empties the list', () => {
  assert.deepEqual(mergeFirstPage(range(1, 5), []), []);
});

test('a further page is added to the end without repeating anything', () => {
  const merged = appendPage(range(1, 20), range(18, 40));
  assert.deepEqual(merged.map((p) => p.id), range(1, 40).map((p) => p.id));
  assert.deepEqual(appendPage([], []), []);
});

test('a remembered inbox is fresh only while the live inbox is unchanged and recent, otherwise shown and refreshed behind', () => {
  const entry = { rev: 7, at: 1_000_000 };
  assert.equal(inboxFreshness(null, 7, 1_000_001), 'none');
  assert.equal(inboxFreshness(entry, 7, 1_000_001), 'fresh');
  assert.equal(inboxFreshness(entry, 8, 1_000_001), 'stale', 'something changed');
  assert.equal(inboxFreshness(entry, 7, 1_000_000 + INBOX_CACHE_MS), 'stale', 'too old');
  assert.equal(inboxFreshness(entry, undefined, 1_000_001), 'stale', 'no live inbox to confirm it');
  assert.equal(inboxFreshness({ rev: undefined, at: 1 }, undefined, 2), 'stale');
});

test('a remembered inbox belongs to one member, and is never handed to another', () => {
  assert.equal(inboxCacheKey('abc'), 'inbox:abc');
  assert.equal(inboxCacheKey(null), null);
  assert.equal(inboxCacheKey(undefined), null);
  clearInboxCache();
  writeInboxCache('alice', { pairs: [], invitations: [], nextCursor: null, rev: 1, at: 5 });
  assert.equal(readInboxCache('alice')?.rev, 1);
  assert.equal(readInboxCache('bob'), null);
  assert.equal(readInboxCache(null), null);
  writeInboxCache(null, { pairs: [], invitations: [], nextCursor: null, rev: 9, at: 9 });
  assert.equal(readInboxCache(null), null, 'nothing is stored without a member');
  clearInboxCache('alice');
  assert.equal(readInboxCache('alice'), null);
});

// ---------------------------------------------------------------------------------------------- shared requests
const okResponse = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
const token = async () => 'token';

test('two callers asking for the same list at the same moment make one request', async () => {
  requestCounts.clear();
  let sent = 0;
  const fetchImpl = (async () => { sent += 1; await new Promise((r) => setTimeout(r, 20)); return okResponse({ invitations: [] }); }) as unknown as typeof fetch;
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => getShared('/api/signals?status=pending', { fetchImpl, getToken: token })));
  assert.equal(sent, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(requestCounts.get('/api/signals?status=pending'), 1);
  await getShared('/api/signals?status=pending', { fetchImpl, getToken: token });
  assert.equal(sent, 2, 'a later request is a new request: nothing is served from a stale answer');
});

test('different lists are different requests', async () => {
  let sent = 0;
  const fetchImpl = (async () => { sent += 1; return okResponse({}); }) as unknown as typeof fetch;
  await Promise.all([getShared('/api/a', { fetchImpl, getToken: token }), getShared('/api/b', { fetchImpl, getToken: token })]);
  assert.equal(sent, 2);
});

test('a request that never answers fails after its time limit instead of loading forever', async () => {
  const fetchImpl = ((_: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
  const started = Date.now();
  await assert.rejects(getShared('/api/hang', { fetchImpl, getToken: token, timeoutMs: 60 }), (error) => error instanceof ListRequestError && error.code === 'timeout');
  assert.ok(Date.now() - started < 1500);
  assert.ok(LIST_REQUEST_TIMEOUT_MS <= 20_000, 'the real limit is short enough to matter');
});

test('server errors keep their meaning, a network failure says so, and signed-out is reported', async () => {
  const failing = (status: number, error: string) => (async () => ({ ok: false, status, json: async () => ({ error }) }) as Response) as unknown as typeof fetch;
  await assert.rejects(getShared('/api/e1', { fetchImpl: failing(403, 'not_allowed'), getToken: token }), (e: ListRequestError) => e.code === 'not_allowed' && /not allowed/i.test(e.message));
  await assert.rejects(getShared('/api/e2', { fetchImpl: failing(500, 'internal_error'), getToken: token }), (e: ListRequestError) => e.code === 'internal_error');
  const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await assert.rejects(getShared('/api/e3', { fetchImpl: offline, getToken: token }), (e: ListRequestError) => e.code === 'network');
  await assert.rejects(getShared('/api/e4', { fetchImpl: failing(200, 'x'), getToken: async () => null }), (e: ListRequestError) => e.code === 'unauthenticated');
});

test('after a failure the next request is made fresh, not answered with the failure again', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; if (calls === 1) throw new TypeError('offline'); return okResponse({ pairs: [], nextCursor: null }); }) as unknown as typeof fetch;
  await assert.rejects(getShared('/api/retry', { fetchImpl, getToken: token }));
  const ok = await getShared<{ pairs: unknown[] }>('/api/retry', { fetchImpl, getToken: token });
  assert.deepEqual(ok.pairs, []);
  assert.equal(calls, 2);
  void fetchPairsPage;
});
