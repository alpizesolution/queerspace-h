import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { isFreshQueueEntry, nextClaimDelay, pickQueueCandidates } from './liveMatchService.ts';

const now = 1_800_000_000_000;
const ts = (msAgo: number) => Timestamp.fromMillis(now - msAgo);

test('isFreshQueueEntry treats recent and pending heartbeats as live, old ones as stale', () => {
  assert.equal(isFreshQueueEntry({ heartbeatAt: ts(5_000) }, now), true);
  assert.equal(isFreshQueueEntry({ heartbeatAt: null }, now), true);
  assert.equal(isFreshQueueEntry({ heartbeatAt: ts(60_000) }, now), false);
});

test('pickQueueCandidates skips self, blocked, matched and stale entries, oldest first', () => {
  const entries = [
    { id: 'me', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(9_000) } },
    { id: 'newer', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(2_000) } },
    { id: 'older', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(8_000) } },
    { id: 'blocked', data: { status: 'waiting', heartbeatAt: ts(1_000), createdAt: ts(9_500) } },
    { id: 'taken', data: { status: 'matched', heartbeatAt: ts(1_000), createdAt: ts(9_900) } },
    { id: 'ghost', data: { status: 'waiting', heartbeatAt: ts(120_000), createdAt: ts(130_000) } },
  ];
  assert.deepEqual(pickQueueCandidates(entries, 'me', ['blocked'], now), ['older', 'newer']);
});

test('pickQueueCandidates returns nothing when no one else is waiting', () => {
  assert.deepEqual(
    pickQueueCandidates([{ id: 'me', data: { status: 'waiting', heartbeatAt: ts(0), createdAt: ts(0) } }], 'me', [], now),
    []
  );
});

test('nextClaimDelay backs off while the queue is empty and stays capped', () => {
  assert.equal(nextClaimDelay(0, 0.5), 3000);
  assert.equal(nextClaimDelay(2, 0.5), 6750);
  assert.equal(nextClaimDelay(20, 0.5), 12000);
  assert.ok(nextClaimDelay(0, 0) >= 2500 && nextClaimDelay(0, 1) <= 3500);
});
