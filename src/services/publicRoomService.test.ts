import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicRoomMessage } from './publicRoomService.ts';
import type { PublicRoomMessage } from '../types.ts';

test('toPublicRoomMessage marks your own messages and keeps valid avatars only', () => {
  const mine = toPublicRoomMessage('m1', { authorId: 'me', authorName: 'Willow', authorPronouns: 'she/her', authorAvatar: 'cat.0.1', text: 'hi' }, 'me');
  assert.equal(mine.isSelf, true);
  assert.equal(mine.authorAvatar, 'cat.0.1');

  const theirs = toPublicRoomMessage('m2', { authorId: 'you', authorName: 'Rowan', authorAvatar: '<bad>', text: 'hey' }, 'me');
  assert.equal(theirs.isSelf, false);
  assert.equal(theirs.authorAvatar, undefined);
});

test('toPublicRoomMessage is never "self" when signed out', () => {
  assert.equal(toPublicRoomMessage('m', { authorId: '', text: 'x' }, null).isSelf, false);
});

test('toPublicRoomMessage keeps the team flag only when it is exactly true', () => {
  assert.equal(toPublicRoomMessage('t', { authorId: 'a', text: 'hi', team: true }, null).team, true);
  assert.equal(toPublicRoomMessage('t', { authorId: 'a', text: 'hi', team: 'yes' }, null).team, undefined);
});

test('toPublicRoomMessage keeps a well-formed reply quote and drops a broken one', () => {
  const withQuote = toPublicRoomMessage('t', { authorId: 'a', text: 'hi', team: true, replyTo: { id: 'm1', author: 'Ivy', text: 'help?' } }, null);
  assert.deepEqual(withQuote.replyTo, { id: 'm1', author: 'Ivy', text: 'help?' });
  assert.equal(toPublicRoomMessage('t', { authorId: 'a', text: 'hi', replyTo: { text: 'no id' } }, null).replyTo, undefined);
});

import { mergeRoomMessages, prependRoomPage } from './publicRoomService.ts';

const msg = (n: number, over: Partial<PublicRoomMessage> = {}): PublicRoomMessage => ({
  id: `m${String(n).padStart(3, '0')}`, authorId: 'a', author: 'A', authorPronouns: 'she/her', text: `t${n}`, timestamp: n * 1000, isSelf: false, ...over,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const ids = (list: PublicRoomMessage[]) => list.map((m) => m.id);

test('first snapshot: the live window is shown as is', () => {
  const r = mergeRoomMessages([], range(1, 30), true);
  assert.deepEqual(ids(r.messages), ids(range(1, 30)));
  assert.equal(r.reset, false);
});

test('a new message slides the window: the oldest stays on screen, nothing is duplicated', () => {
  const shown = range(1, 30);
  const r = mergeRoomMessages(shown, range(2, 31), true);
  assert.deepEqual(ids(r.messages), ids(range(1, 31)));
  assert.equal(new Set(ids(r.messages)).size, r.messages.length);
});

test('older pages already loaded are kept when the window updates', () => {
  const shown = [...range(1, 30), ...range(31, 60)];
  const r = mergeRoomMessages(shown, range(32, 61), true);
  assert.deepEqual(ids(r.messages), ids(range(1, 61)));
});

test('a message deleted inside the live window disappears; older messages stay', () => {
  const shown = range(1, 60);
  const live = range(31, 60).filter((m) => m.id !== 'm045');
  live.unshift(msg(30)); // the window pulls in the next older message to stay full
  const r = mergeRoomMessages(shown, live, true);
  assert.ok(!ids(r.messages).includes('m045'));
  assert.ok(ids(r.messages).includes('m010'));
  assert.equal(new Set(ids(r.messages)).size, r.messages.length);
});

test('a short room (window not full) simply mirrors the live list, so deletions show', () => {
  const r = mergeRoomMessages(range(1, 5), range(1, 5).filter((m) => m.id !== 'm003'), false);
  assert.deepEqual(ids(r.messages), ['m001', 'm002', 'm004', 'm005']);
});

test('an empty room stays empty', () => {
  assert.deepEqual(mergeRoomMessages([], [], false), { messages: [], reset: false });
});

test('a gap (listener was paused while 30+ messages arrived) keeps only the live window and resets paging', () => {
  const r = mergeRoomMessages(range(1, 30), range(100, 129), true);
  assert.deepEqual(ids(r.messages), ids(range(100, 129)));
  assert.equal(r.reset, true);
});

test('prependRoomPage adds older messages above, oldest first, without duplicates', () => {
  const shown = range(31, 60);
  const out = prependRoomPage(shown, [...range(1, 30), msg(31)]);
  assert.deepEqual(ids(out), ids(range(1, 60)));
  assert.deepEqual(ids(prependRoomPage(shown, [])), ids(shown));
});
