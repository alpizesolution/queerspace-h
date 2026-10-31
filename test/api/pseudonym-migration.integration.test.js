// The migration against the emulator: preview writes nothing, apply fixes only real duplicates and touches nothing else.
// Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;

async function load() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const migration = await import('../../scripts/migrate-pseudonyms.mjs');
  return { db: getFirestore(getAdminApp()), ...migration };
}
const profile = (db, uid, displayName, ageMs) =>
  db.doc(`users/${uid}/public/profile`).set({
    displayName, pronouns: 'she/her', intention: 'open', region: 'x', topics: ['a'], profileComplete: true, avatar: 'cat.1.2',
    createdAt: Timestamp.fromMillis(Date.now() - ageMs), updatedAt: Timestamp.fromMillis(1000),
  });

test('preview writes nothing; apply renames only the newer duplicates and registers everyone', { skip }, async () => {
  const { db, loadProfiles, loadClaims, planMigration, applyPlan } = await load();
  await profile(db, 'oldest', 'VelvetMuse', 3000);
  await profile(db, 'newer', 'velvet muse', 2000);
  await profile(db, 'newest', 'VELVETMUSE', 1000);
  await profile(db, 'unique', 'Lavender Lark', 500);
  await db.doc('conversations/c1').set({ participants: ['oldest', 'newer'], status: 'active' });
  await db.doc('conversations/c1/messages/m1').set({ text: 'hi', senderId: 'newer' });

  // Audit and plan are read-only.
  const plan = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(plan.totals.duplicateGroups, 1);
  assert.equal(plan.totals.accountsToRename, 2);
  assert.equal((await db.collection('pseudonyms').get()).size, 0);
  assert.equal((await db.doc('users/newer/public/profile').get()).data().displayName, 'velvet muse');

  const before = (await db.doc('users/newer/public/profile').get()).data();
  await applyPlan(db, plan);

  const names = Object.fromEntries(await Promise.all(['oldest', 'newer', 'newest', 'unique'].map(async (uid) => [uid, (await db.doc(`users/${uid}/public/profile`).get()).data()])));
  assert.equal(names.oldest.displayName, 'VelvetMuse');
  assert.equal(names.unique.displayName, 'Lavender Lark');
  assert.notEqual(names.newer.displayName, 'velvet muse');
  assert.notEqual(names.newest.displayName, 'VELVETMUSE');
  // Nothing but displayName and updatedAt changed on a renamed profile.
  const { displayName: _d, updatedAt: _u, ...restBefore } = before;
  const { displayName: _d2, updatedAt: _u2, ...restAfter } = names.newer;
  assert.deepEqual(restAfter, restBefore);
  // History is untouched.
  assert.equal((await db.doc('conversations/c1/messages/m1').get()).data().text, 'hi');
  assert.deepEqual((await db.doc('conversations/c1').get()).data().participants, ['oldest', 'newer']);

  // Everyone is registered once, with a distinct key, pointing at the right account.
  const claims = await db.collection('pseudonyms').get();
  assert.equal(claims.size, 4);
  for (const uid of ['oldest', 'newer', 'newest', 'unique']) {
    const owner = (await db.doc(`pseudonymOwners/${uid}`).get()).data();
    assert.equal((await db.doc(`pseudonyms/${owner.key}`).get()).data().uid, uid);
    assert.equal(owner.name, names[uid].displayName);
  }

  // A second run has nothing to do.
  const again = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(again.totals.accountsToRename, 0);
  assert.equal(again.totals.toRegister, 0);
});

test('never overwrites a reservation made after the plan was drawn up', { skip }, async () => {
  const { db, loadProfiles, loadClaims, planMigration, applyPlan } = await load();
  await profile(db, 'legacyA', 'Soft Frog', 3000);
  await profile(db, 'legacyB', 'soft_frog', 2000);
  await profile(db, 'legacyC', 'Plain Owl', 1000);
  const plan = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(plan.rename.length, 1);
  const target = plan.rename[0];
  const keeperKey = plan.keep.find((k) => k.name === 'Soft Frog').key;

  // After the plan, a new member reserves the exact name legacyB was going to receive, and another takes legacyA's and legacyC's.
  await db.doc(`pseudonyms/${target.toKey}`).set({ uid: 'newcomer', name: target.to });
  await db.doc('pseudonyms/softfrog').set({ uid: 'someoneElse', name: 'SoftFrog' });
  await db.doc('pseudonyms/plainowl').set({ uid: 'another', name: 'Plain Owl' });

  const result = await applyPlan(db, plan);
  assert.equal(result.renamed, 0);
  assert.equal(result.registered, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal((await db.doc(`pseudonyms/${target.toKey}`).get()).data().uid, 'newcomer');
  assert.equal((await db.doc('pseudonyms/softfrog').get()).data().uid, 'someoneElse');
  assert.equal((await db.doc('pseudonyms/plainowl').get()).data().uid, 'another');
  assert.equal((await db.doc('users/legacyB/public/profile').get()).data().displayName, 'soft_frog');
  assert.equal(keeperKey, 'softfrog');

  // A profile changed since the plan is not renamed either.
  await db.doc(`pseudonyms/${target.toKey}`).delete();
  await db.doc('users/legacyB/public/profile').update({ displayName: 'Brand New' });
  const stale = await applyPlan(db, { register: [], rename: [target] });
  assert.equal(stale.renamed, 0);
  assert.equal((await db.doc('users/legacyB/public/profile').get()).data().displayName, 'Brand New');
});

test('an interrupted run resumes: finished accounts stay finished and the rest complete on re-run', { skip }, async () => {
  const { db, loadProfiles, loadClaims, planMigration, applyPlan } = await load();
  for (let i = 0; i < 6; i++) await profile(db, `dup${i}`, 'Cozy Witch', 6000 - i * 100);
  await profile(db, 'solo', 'Tender Otter', 100);
  const plan = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(plan.rename.length, 5);

  // Simulate a crash after part of the work: apply only 2 renames and the registrations.
  await applyPlan(db, { register: plan.register, rename: plan.rename.slice(0, 2) });
  const mid = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(mid.rename.length, 3);

  // Re-running the whole original plan is safe too: done entries are skipped, nothing is duplicated.
  const replay = await applyPlan(db, plan);
  assert.equal(replay.renamed, 3);
  const after = planMigration(await loadProfiles(db), await loadClaims(db));
  assert.equal(after.totals.duplicateGroups, 0);
  assert.equal(after.totals.accountsToRename, 0);
  assert.equal(after.totals.toRegister, 0);
  const names = (await db.collectionGroup('public').get()).docs.map((d) => d.data().displayName.toLowerCase().replace(/[^a-z]/g, ''));
  assert.equal(new Set(names).size, names.length);
});

test('the script refuses to write without the matching project id', { skip }, async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (...extra) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-pseudonyms.mjs', ...extra], { encoding: 'utf8', env: process.env });
  const noConfirm = run('--apply');
  assert.notEqual(noConfirm.status, 0);
  assert.match(noConfirm.stderr, /Refusing to write/);
  const wrong = run('--apply', '--confirm', 'some-other-project');
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /Refusing to write/);
  const audit = run();
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /Read-only run: nothing was written/);
  // The audit output carries counts and public pseudonyms only.
  assert.doesNotMatch(audit.stdout, /birth|token|private_key/i);
});
