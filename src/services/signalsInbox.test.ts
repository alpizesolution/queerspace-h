import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInbox, takeNewIds } from './signalsInbox.ts';

const ts = (ms: number) => ({ toMillis: () => ms });

test('parseInbox counts only unexpired pending invitations and tolerates junk', () => {
  const now = 1_000;
  const inbox = parseInbox({ rev: 3, pending: { a: ts(2_000), b: ts(500), c: 5_000, d: 'nope', e: null } }, now);
  assert.deepEqual(inbox.pendingIds.sort(), ['a', 'c']);
  assert.equal(inbox.rev, 3);
  assert.deepEqual(parseInbox(null), { rev: 0, pendingIds: [] });
  assert.deepEqual(parseInbox({ rev: 'x', pending: 'y' }), { rev: 0, pendingIds: [] });
});

test('takeNewIds announces each invitation once, even if the snapshot repeats', () => {
  const seen = new Set<string>();
  assert.deepEqual(takeNewIds(['a', 'b'], seen), ['a', 'b']);
  assert.deepEqual(takeNewIds(['a', 'b'], seen), [], 'duplicate snapshot');
  assert.deepEqual(takeNewIds(['b', 'c'], seen), ['c']);
  assert.deepEqual(takeNewIds([], seen), []);
  assert.deepEqual(takeNewIds(['a'], seen), [], 'a request that resolved and reappears is not re-announced');
});
