import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMyReaction,
  describeSendFailure,
  mergeMessages,
  newerCursor,
  visibleThread,
  type PendingMessage,
  type ThreadMessage,
} from './signalsThread.ts';

const msg = (id: string, at: string | null, over: Partial<ThreadMessage> = {}): ThreadMessage => ({ id, senderId: 'a', text: id, createdAt: at, ...over });
const T = (s: number) => new Date(Date.UTC(2026, 9, 30, 12, 0, s)).toISOString();

test('merging replaces a changed message in place and adds new ones by time, never dropping any', () => {
  const current = [msg('m1', T(1)), msg('m2', T(2))];
  const next = mergeMessages(current, [msg('m2', T(2), { reactions: [{ emoji: '😻', count: 1, userReacted: false }] }), msg('m3', T(3))]);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(next[1].reactions?.length, 1);
  // A late, older message slots in by time; an empty poll changes nothing at all (same array).
  assert.deepEqual(mergeMessages(next, [msg('m0', T(0))]).map((m) => m.id), ['m0', 'm1', 'm2', 'm3']);
  assert.equal(mergeMessages(next, []), next);
});

const pending = (id: string, over: Partial<PendingMessage> = {}): PendingMessage => ({
  id, text: `text ${id}`, replyTo: null, status: 'sending', retryable: true, createdAt: Date.UTC(2026, 9, 30, 12, 0, 9), ...over,
});

test('a message being sent shows at the end; once the server returns it, it is shown once (same id)', () => {
  const server = [msg('m1', T(1))];
  const shown = visibleThread(server, [pending('p1'), pending('p2', { status: 'failed' })], 'me');
  assert.deepEqual(shown.map((m) => m.id), ['m1', 'p1', 'p2']);
  assert.equal(shown[1].senderId, 'me');
  assert.equal(shown[2].pending?.status, 'failed');
  // The server now has p1: the pending copy disappears, so there is no duplicate.
  const after = visibleThread([...server, msg('p1', T(10), { senderId: 'me' })], [pending('p1'), pending('p2', { status: 'failed' })], 'me');
  assert.deepEqual(after.map((m) => m.id), ['m1', 'p1', 'p2']);
  assert.equal(after.filter((m) => m.id === 'p1').length, 1);
  assert.equal(after[1].pending, undefined);
});

test('reacting: add, change to another emoji, and remove, one reaction per member', () => {
  const others = [{ emoji: '😹', count: 1, userReacted: false }];
  const added = applyMyReaction(others, '😻');
  assert.deepEqual(added, [{ emoji: '😹', count: 1, userReacted: false }, { emoji: '😻', count: 1, userReacted: true }]);
  // Changing: my 😻 moves to 🙀, and joins nobody else's count wrongly.
  const changed = applyMyReaction(added, '🙀');
  assert.deepEqual(changed, [{ emoji: '😹', count: 1, userReacted: false }, { emoji: '🙀', count: 1, userReacted: true }]);
  // Same emoji again removes mine only.
  assert.deepEqual(applyMyReaction(changed, '🙀'), [{ emoji: '😹', count: 1, userReacted: false }]);
  // Joining someone else's emoji raises its count; removing it lowers it back.
  const joined = applyMyReaction([{ emoji: '😻', count: 1, userReacted: false }], '😻');
  assert.deepEqual(joined, [{ emoji: '😻', count: 2, userReacted: true }]);
  assert.deepEqual(applyMyReaction(joined, '😻'), [{ emoji: '😻', count: 1, userReacted: false }]);
  assert.deepEqual(applyMyReaction(undefined, '❤️'), [{ emoji: '❤️', count: 1, userReacted: true }]);
});

test('the polling cursor only moves forward', () => {
  assert.equal(newerCursor(null, T(5)), T(5));
  assert.equal(newerCursor(T(5), T(3)), T(5));
  assert.equal(newerCursor(T(5), T(8)), T(8));
  assert.equal(newerCursor(T(5), null), T(5));
});

test('failures are explained, and only the ones a retry can fix are retryable', () => {
  assert.equal(describeSendFailure(new Error('This connection has ended.')).retryable, false);
  assert.equal(describeSendFailure(new Error('You can no longer message this connection.')).retryable, false);
  assert.equal(describeSendFailure(new TypeError('Failed to fetch')).retryable, true);
  assert.match(describeSendFailure(new TypeError('Failed to fetch')).message, /No connection/);
  assert.equal(describeSendFailure(new DOMException('aborted', 'AbortError')).retryable, true);
  assert.equal(describeSendFailure(new Error('Signals is temporarily unavailable. Please try again.')).retryable, true);
});

test('a continuation position replaces the cursor it continues, a later ordinary cursor replaces a position, and ordinary cursors still only move forward', async () => {
  const { isPositionCursor } = await import('./signalsThread.ts');
  const position = '1767225600.123456789.msg-000100';
  const iso = (ms: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + ms).toISOString();
  assert.equal(isPositionCursor(position), true);
  assert.equal(isPositionCursor(iso(0)), false, 'an ISO time is not a position');
  assert.equal(isPositionCursor('2026-01-01T00:00:00.123Z'), false);
  assert.equal(newerCursor(iso(5000), position), position, 'a continuation always moves on from where it started');
  assert.equal(newerCursor(position, iso(9000)), iso(9000), 'a finished catch-up ends the continuation');
  assert.equal(newerCursor(position, '1767225601.5.msg-000200'), '1767225601.5.msg-000200');
  assert.equal(newerCursor(iso(5000), iso(3000)), iso(5000), 'ordinary cursors never go back');
});
