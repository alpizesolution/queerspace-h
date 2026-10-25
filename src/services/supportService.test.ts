import test from 'node:test';
import assert from 'node:assert/strict';
import { toSupportMessage, toSupportThread } from './supportService.ts';

test('toSupportMessage treats anything but "team" as the member', () => {
  assert.equal(toSupportMessage('m', { from: 'team', text: 'hi' }).from, 'team');
  assert.equal(toSupportMessage('m', { from: 'admin', text: 'hi' }).from, 'user');
});

test('toSupportThread defaults missing fields and drops bad avatars', () => {
  const t = toSupportThread('u1', { lastMessage: 'help', unreadForTeam: true, avatar: '<bad>' });
  assert.equal(t.displayName, 'Member');
  assert.equal(t.avatar, undefined);
  assert.equal(t.lastFrom, 'user');
  assert.equal(t.unreadForTeam, true);
  assert.equal(t.unreadForUser, false);
});
