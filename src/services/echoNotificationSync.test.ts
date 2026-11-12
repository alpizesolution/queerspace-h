import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The notifier's decisions, run for real against a tiny in-memory stand-in for Firestore: which replies and milestones get a
 * notification, and which do not (own replies, disabled categories, preferences, ones that already exist, repeats).
 */
type Doc = Record<string, unknown>;
const store = new Map<string, Doc>(); // path -> data
let replies: Array<{ id: string; text: string; createdAt: unknown }> = [];
let myReplyIds: string[] = [];
const writes: Array<{ path: string; data: Doc }> = [];

const realFirestore = await import('firebase/firestore');
const realUnsaid = await import('./unsaidService.ts');

mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice' } }, db: { fake: true }, ensureAnonymousAuth: async () => ({ uid: 'alice' }), isFirebaseConfigured: true } });
mock.module('firebase/firestore', {
  namedExports: {
    ...realFirestore,
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    query: (base: { path: string }) => base,
    orderBy: () => ({}),
    limit: () => ({}),
    where: () => ({}),
    serverTimestamp: () => 'SERVER_TIME',
    getDoc: async (ref: { path: string }) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
    getDocs: async () => ({ docs: replies.map((r) => ({ id: r.id, data: () => ({ text: r.text, createdAt: r.createdAt }) })), size: replies.length, empty: replies.length === 0 }),
    setDoc: async (ref: { path: string }, data: Doc) => { writes.push({ path: ref.path, data }); store.set(ref.path, data); },
  },
});
mock.module('./unsaidService.ts', { namedExports: { ...realUnsaid, loadMyReplyIds: async () => myReplyIds } });

const { syncEchoNotifications, resetEchoNotificationMemory } = await import('./echoNotificationService.ts');
const ALL = { replies: true, milestones: true };
const echo = (over: Record<string, unknown> = {}) => ({ id: 'p1', kind: 'advice' as const, replyCount: 0, seenReplies: 0, reactions: 0, ...over });

beforeEach(() => { store.clear(); writes.length = 0; replies = []; myReplyIds = []; resetEchoNotificationMemory(); });

test('a new reply on each of the five reply categories makes one notification, with a safe preview and no one named', async () => {
  for (const kind of ['advice', 'thoughts', 'wins', 'gratitude', 'daydreams'] as const) {
    writes.length = 0; store.clear(); resetEchoNotificationMemory();
    replies = [{ id: `r-${kind}`, text: 'You are  doing\nso well', createdAt: 'T1' }];
    await syncEchoNotifications([echo({ id: `p-${kind}`, kind, replyCount: 1 })], ALL);
    assert.equal(writes.length, 1, kind);
    assert.equal(writes[0].path, `echo_notifications/alice/items/reply_r-${kind}`);
    assert.deepEqual(writes[0].data, { type: 'reply', postId: `p-${kind}`, kind, replyId: `r-${kind}`, preview: 'You are doing so well', eventAt: 'T1', createdAt: 'SERVER_TIME', read: false });
  }
});

test('nothing for categories that take no replies, even if a reply count somehow shows', async () => {
  replies = [{ id: 'r1', text: 'hello', createdAt: 'T' }];
  for (const kind of ['confession', 'vent', 'unsent'] as const) await syncEchoNotifications([echo({ id: `p-${kind}`, kind, replyCount: 1 })], ALL);
  assert.equal(writes.length, 0);
});

test('no notification for the member\'s own reply, but others\' replies on the same Echo still notify', async () => {
  replies = [{ id: 'mine', text: 'my own', createdAt: 'T1' }, { id: 'theirs', text: 'kind words', createdAt: 'T2' }];
  myReplyIds = ['mine'];
  await syncEchoNotifications([echo({ replyCount: 2 })], ALL);
  assert.deepEqual(writes.map((w) => w.path), ['echo_notifications/alice/items/reply_theirs']);
});

test('replies the author has already seen are not announced', async () => {
  replies = [{ id: 'r1', text: 'seen already', createdAt: 'T' }];
  await syncEchoNotifications([echo({ replyCount: 1, seenReplies: 1 })], ALL);
  assert.equal(writes.length, 0);
});

test('no duplicates: a notification that exists is never written again, and repeated syncs do nothing more', async () => {
  replies = [{ id: 'r1', text: 'hi', createdAt: 'T' }];
  store.set('echo_notifications/alice/items/reply_r1', { read: true });
  await syncEchoNotifications([echo({ replyCount: 1 })], ALL);
  assert.equal(writes.length, 0, 'it already exists (even though it was read)');
  store.clear();
  resetEchoNotificationMemory();
  await syncEchoNotifications([echo({ replyCount: 1 })], ALL);
  await syncEchoNotifications([echo({ replyCount: 1 })], ALL);
  assert.equal(writes.length, 1, 'once, however many times the counters report');
});

test('milestones: announced once each at 10, 25, 50 and 100; only the highest one reached; none below 10', async () => {
  await syncEchoNotifications([echo({ kind: 'vent', reactions: 9 })], ALL);
  assert.equal(writes.length, 0);
  await syncEchoNotifications([echo({ kind: 'vent', reactions: 12 })], ALL);
  assert.deepEqual(writes.map((w) => w.path), ['echo_notifications/alice/items/milestone_p1_10']);
  await syncEchoNotifications([echo({ kind: 'vent', reactions: 13 })], ALL);
  assert.equal(writes.length, 1, 'same milestone, not again');
  await syncEchoNotifications([echo({ kind: 'vent', reactions: 80 })], ALL);
  assert.equal(writes.at(-1)!.path, 'echo_notifications/alice/items/milestone_p1_50', 'a jump announces just the highest');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].data, { type: 'milestone', postId: 'p1', kind: 'vent', threshold: 10, createdAt: 'SERVER_TIME', read: false });
});

test('preferences are respected: switched off means nothing is recorded; switched on records what is waiting', async () => {
  replies = [{ id: 'r1', text: 'hi', createdAt: 'T' }];
  const e = echo({ replyCount: 1, reactions: 30 });
  await syncEchoNotifications([e], { replies: false, milestones: false });
  assert.equal(writes.length, 0);
  await syncEchoNotifications([e], { replies: true, milestones: false });
  assert.deepEqual(writes.map((w) => w.path), ['echo_notifications/alice/items/reply_r1']);
  await syncEchoNotifications([e], { replies: true, milestones: true });
  assert.deepEqual(writes.map((w) => w.path), ['echo_notifications/alice/items/reply_r1', 'echo_notifications/alice/items/milestone_p1_25']);
});

test('an Echo deleted mid-way (no replies left to read) is skipped without trouble', async () => {
  replies = [];
  await syncEchoNotifications([echo({ replyCount: 3 })], ALL);
  assert.equal(writes.length, 0);
});
