// The resumable reconcile scan: more posts than one run can handle, the cursor kept between runs, interruption and retry,
// wraparound, and the guarantee that a partly finished scan never writes a wrong total.
// Each test starts from an empty emulator database. Run with --test-concurrency=1.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

test('Stardust reconcile cursor', { skip }, async (t) => {
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { reconcileStardust, CURSOR_PATH, STUCK_RUNS } = await import('../../api/_stardust-reconcile.js');
  const { reconcileFully } = await import('./stardust-reconcile-helper.js');
  const instanceA = await import('../../api/_stardust.js?cursor-a');
  const { verifyStardust } = await import('../../scripts/migrate-stardust.mjs');
  const db = getFirestore(getAdminApp());

  const wipe = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  let seq = 0;
  const member = async (prefix = 'member') => {
    const uid = `${prefix}-${String(++seq).padStart(4, '0')}`;
    await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
    await db.doc(`users/${uid}/public/profile`).set({ displayName: uid, pronouns: 'she/her', profileComplete: true });
    return uid;
  };
  const post = (collection, id, authorId, stardustCount) => db.doc(`${collection}/${id}`).set({
    authorId, title: 't', content: 'c', category: 'general', tags: [], likes: 0, replyCount: 0, timestamp: Timestamp.now(), ...(stardustCount === undefined ? {} : { stardustCount }),
  });
  const total = async (uid) => (await db.doc(`stardust_totals/${uid}`).get()).data()?.total;
  const cursorDoc = async () => (await db.doc(CURSOR_PATH).get()).data();
  /** A clock that moves a fixed step on every reading, so a run's time budget lasts a predictable number of steps. */
  const stepClock = (step) => { let now = 0; return () => (now += step); };
  const small = () => ({ pageSize: 4, concurrency: 2, budgetMs: 5000, now: stepClock(500) });

  await t.test('more authors than one run can settle: several runs, the cursor kept between them, every author covered', async () => {
    await wipe();
    const authors = [];
    for (let i = 0; i < 30; i++) { const a = await member('author'); authors.push(a); await post('community_posts', `cp-${String(i).padStart(3, '0')}`, a, 1); await db.doc(`stardust_totals/${a}`).set({ total: 99 }); }
    for (let i = 0; i < 10; i++) await post('looking_for_posts', `${authors[i]}_dating`, authors[i], 2); // these authors are on both lists
    const orphans = [];
    for (let i = 0; i < 5; i++) { const a = await member('gone'); orphans.push(a); await db.doc(`stardust_totals/${a}`).set({ total: 7 }); } // posts all deleted

    const reports = [];
    for (let run = 0; run < 60; run++) {
      const before = await cursorDoc();
      const report = await reconcileStardust(db, small());
      reports.push(report);
      assert.deepEqual(report.errors, []);
      if (before) assert.deepEqual(report.startedAt, { phase: before.phase, after: before.after }, 'a run starts exactly where the saved cursor says');
      const saved = await cursorDoc();
      assert.deepEqual({ phase: saved.phase, after: saved.after, cycle: saved.cycle }, report.cursor, 'the cursor is persisted');
      if (report.startedAtBeginning && report.cycleComplete) break;
    }
    assert.ok(reports.length > 3, `one run could not do it all (${reports.length} runs)`);
    assert.ok(reports.some((r) => r.truncated && !r.cycleComplete), 'runs stopped early for time');
    assert.ok(reports.slice(1).some((r) => !r.startedAtBeginning), 'later runs resumed in the middle');
    for (let i = 0; i < 10; i++) assert.equal(await total(authors[i]), 3);
    for (let i = 10; i < 30; i++) assert.equal(await total(authors[i]), 1);
    for (const a of orphans) assert.equal(await total(a), 0, 'authors whose posts are all gone are covered too');
    const v = await verifyStardust(db);
    assert.deepEqual(v.totalMismatches, []);
  });

  await t.test('a partly finished scan never writes a total built from some of the posts', async () => {
    await wipe();
    const x = await member('author');
    // x has 12 posts spread over many pages among 24 other authors' posts, and 3 on Looking For: the true total is 15.
    for (let i = 0; i < 36; i++) await post('community_posts', `cp-${String(i).padStart(3, '0')}`, i % 3 === 0 ? x : await member('other'), 1);
    for (let i = 0; i < 3; i++) await post('looking_for_posts', `x-lf-${i}`, x, 1);
    await db.doc(`stardust_totals/${x}`).set({ total: 99 });
    const seen = new Set();
    for (let run = 0; run < 80; run++) {
      const report = await reconcileStardust(db, { pageSize: 3, concurrency: 1, budgetMs: 3500, now: stepClock(500) });
      seen.add(await total(x));
      if (report.startedAtBeginning && report.cycleComplete) break;
    }
    assert.deepEqual([...seen].filter((v) => v !== 99 && v !== 15), [], `only the old value or the true value was ever stored (saw ${[...seen].join(', ')})`);
    assert.equal(await total(x), 15);
  });

  await t.test('wraparound: after the end the cursor returns to the start, and repeated runs change nothing that is correct', async () => {
    await wipe();
    const a = await member('author'); const fan = await member('fan');
    await post('community_posts', 'cpost-001', a, undefined);
    await instanceA.setStardust(db, fan, { postType: 'community', postId: 'cpost-001', give: true });
    const first = await reconcileStardust(db);
    assert.equal(first.cycleComplete, true);
    assert.deepEqual(first.cursor, { phase: 0, after: null, cycle: 1 });
    const stamp = (await db.doc(`stardust_totals/${a}`).get()).data();
    const second = await reconcileStardust(db);
    assert.equal(second.startedAtBeginning, true, 'the next run starts again from the beginning');
    assert.equal(second.cycleComplete, true);
    assert.equal(second.repaired, 0);
    assert.equal(second.cursor.cycle, 2);
    const third = await reconcileStardust(db);
    assert.equal(third.repaired, 0);
    const now = (await db.doc(`stardust_totals/${a}`).get()).data();
    assert.deepEqual(now, stamp, 'the total document was not written again');
  });

  await t.test('a dry run reports from the beginning, writes nothing, and leaves the saved cursor alone', async () => {
    await wipe();
    const a = await member('author'); const fan = await member('fan');
    await post('community_posts', 'cpost-001', a, undefined);
    await instanceA.setStardust(db, fan, { postType: 'community', postId: 'cpost-001', give: true });
    await db.doc(`stardust_totals/${a}`).set({ total: 9 });
    await db.doc(CURSOR_PATH).set({ phase: 1, after: 'zzz', cycle: 4, stuckAuthor: null, stuckRuns: 0 });
    const report = await reconcileStardust(db, { dryRun: true });
    assert.equal(report.startedAtBeginning, true);
    assert.ok(report.discrepancies.some((d) => d.authorId === a && d.was === 9 && d.now === 1));
    assert.equal(await total(a), 9);
    assert.deepEqual({ ...(await cursorDoc()), updatedAt: undefined }, { phase: 1, after: 'zzz', cycle: 4, stuckAuthor: null, stuckRuns: 0, updatedAt: undefined });
  });

  await t.test('an unreadable cursor means "start from the beginning"', async () => {
    await wipe();
    const a = await member('author'); const fan = await member('fan');
    await post('community_posts', 'cpost-001', a, undefined);
    await instanceA.setStardust(db, fan, { postType: 'community', postId: 'cpost-001', give: true });
    await db.doc(`stardust_totals/${a}`).set({ total: 5 });
    await db.doc(CURSOR_PATH).set({ phase: 9, after: 'a/b', cycle: 'x' });
    const report = await reconcileStardust(db);
    assert.equal(report.startedAtBeginning, true);
    assert.equal(await total(a), 1);
  });

  await t.test('an author that cannot be settled holds the cursor, is retried first, and is passed over after repeated failures', async () => {
    await wipe();
    const authors = [];
    for (let i = 0; i < 8; i++) { const a = await member('author'); authors.push(a); await post('community_posts', `cp-${String(i).padStart(3, '0')}`, a, i === 4 ? 7 : 1); await db.doc(`stardust_totals/${a}`).set({ total: 99 }); }
    const target = authors[4]; // its true total is 7, which marks it for the failing database below
    const failing = new Proxy(db, {
      get(real, prop) {
        if (prop === 'runTransaction') {
          return (fn, options) => real.runTransaction(async (tx) => {
            const out = await fn(tx);
            if (out?.changed && out.now === 7) throw new Error('disk on fire');
            return out;
          }, options);
        }
        const value = real[prop];
        return typeof value === 'function' ? value.bind(real) : value;
      },
    });
    const opts = { pageSize: 20 };
    const run1 = await reconcileStardust(failing, opts);
    assert.equal(run1.failed, 1);
    assert.equal(run1.cycleComplete, false);
    assert.equal((await cursorDoc()).after, 'cp-003', 'the cursor stops just before the post of the author that failed');
    for (const [i, a] of authors.entries()) if (i !== 4) assert.equal(await total(a), 1, 'the others were settled meanwhile');
    assert.equal(await total(target), 99, 'the failed author was not touched');

    for (let n = 2; n <= STUCK_RUNS; n++) await reconcileStardust(failing, opts);
    assert.equal((await cursorDoc()).stuckRuns, STUCK_RUNS);

    // Now the author is passed over for this cycle, so the cycle can finish (and is reported), and the next cycle settles it.
    const passed = await reconcileStardust(db, opts);
    assert.deepEqual(passed.skippedStuck, [target]);
    assert.equal(passed.cycleComplete, true);
    assert.equal(await total(target), 99, 'skipped, not guessed');
    const next = await reconcileFully(db, opts);
    assert.equal(next.cycleComplete, true);
    assert.equal(await total(target), 7, 'the next cycle settles it');
    assert.equal((await cursorDoc()).stuckAuthor, null);
  });

  await t.test('a run that is interrupted after its work but before saving the cursor is simply repeated', async () => {
    await wipe();
    const a = await member('author'); const fan = await member('fan');
    await post('community_posts', 'cpost-001', a, undefined);
    await instanceA.setStardust(db, fan, { postType: 'community', postId: 'cpost-001', give: true });
    await db.doc(`stardust_totals/${a}`).set({ total: 40 });
    let dropped = 0;
    const flaky = new Proxy(db, {
      get(real, prop) {
        if (prop === 'doc') {
          return (path) => {
            const ref = real.doc(path);
            if (path !== CURSOR_PATH) return ref;
            return new Proxy(ref, { get(r, p) { if (p === 'set' && dropped++ === 0) return async () => { throw new Error('process died before saving'); }; const v = r[p]; return typeof v === 'function' ? v.bind(r) : v; } });
          };
        }
        const value = real[prop];
        return typeof value === 'function' ? value.bind(real) : value;
      },
    });
    await assert.rejects(() => reconcileStardust(flaky), /process died before saving/);
    assert.equal(await total(a), 1, 'the work itself was done');
    assert.equal(await cursorDoc(), undefined, 'but the cursor was not advanced');
    const again = await reconcileStardust(db);
    assert.equal(again.repaired, 0, 'repeating the work changes nothing');
    assert.equal(again.cycleComplete, true);
    assert.equal(await total(a), 1);
  });

  await t.test('give and remove during a paged reconcile are never overwritten', async () => {
    await wipe();
    const author = await member('author');
    const posts = ['cpost-001', 'cpost-002', 'cpost-003'];
    for (const id of posts) await post('community_posts', id, author, undefined);
    await db.doc(`stardust_totals/${author}`).set({ total: 40 });
    const fans = [];
    for (let i = 0; i < 15; i++) fans.push(await member('fan'));
    const gives = fans.map((f, i) => instanceA.setStardust(db, f, { postType: 'community', postId: posts[i % 3], give: true }));
    const removes = fans.slice(0, 5).map((f, i) => new Promise((r) => setTimeout(r, 30)).then(() => instanceA.setStardust(db, f, { postType: 'community', postId: posts[i % 3], give: false })));
    const runs = [reconcileStardust(db, { pageSize: 2, concurrency: 2 }), new Promise((r) => setTimeout(r, 40)).then(() => reconcileStardust(db, { pageSize: 2, concurrency: 2 }))];
    const settled = await Promise.allSettled([...gives, ...removes, ...runs]);
    const hard = settled.filter((r) => r.status === 'rejected');
    assert.equal(hard.length, 0, hard.map((h) => h.reason?.message).join(' | '));
    const last = await reconcileFully(db, { pageSize: 2, concurrency: 2 });
    assert.deepEqual(last.errors, []);
    const counts = await Promise.all(posts.map(async (id) => (await db.doc(`community_posts/${id}`).get()).data().stardustCount ?? 0));
    const docs = await Promise.all(posts.map(async (id) => (await db.collection(`community_posts/${id}/stardust`).get()).size));
    assert.deepEqual(counts, docs);
    assert.equal(await total(author), docs.reduce((a, b) => a + b, 0));
  });
});
