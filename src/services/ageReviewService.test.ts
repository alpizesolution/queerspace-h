import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/** The real watch/grant code with only the Firestore SDK and the Firebase app replaced. (--experimental-test-module-mocks) */
type Listener = (snap: { exists: () => boolean }) => void;
let listener: Listener | null = null;
let unsubscribed = 0;
const events: string[] = [];
let deleteFails = false;
let grantFails = false;
const written: Array<{ path: string; data: Record<string, unknown> }> = [];
let signedInAs: { uid: string } | null = { uid: 'locked-member' };
let sessionRestored = true;

const realFirestore = await import('firebase/firestore');
mock.module('firebase/firestore', {
  namedExports: {
    ...realFirestore,
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    onSnapshot: (ref: { path: string }, next: Listener) => { events.push(`listen ${ref.path}`); listener = next; return () => { unsubscribed++; }; },
    deleteDoc: async (ref: { path: string }) => { events.push(`delete ${ref.path}`); if (deleteFails) throw Object.assign(new Error('nope'), { code: 'permission-denied' }); },
    setDoc: async (ref: { path: string }, data: Record<string, unknown>) => { if (grantFails) throw new Error('denied'); written.push({ path: ref.path, data }); },
    serverTimestamp: () => 'SERVER_TIME',
  },
});
const realFirebase = await import('../lib/firebase.ts');
mock.module('../lib/firebase.ts', {
  namedExports: {
    ...realFirebase,
    isFirebaseConfigured: true,
    db: {},
    auth: { get currentUser() { return sessionRestored ? signedInAs : null; } },
    ensureAnonymousAuth: async () => signedInAs,
  },
});

const { watchAgeReviewClearance, grantAgeReviewClearance } = await import('./ageReviewService.ts');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const reset = () => { listener = null; unsubscribed = 0; events.length = 0; deleteFails = false; grantFails = false; written.length = 0; signedInAs = { uid: 'locked-member' }; sessionRestored = true; };

test('the locked member listens to their own clearance, and nothing happens until one exists', async () => {
  reset();
  let cleared = 0;
  watchAgeReviewClearance(() => { cleared++; });
  await tick();
  assert.deepEqual(events, ['listen age_review_clearances/locked-member'], 'only their own document');
  listener?.({ exists: () => false });
  await tick();
  assert.equal(cleared, 0);
  assert.deepEqual(events, ['listen age_review_clearances/locked-member'], 'nothing deleted either');
});

test('a clearance is used up (deleted) first and unlocks exactly once, even if the update arrives twice', async () => {
  reset();
  let cleared = 0;
  watchAgeReviewClearance(() => { cleared++; });
  await tick();
  listener?.({ exists: () => true });
  listener?.({ exists: () => true });
  await tick();
  assert.equal(cleared, 1);
  assert.deepEqual(events.filter((e) => e.startsWith('delete')), ['delete age_review_clearances/locked-member'], 'one delete');
});

test('if the clearance cannot be used up, nothing is unlocked (so it cannot be reused over and over)', async () => {
  reset();
  deleteFails = true;
  let cleared = 0;
  watchAgeReviewClearance(() => { cleared++; });
  await tick();
  listener?.({ exists: () => true });
  await tick();
  assert.equal(cleared, 0);
  deleteFails = false;
  listener?.({ exists: () => true });
  await tick();
  assert.equal(cleared, 1, 'the next update can still succeed');
});

test('stopping the watcher stops listening, also if it is stopped while sign-in is still being restored', async () => {
  reset();
  const stop = watchAgeReviewClearance(() => {});
  await tick();
  stop();
  assert.equal(unsubscribed, 1, 'a running listener is stopped');

  reset();
  sessionRestored = false; // the app is still restoring the member's sign-in, so the watcher has to wait for it
  watchAgeReviewClearance(() => {})();
  await tick();
  assert.deepEqual(events, [], 'stopped before it started: it never listens');
});

test('the admin grant writes the member\'s clearance signed with the admin and the report, and reports failure honestly', async () => {
  reset();
  signedInAs = { uid: 'admin-1' };
  assert.equal(await grantAgeReviewClearance('locked-member', 'report-9'), true);
  assert.deepEqual(written, [{ path: 'age_review_clearances/locked-member', data: { clearedBy: 'admin-1', clearedAt: 'SERVER_TIME', reportId: 'report-9' } }]);

  reset();
  signedInAs = { uid: 'admin-1' };
  grantFails = true;
  assert.equal(await grantAgeReviewClearance('locked-member'), false);

  reset();
  signedInAs = null;
  assert.equal(await grantAgeReviewClearance('locked-member'), false, 'not signed in, nothing written');
  assert.equal(written.length, 0);
});
