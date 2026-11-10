import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ECHO_MILESTONES,
  highestMilestone,
  mergeNotifications,
  milestoneNotificationId,
  notificationText,
  reactionTotal,
  replyNotificationId,
  replyPreview,
  syncEchoNotifications,
  toEchoNotification,
  unreadCount,
  type EchoNotification,
} from './echoNotificationService.ts';

const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const service = read('src/services/echoNotificationService.ts');

const note = (id: string, createdAt: number, over: Partial<EchoNotification> = {}): EchoNotification => ({
  id, type: 'reply', postId: 'p', kind: 'advice', preview: 'hi', threshold: null, at: createdAt, createdAt, read: false, ...over,
});

test('milestones are 10, 25, 50 and 100 total reactions, and only the highest one reached is announced', () => {
  assert.deepEqual([...ECHO_MILESTONES], [10, 25, 50, 100]);
  assert.equal(highestMilestone(0), null);
  assert.equal(highestMilestone(9), null);
  assert.equal(highestMilestone(10), 10);
  assert.equal(highestMilestone(24), 10);
  assert.equal(highestMilestone(30), 25, 'a jump past two thresholds announces one');
  assert.equal(highestMilestone(100), 100);
  assert.equal(highestMilestone(5000), 100);
});

test('engagement is the sum of the six existing reaction counters; nothing new is invented', () => {
  assert.equal(reactionTotal({ hugs: 2, same: 3, felt: 1, strong: 1, proud: 1, cry: 2 }), 10);
  assert.equal(reactionTotal({}), 0);
  assert.equal(reactionTotal({ hugs: -4, same: 'x', felt: 2.9 }), 2);
});

test('ids come from the event, so one event can only have one notification', () => {
  assert.equal(replyNotificationId('abc123'), 'reply_abc123');
  assert.equal(milestoneNotificationId('post9', 25), 'milestone_post9_25');
});

test('a reply preview is short and flat', () => {
  assert.equal(replyPreview('  Congrats!\n\n  So proud  '), 'Congrats! So proud');
  const long = replyPreview('word '.repeat(60));
  assert.ok(long.length <= 80 && long.endsWith('…'));
});

test('the list text names the category and the event, never a person', () => {
  assert.deepEqual(notificationText({ type: 'reply', kind: 'wins', preview: 'Proud of you', threshold: null }), { title: 'New reply on your Little Win', body: '“Proud of you”' });
  assert.equal(notificationText({ type: 'reply', kind: 'advice', preview: '', threshold: null }).body, 'Someone replied.');
  assert.equal(notificationText({ type: 'milestone', kind: 'vent', preview: '', threshold: 25 }).title, 'Your Vent reached 25 reactions');
});

test('a stored notification reads safely, including odd or missing fields', () => {
  const n = toEchoNotification('reply_r1', { type: 'reply', postId: 'p1', kind: 'gratitude', preview: 'thank you', createdAt: { toMillis: () => 9 }, eventAt: { toMillis: () => 5 }, read: true });
  assert.deepEqual(n, { id: 'reply_r1', type: 'reply', postId: 'p1', kind: 'gratitude', preview: 'thank you', threshold: null, at: 5, createdAt: 9, read: true });
  const odd = toEchoNotification('x', { kind: 'nonsense', read: 'yes' });
  assert.equal(odd.kind, 'vent');
  assert.equal(odd.read, false);
  assert.equal(odd.createdAt, 0);
  assert.equal(JSON.stringify(n).includes('authorId'), false);
});

test('unread count, newest-first order and no repeats when pages are joined', () => {
  const list = mergeNotifications([note('a', 30), note('b', 20, { read: true })], [note('b', 20, { read: true }), note('c', 10)]);
  assert.deepEqual(list.map((n) => n.id), ['a', 'b', 'c']);
  assert.equal(unreadCount(list), 2);
  assert.equal(unreadCount([]), 0);
});

test('with no database (as in a test run) syncing quietly does nothing and never throws', async () => {
  await syncEchoNotifications([{ id: 'p', kind: 'advice', replyCount: 3, seenReplies: 0, reactions: 40 }], { replies: true, milestones: true });
});

test('the notifier follows the rules: replies only on reply categories, never for the writer\'s own reply, preferences respected, one write per event', () => {
  const sync = service.slice(service.indexOf('export async function syncEchoNotifications'));
  assert.match(sync, /prefs\.replies && kindAllowsReplies\(echo\.kind\) && unseen > 0/);
  assert.match(sync, /if \(own\.has\(reply\.id\)\) continue;/, 'own replies skipped');
  assert.match(sync, /prefs\.milestones && milestone !== null/);
  assert.match(sync, /if \(\(await getDoc\(ref\)\)\.exists\(\)\) continue;/, 'an existing notification is never written again');
  assert.match(sync, /createdAt: serverTimestamp\(\)/, 'server time');
  assert.doesNotMatch(sync, /authorId|ownerId|userId/, 'nothing about who is written into a notification');
});

test('the notification list lives under the member\'s own path, ordered by time alone, so it needs no index; Signals is untouched', () => {
  assert.match(service, /collection\(firestore, 'echo_notifications', uid, 'items'\), orderBy\('createdAt', 'desc'\)/);
  assert.doesNotMatch(service, /from '[^']*signals|signalsInbox|signalsPairs/i);
  const indexes = JSON.stringify(JSON.parse(read('firestore.indexes.json')));
  assert.equal(indexes.includes('echo_notifications'), false);
});

test('there is no Send Comfort in the app, so no comfort notification exists', () => {
  const sources = ['src/components/UnsaidView.tsx', 'src/components/UnsaidReplies.tsx', 'src/services/unsaidService.ts', 'src/utils/echoKinds.ts'].map(read).join('\n');
  assert.doesNotMatch(sources, /comfort/i);
  assert.doesNotMatch(service.replace(/“Comfort received” is not built[^\n]*/, ''), /sendComfort|comfort:/i);
});
