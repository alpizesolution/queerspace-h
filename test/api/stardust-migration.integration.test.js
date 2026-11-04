// The likes -> Stardust migration against the emulators: dry-run, the real run, idempotency, preserved history, the
// unified author total (with Looking For Stardust earned live), no resurrection after a removal, rollback and verify.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

test('Stardust migration', { skip }, async (t) => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { migrateStardust, rollbackStardust, verifyStardust, planPost } = await import('../../scripts/migrate-stardust.mjs');
  const { setStardust } = await import('../../api/_stardust.js');
  const db = getFirestore(getAdminApp());

  const member = async (uid) => {
    await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
    await db.doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
  };
  const post = async (id, authorId, likers, extra = {}) => {
    await db.doc(`community_posts/${id}`).set({ authorId, title: 't', content: 'c', category: 'general', tags: [], likes: likers.length, replyCount: 0, timestamp: Timestamp.now(), ...extra });
    for (const uid of likers) await db.doc(`community_posts/${id}/likes/${uid}`).set({ createdAt: Timestamp.fromMillis(1_700_000_000_000) });
  };
  for (const uid of ['alice-author', 'bob-author', 'liker-one', 'liker-two', 'liker-three', 'liker-four']) await member(uid);

  // p1: 3 honest likes. p2: counter says 99 but there is 1 real like. p3: the author liked their own post, plus 1 real like.
  // p4: another author's. p5: no likes at all. lf1: a Looking For post with no history.
  await post('postaaa1', 'alice-author', ['liker-one', 'liker-two', 'liker-three']);
  await post('postaaa2', 'alice-author', ['liker-one'], { likes: 99 });
  await post('postaaa3', 'alice-author', ['alice-author', 'liker-four']);
  await post('postbbb4', 'bob-author', ['liker-one', 'liker-two']);
  await post('postbbb5', 'bob-author', []);
  await db.doc('looking_for_posts/alice-author_dating').set({ authorId: 'alice-author', intention: 'dating', title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: Timestamp.now() });
  const snapshotOfLikes = async () => Object.fromEntries(await Promise.all(['postaaa1', 'postaaa2', 'postaaa3', 'postbbb4', 'postbbb5'].map(async (id) => [id, {
    counter: (await db.doc(`community_posts/${id}`).get()).data().likes,
    docs: (await db.collection(`community_posts/${id}/likes`).get()).docs.map((d) => d.id).sort(),
  }])));
  const likesBefore = await snapshotOfLikes();
  const stardustDocs = async (id) => (await db.collection(`community_posts/${id}/stardust`).get()).docs.map((d) => d.id).sort();
  const totalOf = async (uid) => (await db.doc(`stardust_totals/${uid}`).get()).data()?.total;

  await t.test('the plan counts real like documents only and skips the author\'s own', () => {
    const plan = planPost({ post: { authorId: 'a', likes: 50 }, likes: [{ id: 'a' }, { id: 'x' }, { id: 'y' }, { id: '' }], existing: [{ id: 'y' }] });
    assert.equal(plan.actual, 2);
    assert.equal(plan.selfLikes, 1);
    assert.equal(plan.invalid.length, 1);
    assert.deepEqual(plan.toCreate.map((l) => l.id), ['x']);
    assert.equal(plan.delta, 2);
    assert.equal(planPost({ post: {}, likes: [], existing: [] }).skip, 'no_author');
  });

  await t.test('a dry run reports what would happen and writes nothing', async () => {
    const report = await migrateStardust(db, { dryRun: true });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.postsProcessed, 5);
    assert.equal(report.postsMigrated, 5);
    assert.equal(report.reactionsMigrated, 7);
    assert.equal(report.selfLikesSkipped, 1);
    assert.equal(report.authorsUpdated, 2);
    assert.deepEqual(report.errors, []);
    assert.equal((await db.collection('stardust_totals').get()).size, 0);
    assert.deepEqual(await stardustDocs('postaaa1'), []);
    assert.equal((await db.doc('community_posts/postaaa1').get()).data().stardustCount, undefined);
  });

  await t.test('the real run creates one reaction per liker, sets counts from the documents and totals per author', async () => {
    // Looking For Stardust earned live before the migration is part of the same single total.
    await setStardust(db, 'liker-one', { postType: 'lookingFor', postId: 'alice-author_dating', give: true });
    assert.equal(await totalOf('alice-author'), 1);

    const report = await migrateStardust(db);
    assert.equal(report.mode, 'migrate');
    assert.equal(report.postsMigrated, 5);
    assert.equal(report.reactionsMigrated, 7);
    assert.equal(report.selfLikesSkipped, 1);
    assert.equal(report.authorsUpdated, 2);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.counterDiscrepancies, [{ postId: 'postaaa2', oldLikesCounter: 99, realLikeDocuments: 1 }]);

    assert.deepEqual(await stardustDocs('postaaa1'), ['liker-one', 'liker-three', 'liker-two']);
    assert.deepEqual(await stardustDocs('postaaa3'), ['liker-four'], 'the author\'s own like is not a reaction');
    const counts = Object.fromEntries(await Promise.all(['postaaa1', 'postaaa2', 'postaaa3', 'postbbb4', 'postbbb5'].map(async (id) => [id, (await db.doc(`community_posts/${id}`).get()).data().stardustCount])));
    assert.deepEqual(counts, { postaaa1: 3, postaaa2: 1, postaaa3: 1, postbbb4: 2, postbbb5: 0 });
    // alice: 3 + 1 + 1 from Community plus 1 live on Looking For = 6, one total. bob: 2.
    assert.equal(await totalOf('alice-author'), 6);
    assert.equal(await totalOf('bob-author'), 2);
    const doc = (await db.doc('community_posts/postaaa1/stardust/liker-one').get()).data();
    assert.equal(doc.uid, 'liker-one');
    assert.equal(doc.postType, 'community');
    assert.equal(doc.authorId, 'alice-author');
    assert.equal(doc.migratedFrom, 'likes');
    assert.equal(doc.createdAt.toMillis(), 1_700_000_000_000, 'the original time of the appreciation is kept');
  });

  await t.test('the old likes documents and counters are preserved exactly', async () => {
    assert.deepEqual(await snapshotOfLikes(), likesBefore);
  });

  await t.test('running it again changes nothing (no duplicate reactions, no duplicate points)', async () => {
    const before = { a: await totalOf('alice-author'), b: await totalOf('bob-author'), docs: await stardustDocs('postaaa1') };
    const report = await migrateStardust(db);
    assert.equal(report.postsAlreadyMigrated, 5);
    assert.equal(report.postsMigrated, 0);
    assert.equal(report.reactionsMigrated, 0);
    assert.deepEqual(report.errors, []);
    assert.equal(await totalOf('alice-author'), before.a);
    assert.equal(await totalOf('bob-author'), before.b);
    assert.deepEqual(await stardustDocs('postaaa1'), before.docs);
  });

  await t.test('a migrated member can remove their Stardust, and a re-run does not give it back', async () => {
    const res = await setStardust(db, 'liker-one', { postType: 'community', postId: 'postaaa1', give: false });
    assert.deepEqual(res, { given: false, count: 2, changed: true });
    assert.equal(await totalOf('alice-author'), 5);
    await migrateStardust(db);
    assert.deepEqual(await stardustDocs('postaaa1'), ['liker-three', 'liker-two']);
    assert.equal(await totalOf('alice-author'), 5);
  });

  await t.test('verify finds the counts and totals consistent', async () => {
    const result = await verifyStardust(db);
    assert.deepEqual(result.postCountMismatches, []);
    assert.deepEqual(result.totalMismatches, []);
    assert.equal(result.orphanReactionDocs, 0);
    // A hand-made inconsistency is caught.
    await db.doc('community_posts/postbbb5').update({ stardustCount: 4 });
    assert.equal((await verifyStardust(db)).postCountMismatches.length, 1);
    await db.doc('community_posts/postbbb5').update({ stardustCount: 0 });
  });

  await t.test('rollback removes only what the migration created and keeps every Stardust given since', async () => {
    await setStardust(db, 'liker-two', { postType: 'community', postId: 'postbbb5', give: true }); // a new, live reaction
    const dry = await rollbackStardust(db, { dryRun: true });
    assert.equal(dry.mode, 'rollback-dry-run');
    assert.deepEqual(await stardustDocs('postaaa1'), ['liker-three', 'liker-two']);
    const report = await rollbackStardust(db);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(await stardustDocs('postaaa1'), [], 'migrated reactions are gone');
    assert.deepEqual(await stardustDocs('postbbb5'), ['liker-two'], 'a reaction given after the migration is kept');
    assert.equal((await db.doc('community_posts/postbbb5').get()).data().stardustCount, 1);
    assert.equal((await db.doc('community_posts/postaaa1').get()).data().stardustMigratedAt, undefined);
    assert.equal(await totalOf('alice-author'), 1, 'only her live Looking For Stardust remains');
    assert.equal(await totalOf('bob-author'), 1);
    assert.deepEqual(await snapshotOfLikes(), likesBefore, 'likes are still untouched');
    assert.deepEqual((await verifyStardust(db)).totalMismatches, []);
  });

  await t.test('after a rollback the migration can be run again and arrives at the same result', async () => {
    const report = await migrateStardust(db);
    assert.deepEqual(report.errors, []);
    assert.equal(await totalOf('alice-author'), 6);
    assert.equal(await totalOf('bob-author'), 3, 'two migrated plus the live one');
    assert.deepEqual((await verifyStardust(db)).totalMismatches, []);
    assert.deepEqual((await verifyStardust(db)).postCountMismatches, []);
  });
});
