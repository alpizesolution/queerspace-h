import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The real fetchMemberCommunityPosts, with only the Firestore SDK and the Firebase app faked, so what the profile does with a
 * successful answer, an empty answer and a failed one is the shipped code. (Run with --experimental-test-module-mocks.)
 */
type FakeDoc = { id: string; data: () => Record<string, unknown> };
let result: { docs: FakeDoc[] } | Error = { docs: [] };
let calls = 0;
const queries: unknown[][] = [];
let currentUid: string | null = 'viewer';

const realFirestore = await import('firebase/firestore');
mock.module('firebase/firestore', {
  namedExports: {
    ...realFirestore,
    collection: (_db: unknown, name: string) => ({ collection: name }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    orderBy: (field: string, dir: string) => ({ orderBy: [field, dir] }),
    startAfter: (cursor: unknown) => ({ startAfter: cursor }),
    limit: (n: number) => ({ limit: n }),
    query: (...parts: unknown[]) => { queries.push(parts); return parts; },
    getDocs: async () => { calls++; if (result instanceof Error) throw result; return result; },
  },
});
const realFirebase = await import('../lib/firebase.ts');
mock.module('../lib/firebase.ts', {
  namedExports: {
    ...realFirebase,
    db: {},
    auth: { get currentUser() { return currentUid ? { uid: currentUid } : null; } },
    ensureAnonymousAuth: async () => (currentUid ? { uid: currentUid } : null),
  },
});

const { fetchMemberCommunityPosts, clearProfileCache, peekMemberPostsFirstPage } = await import('./profileViewService.ts');
const { PROFILE_PAGE_SIZE } = await import('../utils/profileView.ts');

const doc = (id: string, authorId: string, timestamp: number): FakeDoc => ({
  id,
  data: () => ({ authorId, authorName: 'Willow', authorPronouns: 'she/her', title: `Title ${id}`, content: 'Body', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: { toMillis: () => timestamp } }),
});
const reset = () => { clearProfileCache(); calls = 0; queries.length = 0; currentUid = 'viewer'; };
const firestoreError = (code: string) => Object.assign(new Error(code), { code });

test('a member with several posts: every one is returned, in the order Firestore gave (newest first), for their own profile and another’s', async () => {
  for (const viewer of ['viewer', 'ana']) {
    reset();
    currentUid = viewer;
    result = { docs: [doc('p3', 'ana', 3), doc('p2', 'ana', 2), doc('p1', 'ana', 1)] };
    const outcome = await fetchMemberCommunityPosts('ana');
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.page.posts.map((p) => p.id), ['p3', 'p2', 'p1']);
    assert.equal(outcome.page.done, true);
    assert.deepEqual(queries[0], [{ collection: 'community_posts' }, { where: ['authorId', '==', 'ana'] }, { orderBy: ['timestamp', 'desc'] }, { limit: PROFILE_PAGE_SIZE + 1 }]);
  }
});

test('a member with no posts is a successful empty page, never a failure', async () => {
  reset();
  result = { docs: [] };
  const outcome = await fetchMemberCommunityPosts('ana');
  assert.deepEqual(outcome, { ok: true, page: { posts: [], cursor: null, done: true } });
});

test('a failed query is a failure with a reason, never an empty list', async () => {
  for (const [code, reason] of [['permission-denied', 'permission'], ['unavailable', 'network'], ['failed-precondition', 'failed']] as const) {
    reset();
    result = firestoreError(code);
    const outcome = await fetchMemberCommunityPosts('ana');
    assert.deepEqual(outcome, { ok: false, reason });
  }
});

test('a failure is not remembered: trying again asks Firestore again and can succeed', async () => {
  reset();
  result = firestoreError('unavailable');
  assert.equal((await fetchMemberCommunityPosts('ana')).ok, false);
  result = { docs: [doc('p1', 'ana', 1)] };
  const again = await fetchMemberCommunityPosts('ana');
  assert.ok(again.ok);
  assert.equal(calls, 2);
});

test('more than a page: only a page is shown and the extra post says there is more', async () => {
  reset();
  result = { docs: Array.from({ length: PROFILE_PAGE_SIZE + 1 }, (_, n) => doc(`p${n}`, 'ana', 100 - n)) };
  const outcome = await fetchMemberCommunityPosts('ana');
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.page.posts.length, PROFILE_PAGE_SIZE);
  assert.equal(outcome.page.done, false);
  assert.equal(outcome.page.cursor?.id, `p${PROFILE_PAGE_SIZE - 1}`, 'the next page starts after the last post shown');
});

test('another member’s posts are remembered for a minute; an empty answer is not, so a post made a moment later is not hidden', async () => {
  reset();
  result = { docs: [doc('p1', 'ana', 1)] };
  await fetchMemberCommunityPosts('ana');
  await fetchMemberCommunityPosts('ana');
  assert.equal(calls, 1, 'the second look reuses the first');
  assert.equal(peekMemberPostsFirstPage('ana')?.posts.length, 1);

  reset();
  result = { docs: [] };
  await fetchMemberCommunityPosts('ben');
  assert.equal(peekMemberPostsFirstPage('ben'), null, '"No public posts yet" is never remembered');
  result = { docs: [doc('p9', 'ben', 9)] };
  const later = await fetchMemberCommunityPosts('ben');
  assert.ok(later.ok && later.page.posts.length === 1, 'the new post shows on the next look');
});

test('a member’s own posts are always read fresh', async () => {
  reset();
  currentUid = 'ana';
  result = { docs: [doc('p1', 'ana', 1)] };
  await fetchMemberCommunityPosts('ana');
  result = { docs: [doc('p2', 'ana', 2), doc('p1', 'ana', 1)] };
  const outcome = await fetchMemberCommunityPosts('ana');
  assert.ok(outcome.ok && outcome.page.posts.length === 2);
  assert.equal(calls, 2);
});
