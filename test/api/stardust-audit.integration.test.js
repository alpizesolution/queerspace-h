// Pre-deployment audit scenarios for Stardust, against the Auth and Firestore emulators: the migration racing live
// reactions, rollback safety, one author total across both post types, and load on one hot post.
// Run with --test-concurrency=1: the files share one emulator database.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

test('Stardust audit', { skip }, async (t) => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { migrateStardust, rollbackStardust, verifyStardust } = await import('../../scripts/migrate-stardust.mjs');
  const { setStardust } = await import('../../api/_stardust.js');
  const db = getFirestore(getAdminApp());

  let seq = 0;
  const member = async (prefix = 'member') => {
    const uid = `${prefix}-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
    await db.doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
    return uid;
  };
  const communityPost = async (authorId, likers = []) => {
    const id = `cpost-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`community_posts/${id}`).set({ authorId, title: 't', content: 'c', category: 'general', tags: [], likes: likers.length, replyCount: 0, timestamp: Timestamp.now() });
    for (const uid of likers) await db.doc(`community_posts/${id}/likes/${uid}`).set({ createdAt: Timestamp.fromMillis(1_700_000_000_000) });
    return id;
  };
  const lookingForPost = async (authorId, intention = 'dating') => {
    const id = `${authorId}_${intention}`;
    await db.doc(`looking_for_posts/${id}`).set({ authorId, intention, title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: Timestamp.now() });
    return id;
  };
  const give = (uid, postType, postId) => setStardust(db, uid, { postType, postId, give: true });
  const remove = (uid, postType, postId) => setStardust(db, uid, { postType, postId, give: false });
  const docs = async (postType, id) => (await db.collection(`${postType === 'community' ? 'community_posts' : 'looking_for_posts'}/${id}/stardust`).get()).docs;
  const ids = async (postType, id) => (await docs(postType, id)).map((d) => d.id).sort();
  const post = async (path) => (await db.doc(path).get()).data();
  const total = async (uid) => (await db.doc(`stardust_totals/${uid}`).get()).data()?.total;
  const clean = async () => {
    const v = await verifyStardust(db);
    assert.deepEqual(v.postCountMismatches, [], 'post counts match the reaction documents');
    assert.deepEqual(v.totalMismatches, [], 'author totals match the reaction documents');
  };

  await t.test('1a. a member gives Stardust before the migration reaches their legacy like: nothing is duplicated or overwritten', async () => {
    const author = await member('author'); const early = await member('early'); const legacy = await member('legacy');
    const id = await communityPost(author, [early, legacy]);
    assert.deepEqual(await give(early, 'community', id), { given: true, count: 1, changed: true });
    assert.equal(await total(author), 1);
    const before = (await db.doc(`community_posts/${id}/stardust/${early}`).get()).data();

    const report = await migrateStardust(db);
    assert.deepEqual(report.errors, []);
    assert.ok(report.reactionsAlreadyPresent >= 1, 'the report identifies the reaction that already existed');
    assert.deepEqual(await ids('community', id), [early, legacy].sort());
    assert.equal((await post(`community_posts/${id}`)).stardustCount, 2, 'counted once each');
    assert.equal(await total(author), 2, 'the author total is 2, not 3');
    const after = (await db.doc(`community_posts/${id}/stardust/${early}`).get()).data();
    assert.deepEqual(after, before, 'the newer reaction was not overwritten (no migratedFrom, same createdAt)');
    assert.equal(after.migratedFrom, undefined);
    assert.equal((await db.doc(`community_posts/${id}/stardust/${legacy}`).get()).data().migratedFrom, 'likes');
    const again = await migrateStardust(db);
    assert.equal(again.reactionsMigrated, 0);
    assert.equal(await total(author), 2);
    await clean();
  });

  await t.test('1b. migration first, then the member removes and gives again: the new reaction is theirs and is not undone', async () => {
    const author = await member('author'); const a = await member('liker'); const b = await member('liker');
    const id = await communityPost(author, [a, b]);
    await migrateStardust(db);
    assert.equal(await total(author), 2);
    assert.deepEqual(await remove(a, 'community', id), { given: false, count: 1, changed: true });
    assert.equal(await total(author), 1);
    await migrateStardust(db);
    assert.deepEqual(await ids('community', id), [b], 'a re-run does not give the removed Stardust back');
    assert.deepEqual(await give(a, 'community', id), { given: true, count: 2, changed: true });
    const mine = (await db.doc(`community_posts/${id}/stardust/${a}`).get()).data();
    assert.equal(mine.migratedFrom, undefined, 'given again by the member: not migration-owned');
    assert.equal(await total(author), 2);
    await migrateStardust(db);
    assert.equal(await total(author), 2);
    await clean();
  });

  await t.test('1c. (by design) a member who gave and then removed Stardust before the migration gets their legacy like back as Stardust', async () => {
    const author = await member('author'); const liker = await member('liker');
    const id = await communityPost(author, [liker]);
    await give(liker, 'community', id);
    await remove(liker, 'community', id);
    assert.equal(await total(author), 0);
    await migrateStardust(db);
    assert.deepEqual(await ids('community', id), [liker]);
    assert.equal(await total(author), 1);
    await clean();
  });

  await t.test('1d. the migration running at the same time as live gives and removes ends consistent, with nothing counted twice', async () => {
    const author = await member('author');
    const legacy = await Promise.all(Array.from({ length: 12 }, () => member('legacy')));
    const live = await Promise.all(Array.from({ length: 6 }, () => member('live')));
    const id = await communityPost(author, legacy);
    const lf = await lookingForPost(author);
    const work = [
      migrateStardust(db),
      ...live.map((uid) => give(uid, 'community', id)),
      ...live.slice(0, 3).map((uid) => give(uid, 'lookingFor', lf)),
      ...legacy.slice(0, 3).map((uid) => give(uid, 'community', id)),
    ];
    const results = await Promise.allSettled(work);
    const failures = results.filter((r) => r.status === 'rejected');
    // Contention may make an individual call fail; whatever happened, a re-run must repair nothing that is wrong.
    const rerun = await migrateStardust(db);
    assert.deepEqual(rerun.errors, []);
    const real = (await docs('community', id)).length;
    assert.equal((await post(`community_posts/${id}`)).stardustCount, real, 'count equals the reaction documents');
    assert.ok(real >= 12, 'every legacy like is still represented');
    assert.equal(await total(author), real + (await docs('lookingFor', lf)).length, 'one total for both post types');
    await clean();
    t.diagnostic(`1d: ${failures.length} of ${work.length} concurrent calls failed under contention`);
  });

  await t.test('2. rollback after new activity removes only migration-owned data and keeps every later reaction', async () => {
    const author = await member('author'); const other = await member('author');
    const [a, b, c, d, e] = await Promise.all(Array.from({ length: 5 }, () => member('liker')));
    const p1 = await communityPost(author, [a, b, c]);
    const p2 = await communityPost(other, [a, d]);
    const lf = await lookingForPost(author);
    await migrateStardust(db);
    // New activity after the migration: new reactions on migrated posts, one migrated reaction removed, one removed and given again.
    await give(e, 'community', p1);
    await give(d, 'community', p1);
    await give(e, 'lookingFor', lf);
    await remove(a, 'community', p1);
    await remove(c, 'community', p1);
    await give(c, 'community', p1);
    const dry = await rollbackStardust(db, { dryRun: true });
    assert.deepEqual(dry.errors, []);
    assert.deepEqual(await ids('community', p1), [b, c, d, e].sort(), 'a dry run changes nothing');

    const report = await rollbackStardust(db);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(await ids('community', p1), [c, d, e].sort(), 'only b (migration-owned and untouched) was removed; c, d, e are the members\' own');
    assert.deepEqual(await ids('community', p2), [], 'the other migrated post is back to nothing');
    assert.equal((await post(`community_posts/${p1}`)).stardustCount, 3);
    assert.equal((await post(`community_posts/${p2}`)).stardustCount, 0);
    assert.equal((await post(`community_posts/${p1}`)).stardustMigratedAt, undefined);
    assert.equal(await total(author), 3 + 1, 'three on the Community post plus one on Looking For');
    assert.equal(await total(other), 0);
    assert.deepEqual(await ids('lookingFor', lf), [e]);
    // The legacy likes were never touched.
    assert.equal((await db.collection(`community_posts/${p1}/likes`).get()).size, 3);
    await clean();

    const second = await rollbackStardust(db);
    assert.equal(second.reactionsRemoved, 0, 'rolling back twice does nothing the second time');
    assert.equal(await total(author), 4);
    await clean();
  });

  await t.test('3. Community and Looking For both feed one author total, exactly once per give and per remove', async () => {
    const author = await member('author');
    const fans = await Promise.all(Array.from({ length: 5 }, () => member('fan')));
    const cp = await communityPost(author);
    const lf = await lookingForPost(author);
    await Promise.all(fans.flatMap((f) => [give(f, 'community', cp), give(f, 'lookingFor', lf)]));
    assert.equal((await post(`community_posts/${cp}`)).stardustCount, 5);
    assert.equal((await post(`looking_for_posts/${lf}`)).stardustCount, 5);
    assert.equal(await total(author), 10);
    await Promise.all(fans.slice(0, 2).flatMap((f) => [remove(f, 'community', cp), remove(f, 'lookingFor', lf), remove(f, 'community', cp)]));
    assert.equal(await total(author), 6);
    assert.equal((await db.collection('stardust_totals').where('total', '>=', 0).get()).docs.filter((d) => d.id === author).length, 1);
    await clean();
  });

  await t.test('4. a missing or damaged total is handled safely, and verify reports it', async () => {
    const author = await member('author'); const fan = await member('fan');
    const cp = await communityPost(author);
    await db.doc(`stardust_totals/${author}`).delete();
    assert.equal((await give(fan, 'community', cp)).changed, true, 'no crash without a total document');
    assert.equal(await total(author), 1);
    await db.doc(`stardust_totals/${author}`).set({ total: 'not a number' });
    assert.equal((await remove(fan, 'community', cp)).changed, true);
    assert.equal(await total(author), 0, 'a damaged total restarts from 0 and never goes negative');
    await db.doc(`stardust_totals/${author}`).set({ total: 7 });
    const v = await verifyStardust(db);
    assert.ok(v.totalMismatches.some((m) => m.authorId === author && m.total === 7), 'verify flags a total that does not match');
    await db.doc(`stardust_totals/${author}`).set({ total: 0 });
  });

  await t.test('5. one hot post: many members at once all succeed and the numbers agree', async () => {
    const author = await member('author');
    const cp = await communityPost(author);
    const fans = await Promise.all(Array.from({ length: 40 }, () => member('fan')));
    const started = Date.now();
    const results = await Promise.allSettled(fans.map((f) => give(f, 'community', cp)));
    const elapsed = Date.now() - started;
    const failed = results.filter((r) => r.status === 'rejected');
    const real = (await docs('community', cp)).length;
    assert.equal((await post(`community_posts/${cp}`)).stardustCount, real);
    assert.equal(await total(author), real);
    assert.equal(real, 40 - failed.length);
    t.diagnostic(`5: 40 simultaneous gives on one post: ${40 - failed.length} succeeded, ${failed.length} failed, ${elapsed} ms in total`);
    assert.ok(failed.length === 0, `${failed.length} of 40 failed: ${failed.slice(0, 2).map((f) => f.reason?.message).join(' | ')}`);
    await clean();
  });

  await t.test('5b. one author with four posts all getting Stardust at once: no aborted transactions and matching numbers', async () => {
    const author = await member('author');
    const posts = await Promise.all(Array.from({ length: 4 }, () => communityPost(author)));
    const fans = await Promise.all(Array.from({ length: 40 }, () => member('fan')));
    const started = Date.now();
    const results = await Promise.allSettled(fans.map((f, i) => give(f, 'community', posts[i % 4])));
    const failed = results.filter((r) => r.status === 'rejected');
    t.diagnostic(`5b: 40 gives over 4 posts of one author: ${40 - failed.length} ok, ${failed.length} failed, ${Date.now() - started} ms`);
    assert.equal(failed.length, 0, failed.slice(0, 2).map((f) => f.reason?.message).join(' | '));
    assert.equal(await total(author), 40);
    await clean();
  });

});
