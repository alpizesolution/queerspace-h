// Stardust follows active posts: deleting a post drops its Stardust from the author's total, a re-posted Looking For post
// starts from zero and cannot inherit or be blocked by old reactions, and the daily reconcile is safe to repeat and to run
// next to live give/remove. Run with --test-concurrency=1 (the files share one emulator database).
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

test('Stardust lifecycle', { skip }, async (t) => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { setStardust, givenAmong } = await import('../../api/_stardust.js');
  const { reconcileFully: reconcileStardust } = await import('./stardust-reconcile-helper.js');
  const { migrateStardust, rollbackStardust, verifyStardust } = await import('../../scripts/migrate-stardust.mjs');
  const db = getFirestore(getAdminApp());

  let seq = 0;
  const member = async (prefix = 'member') => {
    const uid = `${prefix}-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
    await db.doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
    return uid;
  };
  const communityPost = async (authorId) => {
    const id = `cpost-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`community_posts/${id}`).set({ authorId, title: 't', content: 'c', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: Timestamp.now() });
    return id;
  };
  const lfBase = (authorId, intention) => ({ authorId, intention, title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null });
  const lookingForPost = async (authorId, intention = 'dating') => {
    const id = `${authorId}_${intention}`;
    await db.doc(`looking_for_posts/${id}`).set({ ...lfBase(authorId, intention), timestamp: Timestamp.now() });
    return id;
  };
  const give = (uid, postType, postId) => setStardust(db, uid, { postType, postId, give: true });
  const remove = (uid, postType, postId) => setStardust(db, uid, { postType, postId, give: false });
  const total = async (uid) => (await db.doc(`stardust_totals/${uid}`).get()).data()?.total;
  const col = (type) => (type === 'community' ? 'community_posts' : 'looking_for_posts');
  const countOf = async (type, id) => (await db.doc(`${col(type)}/${id}`).get()).data()?.stardustCount;
  const reactionIds = async (type, id) => (await db.collection(`${col(type)}/${id}/stardust`).get()).docs.map((d) => d.id).sort();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const consistent = async () => {
    const v = await verifyStardust(db);
    assert.deepEqual(v.postCountMismatches, []);
    assert.deepEqual(v.totalMismatches, []);
  };

  for (const type of ['community', 'lookingFor']) {
    await t.test(`${type}: deleting a post with Stardust removes it from the author's total at the next reconcile, and the post cannot take more`, async () => {
      const author = await member('author');
      const [a, b, c] = await Promise.all([member('fan'), member('fan'), member('fan')]);
      const keep = await communityPost(author);
      const doomed = type === 'community' ? await communityPost(author) : await lookingForPost(author);
      await give(a, 'community', keep);
      await give(a, type, doomed); await give(b, type, doomed); await give(c, type, doomed);
      assert.equal(await total(author), 4);

      await db.doc(`${col(type)}/${doomed}`).delete(); // a plain client delete: nothing server-side sees it
      assert.equal(await total(author), 4, 'until the reconcile runs the total still includes it');
      assert.equal((await give(b, type, doomed).catch((e) => e)).statusCode, 404, 'a deleted post cannot receive Stardust');
      assert.equal((await remove(a, type, doomed).catch((e) => e)).statusCode, 404, 'nor give it back');

      const report = await reconcileStardust(db);
      assert.deepEqual(report.errors, []);
      assert.equal(report.repaired >= 1, true);
      assert.ok(report.discrepancies.some((d) => d.authorId === author && d.was === 4 && d.now === 1));
      assert.equal(await total(author), 1, 'only the Stardust on the post that still exists');
      assert.equal(await countOf('community', keep), 1, 'the surviving post\'s own count is preserved');
      await consistent();
    });
  }

  await t.test('a Looking For post written again with the same id starts at zero; old reactions neither count nor block', async () => {
    const author = await member('author');
    const [old, bystander, fresh] = await Promise.all([member('fan'), member('fan'), member('fan')]);
    const id = await lookingForPost(author);
    await give(old, 'lookingFor', id);
    await give(bystander, 'lookingFor', id);
    assert.equal(await countOf('lookingFor', id), 2);
    assert.equal(await total(author), 2);

    await db.doc(`looking_for_posts/${id}`).delete();
    await wait(25);
    await lookingForPost(author); // same document id, a new post
    const reborn = (await db.doc(`looking_for_posts/${id}`).get()).data();
    assert.equal(reborn.stardustCount, undefined, 'the new post starts with no Stardust');
    assert.equal((await reactionIds('lookingFor', id)).length, 2, 'the old reaction documents are still physically there');

    // They are not shown as given, and not counted.
    assert.deepEqual(await givenAmong(db, old, { postType: 'lookingFor', postIds: [id] }), { given: [] });
    const v = await verifyStardust(db);
    assert.equal(v.staleReactionDocs >= 2, true, 'verify sees them as left over, not as part of the new post');
    assert.deepEqual(v.postCountMismatches, []);

    // A member with an old reaction can react to the new post: the old record does not block or double count.
    assert.deepEqual(await give(old, 'lookingFor', id), { given: true, count: 1, changed: true });
    assert.deepEqual(await givenAmong(db, old, { postType: 'lookingFor', postIds: [id] }), { given: [id] });
    assert.deepEqual(await give(old, 'lookingFor', id), { given: true, count: 1, changed: false }, 'and once again is still one');
    assert.deepEqual(await give(fresh, 'lookingFor', id), { given: true, count: 2, changed: true });
    // An old reaction cannot be used to take away a point that was never given to the new post.
    assert.deepEqual(await remove(bystander, 'lookingFor', id), { given: false, count: 2, changed: false });
    assert.deepEqual(await reactionIds('lookingFor', id), [fresh, old].sort(), 'the leftover record of the bystander was cleared by that remove');
    assert.equal(await countOf('lookingFor', id), 2);

    const report = await reconcileStardust(db);
    assert.deepEqual(report.errors, []);
    assert.equal(await total(author), 2, 'two on the new post, nothing carried from the old one');
    await consistent();
  });

  await t.test('running the reconcile again changes nothing', async () => {
    const author = await member('author'); const fan = await member('fan');
    const id = await communityPost(author);
    await give(fan, 'community', id);
    await db.doc(`stardust_totals/${author}`).set({ total: 50 });
    const first = await reconcileStardust(db);
    assert.ok(first.discrepancies.some((d) => d.authorId === author && d.was === 50 && d.now === 1));
    assert.equal(await total(author), 1);
    const stamp = (await db.doc(`stardust_totals/${author}`).get()).data().reconciledAt.toMillis();
    const second = await reconcileStardust(db);
    assert.equal(second.cycleComplete, true);
    assert.equal(second.repaired, 0);
    assert.equal((await db.doc(`stardust_totals/${author}`).get()).data().reconciledAt.toMillis(), stamp, 'no write at all');
  });

  await t.test('it does not trust the existing totals: a missing, damaged or inflated total is rebuilt from the live posts', async () => {
    const [missing, damaged, inflated, none] = await Promise.all([member('author'), member('author'), member('author'), member('author')]);
    const fan = await member('fan');
    for (const author of [missing, damaged, inflated]) await give(fan, 'community', await communityPost(author));
    await db.doc(`stardust_totals/${missing}`).delete();
    await db.doc(`stardust_totals/${damaged}`).set({ total: 'many' });
    await db.doc(`stardust_totals/${inflated}`).set({ total: 12 });
    await db.doc(`stardust_totals/${none}`).set({ total: 3 }); // an author with no posts at all
    const report = await reconcileStardust(db);
    assert.deepEqual(report.errors, []);
    for (const author of [missing, damaged, inflated]) assert.equal(await total(author), 1);
    assert.equal(await total(none), 0);
    await consistent();
  });

  await t.test('a dry run reports the repairs and writes nothing', async () => {
    const author = await member('author'); const fan = await member('fan');
    await give(fan, 'community', await communityPost(author));
    await db.doc(`stardust_totals/${author}`).set({ total: 9 });
    const report = await reconcileStardust(db, { dryRun: true });
    assert.equal(report.mode, 'dry-run');
    assert.ok(report.discrepancies.some((d) => d.authorId === author && d.was === 9 && d.now === 1));
    assert.equal(await total(author), 9);
    await reconcileStardust(db);
  });

  await t.test('the reconcile running while members give and remove never overwrites their activity', async () => {
    const author = await member('author');
    const posts = await Promise.all([communityPost(author), communityPost(author), lookingForPost(author)]);
    const types = ['community', 'community', 'lookingFor'];
    const fans = await Promise.all(Array.from({ length: 18 }, () => member('fan')));
    // Start from a wrong total so every reconcile pass has something to repair, while live traffic changes the truth.
    await db.doc(`stardust_totals/${author}`).set({ total: 40 });
    const live = fans.map((f, i) => give(f, types[i % 3], posts[i % 3]));
    const removals = fans.slice(0, 6).map((f, i) => wait(30).then(() => remove(f, types[i % 3], posts[i % 3])));
    const runs = [reconcileStardust(db), wait(60).then(() => reconcileStardust(db))];
    const settled = await Promise.allSettled([...live, ...removals, ...runs]);
    const hardFailures = settled.filter((r) => r.status === 'rejected');
    assert.equal(hardFailures.length, 0, hardFailures.map((f) => f.reason?.message).join(' | '));
    // Whatever was deferred under contention is settled by the next run, and then everything agrees.
    const last = await reconcileStardust(db);
    assert.deepEqual(last.errors, []);
    const counts = await Promise.all(posts.map((id, i) => countOf(types[i], id)));
    const reactions = (await Promise.all(posts.map((id, i) => reactionIds(types[i], id)))).map((r) => r.length);
    assert.deepEqual(counts.map((c) => c ?? 0), reactions, 'each post count equals its reaction documents');
    assert.equal(await total(author), counts.reduce((a, b) => a + (b ?? 0), 0));
    await consistent();
  });

  await t.test('several reconcile runs at the same time (a double-fired schedule) agree and leave correct totals', async () => {
    const authors = await Promise.all(Array.from({ length: 4 }, () => member('author')));
    const fan = await member('fan');
    for (const author of authors) { await give(fan, 'community', await communityPost(author)); await db.doc(`stardust_totals/${author}`).set({ total: 30 }); }
    const reports = await Promise.all([reconcileStardust(db), reconcileStardust(db), reconcileStardust(db)]);
    for (const report of reports) assert.deepEqual(report.errors, []);
    for (const author of authors) assert.equal(await total(author), 1);
    await consistent();
  });

  await t.test('Community and Looking For deletions follow the same rule in one total', async () => {
    const author = await member('author'); const fan = await member('fan');
    const cp = await communityPost(author);
    const lf = await lookingForPost(author);
    await give(fan, 'community', cp); await give(fan, 'lookingFor', lf);
    assert.equal(await total(author), 2);
    await db.doc(`community_posts/${cp}`).delete();
    await reconcileStardust(db);
    assert.equal(await total(author), 1);
    await db.doc(`looking_for_posts/${lf}`).delete();
    await reconcileStardust(db);
    assert.equal(await total(author), 0);
  });

  await t.test('the daily cron endpoint runs the reconcile without changing its own answer', async () => {
    const { default: cleanup } = await import('../../api/media-cleanup.js');
    const media = await import('../../api/_media.js');
    media.setMediaStoreForTests({});
    process.env.CRON_SECRET = 'cron-secret-for-the-stardust-test';
    const author = await member('author'); const fan = await member('fan');
    await give(fan, 'community', await communityPost(author));
    await db.doc(`stardust_totals/${author}`).set({ total: 77 });
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await cleanup({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { due: 0, deleted: 0, failed: 0 });
    assert.equal(await total(author), 1, 'repaired by the scheduled run');
    const denied = { ...res, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await cleanup({ method: 'GET', headers: {}, query: {} }, denied);
    assert.equal(denied.statusCode, 401);
    media.setMediaStoreForTests(null);
  });

  await t.test('migration and rollback still work with the live-posts policy', async () => {
    const author = await member('author');
    const likers = await Promise.all([member('liker'), member('liker'), member('liker')]);
    const id = `cpost-mig-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`community_posts/${id}`).set({ authorId: author, title: 't', content: 'c', category: 'general', tags: [], likes: 3, replyCount: 0, timestamp: Timestamp.now() });
    for (const uid of likers) await db.doc(`community_posts/${id}/likes/${uid}`).set({ createdAt: Timestamp.now() });
    const mig = await migrateStardust(db);
    assert.deepEqual(mig.errors, []);
    assert.equal(await total(author), 3);
    await reconcileStardust(db);
    assert.equal(await total(author), 3, 'the reconcile agrees with the migration');
    const extra = await member('fan');
    await give(extra, 'community', id);
    const rb = await rollbackStardust(db);
    assert.deepEqual(rb.errors, []);
    assert.deepEqual(await reactionIds('community', id), [extra]);
    assert.equal(await total(author), 1);
    await reconcileStardust(db);
    assert.equal(await total(author), 1, 'the reconcile agrees with the rollback');
    await consistent();
  });
});
