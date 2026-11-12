// Account linking against the Auth emulator, with the real service: linking a permanent sign-in to an anonymous account keeps the
// uid (so Signals conversations stay reachable), collisions change nothing, and signing in elsewhere returns the same uid.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;

let counter = 0;
/** One "device": its own app and its own sign-in session, like a separate browser. */
async function device() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const app = initializeApp({ apiKey: 'fake-key', projectId: process.env.GCLOUD_PROJECT, authDomain: 'localhost' }, `device-${Date.now()}-${counter += 1}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const anonymous = async () => (await signInAnonymously(auth)).user;
  return { auth, anonymous };
}

const email = () => `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

test('linking an email to an anonymous account keeps the SAME uid, and that email signs in to the same uid on another device', { skip }, async () => {
  const { linkEmailPassword, signInToSavedAccount, accountStatus } = await import('../../src/services/accountLinking.ts');
  const one = await device();
  const anon = await one.anonymous();
  assert.equal(accountStatus(anon).anonymous, true);
  const address = email();
  const linked = await linkEmailPassword(one.auth, address, 'correct-horse-9');
  assert.equal(linked.ok, true);
  assert.equal(linked.uid, anon.uid, 'the uid did not change');
  assert.ok(linked.providers.includes('password'));
  assert.equal(accountStatus(one.auth.currentUser).anonymous, false);
  // A different device (no session at all) signs in with the saved account and is the same member.
  const two = await device();
  const back = await signInToSavedAccount(two.auth, { kind: 'password', email: address, password: 'correct-horse-9' });
  assert.equal(back.ok, true);
  assert.equal(back.uid, anon.uid, 'the same uid, so the same conversations');
});

test('conversations stay reachable after linking and after signing in again: the server sees the same member', { skip }, async () => {
  const { linkEmailPassword, signInToSavedAccount } = await import('../../src/services/accountLinking.ts');
  const { default: handler } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const one = await device();
  const anon = await one.anonymous();
  const partner = await device();
  const partnerUser = await partner.anonymous();
  const pairId = `pair-link-${Date.now()}`;
  await db.doc(`signalsPairs/${pairId}`).set({ participants: [anon.uid, partnerUser.uid].sort(), status: 'active', createdAt: new Date() });
  await db.doc(`signalsPairs/${pairId}/messages/msg-link-0001`).set({ senderId: partnerUser.uid, text: 'before linking', createdAt: new Date(), updatedAt: new Date() });
  const read = async (auth) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method: 'GET', headers: { authorization: `Bearer ${await auth.currentUser.getIdToken(true)}` }, query: { view: 'messages', pairId, limit: '50' } }, res);
    return res;
  };
  assert.equal((await read(one.auth)).body.messages[0].text, 'before linking');
  const address = email();
  assert.equal((await linkEmailPassword(one.auth, address, 'secret-pass-1')).ok, true);
  assert.equal((await read(one.auth)).body.messages[0].text, 'before linking', 'still readable right after linking');
  const fresh = await device();
  await signInToSavedAccount(fresh.auth, { kind: 'password', email: address, password: 'secret-pass-1' });
  const again = await read(fresh.auth);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.messages[0].text, 'before linking', 'and from a new device');
  const list = await (async () => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method: 'GET', headers: { authorization: `Bearer ${await fresh.auth.currentUser.getIdToken()}` }, query: { view: 'pairs', limit: '20' } }, res);
    return res;
  })();
  assert.deepEqual(list.body.pairs.map((p) => p.id), [pairId], 'the inbox lists it');
});

