import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnread, parseInbox, takeNewIds } from './signalsInbox.ts';

const ts = (ms: number) => ({ toMillis: () => ms });

test('parseInbox counts only unexpired pending invitations and tolerates junk', () => {
  const now = 1_000;
  const inbox = parseInbox({ rev: 3, pending: { a: ts(2_000), b: ts(500), c: 5_000, d: 'nope', e: null } }, now);
  assert.deepEqual(inbox.pendingIds.sort(), ['a', 'c']);
  assert.equal(inbox.rev, 3);
  assert.deepEqual(parseInbox(null), { rev: 0, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [] });
  assert.deepEqual(parseInbox({ rev: 'x', pending: 'y' }), { rev: 0, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [] });
});

test('takeNewIds announces each invitation once, even if the snapshot repeats', () => {
  const seen = new Set<string>();
  assert.deepEqual(takeNewIds(['a', 'b'], seen), ['a', 'b']);
  assert.deepEqual(takeNewIds(['a', 'b'], seen), [], 'duplicate snapshot');
  assert.deepEqual(takeNewIds(['b', 'c'], seen), ['c']);
  assert.deepEqual(takeNewIds([], seen), []);
  assert.deepEqual(takeNewIds(['a'], seen), [], 'a request that resolved and reappears is not re-announced');
});

test('parseInbox reads per-pair unread counts and ignores zero, negative and junk values', () => {
  const inbox = parseInbox({ unread: { p1: 3, p2: 0, p3: -2, p4: 'x', p5: 12 } });
  assert.deepEqual(inbox.unread, { p1: 3, p5: 12 });
  assert.deepEqual(parseInbox({ unread: 'nope' }).unread, {});
});

test('formatUnread shows nothing at zero, the exact count up to 99, then 99+', () => {
  assert.equal(formatUnread(undefined), null);
  assert.equal(formatUnread(0), null);
  assert.equal(formatUnread(1), '1');
  assert.equal(formatUnread(12), '12');
  assert.equal(formatUnread(99), '99');
  assert.equal(formatUnread(100), '99+');
  assert.equal(formatUnread(5000), '99+');
});

test('unread counts are replaced by each snapshot, so a repeated or reconnected snapshot never adds up', () => {
  const raw = { unread: { p1: 2 } };
  assert.deepEqual(parseInbox(raw).unread, parseInbox(raw).unread);
  assert.equal(parseInbox(raw).unread.p1, 2);
});

test('parseInbox lists only unread "accepted" notifications, by connection id', () => {
  const inbox = parseInbox({
    notifications: {
      p1: { type: 'accepted', read: false },
      p2: { type: 'accepted', read: true },
      p3: { type: 'something-else', read: false },
      p4: null,
      p5: 'junk',
    },
  });
  assert.deepEqual(inbox.acceptedUnread, ['p1']);
  assert.deepEqual(parseInbox({ notifications: 'nope' }).acceptedUnread, []);
  assert.deepEqual(parseInbox(null).acceptedUnread, []);
});

test('a notification that is read in a later snapshot disappears, and a repeated snapshot does not duplicate it', () => {
  const unread = { notifications: { p1: { type: 'accepted', read: false } } };
  assert.deepEqual(parseInbox(unread).acceptedUnread, parseInbox(unread).acceptedUnread);
  assert.deepEqual(parseInbox({ notifications: { p1: { type: 'accepted', read: true } } }).acceptedUnread, []);
  const seen = new Set<string>();
  assert.deepEqual(takeNewIds(parseInbox(unread).acceptedUnread, seen), ['p1']);
  assert.deepEqual(takeNewIds(parseInbox(unread).acceptedUnread, seen), [], 'a reconnect snapshot is not announced again');
});

test('parseInbox lists waiting connection requests by id and ignores expired or malformed ones', () => {
  const now = 1_000;
  const inbox = parseInbox({ requests: { r1: ts(2_000), r2: ts(500), r3: 5_000, r4: 'nope', r5: null } }, now);
  assert.deepEqual(inbox.requestIds.sort(), ['r1', 'r3']);
  assert.deepEqual(parseInbox({ requests: 'x' }).requestIds, []);
  assert.deepEqual(parseInbox(null).requestIds, []);
});

test('a waiting request is announced once, and a reconnect snapshot does not announce it again', () => {
  const raw = { requests: { r1: 9_999_999_999_999 } };
  const seen = new Set<string>();
  assert.deepEqual(takeNewIds(parseInbox(raw).requestIds, seen), ['r1']);
  assert.deepEqual(takeNewIds(parseInbox(raw).requestIds, seen), []);
});
