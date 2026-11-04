// Stardust under several "server instances" at once (separate copies of the module have their own in-process queues, like
// separate serverless instances), lost commit answers, reconcile failures and time limits. The emulator cannot reproduce
// production lock timing; these tests prove the numbers stay correct and that nothing is left half-written.
// Run with --test-concurrency=1 (the files share one emulator database).
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

test('Stardust concurrency and failure handling', { skip }, async (t) => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const instanceA = await import('../../api/_stardust.js?instance-a');
  const instanceB = await import('../../api/_stardust.js?instance-b');
  const { reconcileStardust } = await import('../../api/_stardust-reconcile.js');
  const { reconcileFully } = await import('./stardust-reconcile-helper.js');
  const { migrateStardust, verifyStardust } = await import('../../scripts/migrate-stardust.mjs');
  const db = getFirestore(getAdminApp());

  let seq = 0;
  const member = async (prefix = 'member') => {
    const uid = `${prefix}-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
    await db.doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
    return uid;
  };
  const communityPost = async (authorId, extra = {}) => {
    const id = `cpost-${++seq}-${Date.now().toString(36)}`;
    await db.doc(`community_posts/${id}`).set({ authorId, title: 't', content: 'c', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: Timestamp.now(), ...extra });
    return id;
  };
  const total = async (uid) => (await db.doc(`stardust_totals/${uid}`).get()).data()?.total;
  const reactionIds = async (id) => (await db.collection(`community_posts/${id}/stardust`).get()).docs.map((d) => d.id);
  const countOf = async (id) => (await db.doc(`community_posts/${id}`).get()).data()?.stardustCount;
  const clean = async () => {
    const v = await verifyStardust(db);
    assert.deepEqual(v.postCountMismatches, []);
    assert.deepEqual(v.totalMismatches, []);
  };
  /** A database whose transactions behave badly on purpose. */
  const flaky = (real, { afterCommit, beforeCommit } = {}) => new Proxy(real, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return async (fn, options) => {
          const result = await target.runTransaction(async (tx) => {
            const out = await fn(tx);
            if (beforeCommit) await beforeCommit(out);
            return out;
          }, options);
          if (afterCommit) afterCommit(result);
          return result;
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  await t.test('give, remove and reconcile from three separate instances at once lose no update and leave nothing half-written', async () => {
    const author = await member('author');
    const posts = await Promise.all([communityPost(author), communityPost(author), communityPost(author)]);
    const fans = await Promise.all(Array.from({ length: 30 }, () => member('fan')));
    await db.doc(`stardust_totals/${author}`).set({ total: 25 }); // wrong on purpose, so every reconcile has work
    const mods = [instanceA, instanceB];
    const act = (i, give) => mods[i % 2].setStardust(db, fans[i], { postType: 'community', postId: posts[i % 3], give });
    const gives = fans.map((_, i) => act(i, true));
    const removes = fans.slice(0, 10).map((_, i) => new Promise((r) => setTimeout(r, 40)).then(() => act(i, false)));
    const reconciles = [reconcileFully(db), new Promise((r) => setTimeout(r, 50)).then(() => reconcileFully(db))];
    const settled = await Promise.allSettled([...gives, ...removes, ...reconciles]);
    const rejected = settled.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'rejected');
    t.diagnostic(`cross-instance run: ${rejected.length} of ${settled.length} operations ended in a retryable error (nothing applied for those)`);
    // A failed operation must not have changed anything: a failed give leaves no reaction behind.
    for (const { r, i } of rejected) {
      assert.match(String(r.reason?.message), /ABORTED|lock timeout|contention|DEADLINE|UNAVAILABLE/i, 'only retryable errors');
      if (i < fans.length) {
        const mine = (await Promise.all(posts.map((p) => reactionIds(p)))).flat().includes(fans[i]);
        // either the give never applied, or (a remove that failed after a give) the reaction is the earlier give's
        assert.ok(!mine || i < 10, 'a failed give left no reaction');
      }
    }
    const last = await reconcileFully(db);
    assert.deepEqual(last.errors, []);
    const counts = await Promise.all(posts.map(countOf));
    const docs = await Promise.all(posts.map(async (p) => (await reactionIds(p)).length));
    assert.deepEqual(counts.map((c) => c ?? 0), docs, 'every post count equals its reaction documents');
    assert.equal(await total(author), docs.reduce((a, b) => a + b, 0));
    await clean();
  });

  await t.test('a commit whose answer is lost is retried without counting twice', async () => {
    const author = await member('author'); const fan = await member('fan');
    const id = await communityPost(author);
    let lost = 1;
    const db2 = flaky(db, { afterCommit: (out) => { if (out && 'given' in out && lost-- > 0) throw Object.assign(new Error('14 UNAVAILABLE: connection reset'), { code: 14 }); } });
    const res = await instanceA.setStardust(db2, fan, { postType: 'community', postId: id, give: true });
    assert.equal(res.given, true);
    assert.equal(res.count, 1, 'counted once, however many attempts');
    assert.equal(await countOf(id), 1);
    assert.equal(await total(author), 1);
    assert.deepEqual(await reactionIds(id), [fan]);
    lost = 1;
    const back = await instanceA.setStardust(db2, fan, { postType: 'community', postId: id, give: false });
    assert.equal(back.given, false);
    assert.equal(await countOf(id), 0);
    assert.equal(await total(author), 0, 'and removed once');
  });

  await t.test('a transaction that fails before it commits leaves nothing behind, and the same call works afterwards', async () => {
    const author = await member('author'); const fan = await member('fan');
    const id = await communityPost(author);
    // Only the Stardust transaction is broken (the rate-limit transaction before it is left alone).
    const broken = flaky(db, { beforeCommit: (out) => { if (out && 'given' in out) throw new Error('boom before commit'); } });
    await assert.rejects(() => instanceA.setStardust(broken, fan, { postType: 'community', postId: id, give: true }), /boom before commit/);
    assert.deepEqual(await reactionIds(id), []);
    assert.equal(await countOf(id), undefined);
    assert.equal(await total(author), undefined);
    assert.equal((await instanceA.setStardust(db, fan, { postType: 'community', postId: id, give: true })).count, 1);
  });

  await t.test('a reconcile that is deferred or fails changes nothing, and the next run repairs it', async () => {
    const author = await member('author'); const fan = await member('fan');
    await instanceA.setStardust(db, fan, { postType: 'community', postId: await communityPost(author), give: true });
    await db.doc(`stardust_totals/${author}`).set({ total: 9 });

    const aborting = flaky(db, { beforeCommit: () => { throw Object.assign(new Error('10 ABORTED: too much contention'), { code: 10 }); } });
    const deferred = await reconcileStardust(aborting, { retryBudgetMs: 0 });
    assert.ok(deferred.deferred >= 1, 'reported as deferred');
    assert.equal(deferred.failed, 0);
    assert.equal(await total(author), 9, 'nothing was written');

    const failing = flaky(db, { beforeCommit: () => { throw new Error('disk on fire'); } });
    const failed = await reconcileStardust(failing);
    assert.ok(failed.failed >= 1);
    assert.ok(failed.errors.some((e) => e.authorId === author));
    assert.equal(await total(author), 9, 'nothing was written');

    const next = await reconcileFully(db);
    assert.deepEqual(next.errors, []);
    assert.equal(next.deferred, 0);
    assert.equal(await total(author), 1, 'the next run repairs it');
  });

  await t.test('the time budget is respected: an out-of-time run stops cleanly, and later runs finish the job', async () => {
    const authors = await Promise.all(Array.from({ length: 6 }, () => member('author')));
    const fan = await member('fan');
    for (const a of authors) { await instanceA.setStardust(db, fan, { postType: 'community', postId: await communityPost(a), give: true }); await db.doc(`stardust_totals/${a}`).set({ total: 50 }); }
    let clock = 0;
    const slow = await reconcileStardust(db, { budgetMs: 5000, now: () => (clock += 1200) });
    assert.equal(slow.truncated, true);
    assert.deepEqual(slow.errors, []);
    // Whatever it did settle is right; whatever it did not reach is untouched (never a half-computed number).
    for (const a of authors) assert.ok([50, 1].includes(await total(a)), 'a total is either left alone or correct');
    const rest = await reconcileFully(db);
    assert.equal(rest.cycleComplete, true);
    for (const a of authors) assert.equal(await total(a), 1);
  });

  await t.test('an author with a very large number of posts is summed on the server in one cheap read', async () => {
    const author = await member('author');
    let batch = db.batch(); let n = 0;
    for (let i = 0; i < 1500; i++) {
      batch.set(db.doc(`community_posts/bulk-${seq}-${i}`), { authorId: author, title: 't', content: 'c', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: Timestamp.now(), stardustCount: i % 3 === 0 ? 2 : 0 });
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    const expected = 500 * 2;
    const started = Date.now();
    const report = await reconcileFully(db);
    t.diagnostic(`reconcile with a 1500-post author: ${Date.now() - started} ms in ${report.runs} run(s)`);
    assert.deepEqual(report.errors, []);
    assert.equal(await total(author), expected);
    assert.equal((await reconcileFully(db)).repaired, 0);
  });

  await t.test('reconcile before the migration, then the migration, then reconcile: the total is right at every step', async () => {
    const author = await member('author');
    const [l1, l2, live] = await Promise.all([member('liker'), member('liker'), member('fan')]);
    const id = await communityPost(author, { likes: 2 });
    for (const uid of [l1, l2]) await db.doc(`community_posts/${id}/likes/${uid}`).set({ createdAt: Timestamp.now() });
    await instanceA.setStardust(db, live, { postType: 'community', postId: id, give: true });
    assert.equal(await total(author), 1);
    await reconcileFully(db);
    assert.equal(await total(author), 1, 'legacy likes are not counted before they are migrated');
    const mig = await migrateStardust(db);
    assert.deepEqual(mig.errors, []);
    assert.equal(await countOf(id), 3);
    assert.equal(await total(author), 3);
    assert.equal((await reconcileFully(db)).repaired, 0, 'the reconcile agrees with the migration');
    assert.equal((await migrateStardust(db)).reactionsMigrated, 0);
    await clean();
  });
});