test('an email already used by another account is refused: nothing changes, the current uid stays, and nothing is merged', { skip }, async () => {
  const { linkEmailPassword } = await import('../../src/services/accountLinking.ts');
  const first = await device();
  const firstUser = await first.anonymous();
  const address = email();
  assert.equal((await linkEmailPassword(first.auth, address, 'secret-pass-1')).ok, true);
  const second = await device();
  const secondUser = await second.anonymous();
  const collision = await linkEmailPassword(second.auth, address, 'another-pass-2');
  assert.deepEqual(collision, { ok: false, reason: 'collision' });
  assert.equal(second.auth.currentUser.uid, secondUser.uid, 'the second member is still themselves');
  assert.equal(second.auth.currentUser.isAnonymous, true, 'and still anonymous: nothing was linked or merged');
  assert.equal(first.auth.currentUser.uid, firstUser.uid, 'the first account is untouched');
});

test('signing in to a saved account is explicit and changes the uid; a wrong password and a weak password are refused with nothing changed', { skip }, async () => {
  const { linkEmailPassword, signInToSavedAccount } = await import('../../src/services/accountLinking.ts');
  const saved = await device();
  const savedUser = await saved.anonymous();
  const address = email();
  await linkEmailPassword(saved.auth, address, 'secret-pass-1');
  const other = await device();
  const otherUser = await other.anonymous();
  assert.deepEqual(await linkEmailPassword(other.auth, email(), '123'), { ok: false, reason: 'weak-password' });
  assert.deepEqual(await linkEmailPassword(other.auth, 'not-an-email', 'secret-pass-1'), { ok: false, reason: 'invalid-email' });
  assert.equal(other.auth.currentUser.uid, otherUser.uid);
  const wrong = await signInToSavedAccount(other.auth, { kind: 'password', email: address, password: 'wrong-password' });
  assert.deepEqual(wrong, { ok: false, reason: 'invalid-credential' });
  assert.equal(other.auth.currentUser.uid, otherUser.uid, 'a failed sign-in leaves the current session alone');
  const switched = await signInToSavedAccount(other.auth, { kind: 'password', email: address, password: 'secret-pass-1' });
  assert.equal(switched.uid, savedUser.uid, 'only the explicit, correct sign-in switches, and to that account only');
});

test('an account that is already saved cannot be linked again, and nobody signed in is refused politely', { skip }, async () => {
  const { linkEmailPassword } = await import('../../src/services/accountLinking.ts');
  const one = await device();
  await one.anonymous();
  await linkEmailPassword(one.auth, email(), 'secret-pass-1');
  assert.deepEqual(await linkEmailPassword(one.auth, email(), 'secret-pass-1'), { ok: false, reason: 'not-anonymous' });
  const none = await device();
  assert.deepEqual(await linkEmailPassword(none.auth, email(), 'secret-pass-1'), { ok: false, reason: 'not-signed-in' });
});

test('a Google credential links to an anonymous account with the SAME uid (the emulator accepts a test Google token), and a second account cannot take it', { skip }, async () => {
  // The popup itself needs a browser, so this uses the same Firebase linking call with a test Google credential. It proves what
  // Firebase does with the uid; the popup wrapper is covered by a unit test with the popup call replaced.
  const { GoogleAuthProvider, linkWithCredential } = await import('firebase/auth');
  const token = JSON.stringify({ sub: `google-${Date.now()}`, email: email(), email_verified: true });
  const one = await device();
  const anon = await one.anonymous();
  const linked = await linkWithCredential(one.auth.currentUser, GoogleAuthProvider.credential(token));
  assert.equal(linked.user.uid, anon.uid, 'the uid did not change');
  assert.ok(linked.user.providerData.some((p) => p.providerId === 'google.com'));
  const two = await device();
  const other = await two.anonymous();
  await assert.rejects(linkWithCredential(two.auth.currentUser, GoogleAuthProvider.credential(token)), (error) => ['auth/credential-already-in-use', 'auth/email-already-in-use', 'auth/account-exists-with-different-credential'].includes(error.code));
  assert.equal(two.auth.currentUser.uid, other.uid, 'the failed link left the second session as it was');
  assert.equal(two.auth.currentUser.isAnonymous, true);
});
