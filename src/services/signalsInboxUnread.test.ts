import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnread, parseInbox, sortByActivity, totalUnread } from './signalsInbox.ts';

const ts = (ms: number) => ({ toMillis: () => ms });

test('parseInbox reads the latest-message line of each connection and ignores junk', () => {
  const inbox = parseInbox({ last: { p1: { text: 'see you soon', mine: false, at: ts(5_000) }, p2: { text: 'ok', mine: true }, p3: { text: '' }, p4: 'x', p5: null } });
  assert.deepEqual(inbox.last, { p1: { text: 'see you soon', mine: false, at: 5_000 }, p2: { text: 'ok', mine: true, at: null } });
  assert.deepEqual(parseInbox({ last: 'nope' }).last, {});
  assert.equal(parseInbox({ last: { p1: { text: 'x'.repeat(500), mine: false } } }).last.p1.text.length, 120, 'a preview is never long');
});

test('the Signals badge counts unread messages across every connection, without the one on screen', () => {
  assert.equal(totalUnread({}), 0);
  assert.equal(totalUnread({ a: 1 }), 1);
  assert.equal(totalUnread({ a: 1, b: 4, c: 12 }), 17);
  assert.equal(totalUnread({ a: 3, b: 4 }, 'a'), 4, 'the open conversation is left out');
  assert.equal(totalUnread({ a: 3 }, 'a'), 0);
  assert.equal(totalUnread({ a: 0, b: -2, c: Number.NaN, d: 2.9 }), 2, 'junk and zero never count');
  assert.equal(formatUnread(totalUnread({ a: 60, b: 50 })), '99+', 'a total above 99 reads 99+');
  assert.equal(formatUnread(totalUnread({ a: 99 })), '99');
});

const pair = (id: string, createdAt: string) => ({ id, createdAt });
const pairs = [pair('old', '2026-01-01T00:00:00Z'), pair('mid', '2026-02-01T00:00:00Z'), pair('new', '2026-03-01T00:00:00Z'), pair('quiet', '2026-01-15T00:00:00Z')];
const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

test('with no messages the order is by when the connection began, newest first', () => {
  assert.deepEqual(ids(sortByActivity(pairs, {}, {})), ['new', 'mid', 'quiet', 'old']);
});

test('a recent message lifts a connection among the read ones', () => {
  const last = { old: { text: 'hi', mine: false, at: Date.parse('2026-04-01T00:00:00Z') }, quiet: { text: 'hey', mine: true, at: Date.parse('2026-02-20T00:00:00Z') } };
  assert.deepEqual(ids(sortByActivity(pairs, {}, last)), ['old', 'new', 'quiet', 'mid']);
});

test('conversations with unread messages come first; among them, the most recent activity first', () => {
  const last = { old: { text: 'hi', mine: false, at: Date.parse('2026-04-01T00:00:00Z') }, quiet: { text: 'hey', mine: true, at: Date.parse('2026-02-20T00:00:00Z') } };
  assert.deepEqual(ids(sortByActivity(pairs, { mid: 2, quiet: 1 }, last)), ['quiet', 'mid', 'old', 'new']);
  assert.deepEqual(ids(sortByActivity(pairs, { old: 5 }, last)), ['old', 'new', 'quiet', 'mid']);
});

test('equal activity keeps the incoming order, and the input is never changed', () => {
  const same = [pair('a', '2026-01-01T00:00:00Z'), pair('b', '2026-01-01T00:00:00Z')];
  assert.deepEqual(ids(sortByActivity(same, {}, {})), ['a', 'b']);
  assert.deepEqual(ids(pairs), ['old', 'mid', 'new', 'quiet']);
});
