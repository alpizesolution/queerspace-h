import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicRoomMessage } from './publicRoomService.ts';

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
