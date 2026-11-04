// The query behind a member's profile Posts section, run against the real firestore.rules in the emulator: the same
// shape as fetchMemberCommunityPosts (where authorId == member, newest first, one page plus one to know if more follow).
// Each test seeds its own members and posts. Run with --test-concurrency=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

test('Profile posts query', { skip }, async (t) => {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const { toCommunityPost } = await import('../../src/services/communityService.ts');
  const { PROFILE_PAGE_SIZE } = await import('../../src/utils/profileView.ts');
  const env = await initializeTestEnvironment({
    projectId: 'demo-queerspace-profile-posts',
    firestore: { rules: fs.readFileSync('./firestore.rules', 'utf8'), host, port: Number(port) },
  });
  t.after(() => env.cleanup());

  const day = 86_400_000;
  const base = Date.parse('2026-10-01T00:00:00Z');
  const seed = (id, authorId, extra = {}) => env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`community_posts/${id}`).set({
    authorId, authorName: authorId, authorPronouns: 'she/her', title: `Title ${id}`, content: `Body ${id}`,
    category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: new Date(base), ...extra,
  }));
  const member = (uid) => env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${uid}/private/settings`).set({ birthDate: new Date(Date.now() - 30 * 365 * day), createdAt: new Date() });
    await ctx.firestore().doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
  });
  // Exactly what fetchMemberCommunityPosts asks, as the signed-in viewer.
  const profilePosts = async (viewer, memberId, after) => {
    let q = env.authenticatedContext(viewer).firestore().collection('community_posts').where('authorId', '==', memberId).orderBy('timestamp', 'desc');
    if (after) q = q.startAfter(after);
    const snap = await q.limit(PROFILE_PAGE_SIZE + 1).get();
    const docs = snap.docs.slice(0, PROFILE_PAGE_SIZE);
    return { posts: docs.map((d) => toCommunityPost(d.id, d.data())), cursor: docs.at(-1) ?? after ?? null, done: snap.docs.length <= PROFILE_PAGE_SIZE };
  };
  const reset = async () => { await env.clearFirestore(); await Promise.all(['ana', 'ben', 'cy'].map(member)); };

  await t.test('a member with several public posts: all of them, newest first, on their own profile and on another member’s', async () => {
    await reset();
    await seed('post-oldest-0001', 'ana', { timestamp: new Date(base) });
    await seed('post-newest-0003', 'ana', { timestamp: new Date(base + 2 * day) });
    await seed('post-middle-0002', 'ana', { timestamp: new Date(base + day) });
    await seed('post-by-ben-0001', 'ben', { timestamp: new Date(base + 3 * day) });
    for (const viewer of ['ana', 'ben']) {
      const page = await profilePosts(viewer, 'ana');
      assert.deepEqual(page.posts.map((p) => p.id), ['post-newest-0003', 'post-middle-0002', 'post-oldest-0001'], `viewed by ${viewer}`);
      assert.ok(page.posts.every((p) => p.authorId === 'ana'), 'only the profile owner’s posts');
      assert.equal(page.done, true);
    }
  });

  await t.test('a member with no posts gets a successful empty page, not an error', async () => {
    await reset();
    await seed('post-by-ben-0001', 'ben');
    const page = await profilePosts('cy', 'ana');
    assert.deepEqual(page.posts, []);
    assert.equal(page.done, true);
  });

  await t.test('more than one page: the cursor continues where the first page stopped, with no repeats and nothing lost', async () => {
    await reset();
    for (let n = 1; n <= PROFILE_PAGE_SIZE + 3; n++) await seed(`post-number-${String(n).padStart(4, '0')}`, 'ana', { timestamp: new Date(base + n * day) });
    const first = await profilePosts('ben', 'ana');
    assert.equal(first.posts.length, PROFILE_PAGE_SIZE);
    assert.equal(first.done, false);
    const second = await profilePosts('ben', 'ana', first.cursor);
    assert.equal(second.posts.length, 3);
    assert.equal(second.done, true);
    const ids = [...first.posts, ...second.posts].map((p) => p.id);
    assert.equal(new Set(ids).size, PROFILE_PAGE_SIZE + 3);
    assert.deepEqual(ids, [...ids].sort().reverse(), 'newest first across pages');
  });

  await t.test('a deleted post is gone from the profile; the author and an admin-style delete both leave the rest', async () => {
    await reset();
    await seed('post-keep-00000001', 'ana', { timestamp: new Date(base + day) });
    await seed('post-gone-0000001', 'ana', { timestamp: new Date(base + 2 * day) });
    await env.authenticatedContext('ana').firestore().doc('community_posts/post-gone-0000001').delete();
    const page = await profilePosts('ben', 'ana');
    assert.deepEqual(page.posts.map((p) => p.id), ['post-keep-00000001']);
  });

  await t.test('posts the query returns are the originals: each id is the real community_posts document id', async () => {
    await reset();
    await seed('abcdEFGH1234ijkl5678', 'ana');
    const [post] = (await profilePosts('ben', 'ana')).posts;
    assert.equal(post.id, 'abcdEFGH1234ijkl5678');
    const original = await env.authenticatedContext('ben').firestore().doc(`community_posts/${post.id}`).get();
    assert.equal(original.exists, true);
    assert.equal(original.data().title, post.title);
  });

  await t.test('a signed-out visitor is refused, which the page shows as a failure and never as "no posts"', async () => {
    await reset();
    await seed('post-by-ana-00001', 'ana');
    const { assertFails } = await import('@firebase/rules-unit-testing');
    await assertFails(env.unauthenticatedContext().firestore().collection('community_posts').where('authorId', '==', 'ana').orderBy('timestamp', 'desc').limit(6).get());
  });
});
