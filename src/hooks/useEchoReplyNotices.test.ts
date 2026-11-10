import test from 'node:test';
import assert from 'node:assert/strict';
import { replyNoticeFor, totalUnseen } from './useEchoReplyNotices.ts';

test('opening the app with unseen replies gives one summary; with none it says nothing', () => {
  assert.deepEqual(replyNoticeFor(null, { a: 2, b: 1 }, true), { kind: 'summary', count: 3 });
  assert.equal(replyNoticeFor(null, {}, true), null);
});

test('a reply arriving while the app is open is "new"; reading replies or deleting one is not', () => {
  assert.deepEqual(replyNoticeFor({ a: 1 }, { a: 2 }, false), { kind: 'new', count: 1 });
  assert.deepEqual(replyNoticeFor({}, { a: 1 }, false), { kind: 'new', count: 1 }, 'a first reply on another post');
  assert.deepEqual(replyNoticeFor({ a: 1, b: 1 }, { a: 3, b: 0 }, false), { kind: 'new', count: 2 });
  assert.equal(replyNoticeFor({ a: 2 }, { a: 0 }, false), null, 'marking replies as seen lowers the count: no notice');
  assert.equal(replyNoticeFor({ a: 2 }, { a: 1 }, false), null, 'a deleted reply: no notice');
  assert.equal(replyNoticeFor({ a: 2 }, { a: 2 }, false), null, 'nothing changed');
});

test('the Echoes tab count adds up the new replies across posts', () => {
  assert.equal(totalUnseen({}), 0);
  assert.equal(totalUnseen({ a: 2, b: 3 }), 5);
});
