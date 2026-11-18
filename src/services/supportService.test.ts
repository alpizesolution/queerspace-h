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

test('unreadReplyCount: team replies minus read ones; the member\'s own messages never count', async () => {
  const { unreadReplyCount } = await import('./supportService.ts');
  assert.equal(unreadReplyCount(undefined), 0);
  assert.equal(unreadReplyCount({}), 0);
  assert.equal(unreadReplyCount({ lastFrom: 'user', unreadForTeam: true }), 0, 'a member message is not an unread reply');
  assert.equal(unreadReplyCount({ teamMessageCount: 3, readTeamCount: 0, unreadForUser: true }), 3);
  assert.equal(unreadReplyCount({ teamMessageCount: 3, readTeamCount: 2, unreadForUser: true }), 1);
  assert.equal(unreadReplyCount({ teamMessageCount: 3, readTeamCount: 3, unreadForUser: false }), 0);
  assert.equal(unreadReplyCount({ teamMessageCount: 3, readTeamCount: 5 }), 0, 'never negative');
  assert.equal(unreadReplyCount({ teamMessageCount: 12, readTeamCount: 0 }), 12);
});

test('unreadReplyCount: threads from before the counters existed still show one unread reply', async () => {
  const { unreadReplyCount } = await import('./supportService.ts');
  assert.equal(unreadReplyCount({ unreadForUser: true }), 1);
  assert.equal(unreadReplyCount({ unreadForUser: false }), 0);
  assert.equal(unreadReplyCount({ teamMessageCount: 'x', readTeamCount: null, unreadForUser: true }), 1);
});

test('toSupportThread carries the counters and defaults them safely', () => {
  const t = toSupportThread('u1', { teamMessageCount: 4, readTeamCount: 1 });
  assert.equal(t.teamMessageCount, 4);
  assert.equal(t.readTeamCount, 1);
  const bare = toSupportThread('u1', {});
  assert.equal(bare.teamMessageCount, 0);
  assert.equal(bare.readTeamCount, 0);
});
