import test from 'node:test';
import assert from 'node:assert/strict';
import { accountStatus, linkFailureFor, linkProblemText, requestDurableStorage, type LinkFailure } from './accountLinking.ts';

test('every way an account can already exist is a collision: it is refused and never merged', () => {
  for (const code of ['auth/email-already-in-use', 'auth/credential-already-in-use', 'auth/account-exists-with-different-credential']) {
    assert.equal(linkFailureFor({ code }), 'collision', code);
  }
});

test('other Firebase errors map to a reason the screen can explain', () => {
  assert.equal(linkFailureFor({ code: 'auth/weak-password' }), 'weak-password');
  assert.equal(linkFailureFor({ code: 'auth/invalid-email' }), 'invalid-email');
  assert.equal(linkFailureFor({ code: 'auth/wrong-password' }), 'invalid-credential');
  assert.equal(linkFailureFor({ code: 'auth/invalid-credential' }), 'invalid-credential');
  assert.equal(linkFailureFor({ code: 'auth/popup-closed-by-user' }), 'cancelled');
  assert.equal(linkFailureFor({ code: 'auth/network-request-failed' }), 'unavailable');
  assert.equal(linkFailureFor({ code: 'auth/operation-not-allowed' }), 'unavailable');
  assert.equal(linkFailureFor({ code: 'something/else' }), 'failed');
  assert.equal(linkFailureFor(null), 'failed');
});

test('the words never promise that a lost anonymous account can be recovered, and a collision says nothing was changed', () => {
  const reasons: LinkFailure[] = ['collision', 'weak-password', 'invalid-email', 'invalid-credential', 'cancelled', 'not-anonymous', 'not-signed-in', 'unavailable', 'failed'];
  for (const reason of reasons) {
    const text = linkProblemText(reason);
    assert.ok(text.length > 10, reason);
    assert.ok(!/recover(ed)? your (old|lost)|will be restored|we can restore/i.test(text), `${reason}: no recovery promise`);
  }
  assert.match(linkProblemText('collision'), /nothing was changed/i);
});

test('account status: anonymous until a permanent sign-in is linked', () => {
  assert.deepEqual(accountStatus(null), { signedIn: false, anonymous: false, providers: [], email: null });
  assert.equal(accountStatus({ isAnonymous: true, providerData: [], email: null } as never).anonymous, true);
  const linked = accountStatus({ isAnonymous: false, providerData: [{ providerId: 'password' }], email: 'a@b.test' } as never);
  assert.equal(linked.anonymous, false);
  assert.deepEqual(linked.providers, ['password']);
  assert.equal(linked.email, 'a@b.test');
  // Linked but Firebase still reports the flag for a moment: a provider means it is saved.
  assert.equal(accountStatus({ isAnonymous: true, providerData: [{ providerId: 'google.com' }], email: null } as never).anonymous, false);
});

test('durable storage is requested once, accepted if already granted, and a refusal or an error is only "false"', async () => {
  let asked = 0;
  assert.equal(await requestDurableStorage({ persist: async () => { asked += 1; return true; }, persisted: async () => false }), true);
  assert.equal(asked, 1);
  assert.equal(await requestDurableStorage({ persist: async () => { asked += 1; return true; }, persisted: async () => true }), true);
  assert.equal(asked, 1, 'already persisted: not asked again');
  assert.equal(await requestDurableStorage({ persist: async () => false, persisted: async () => false }), false);
  assert.equal(await requestDurableStorage({ persist: async () => { throw new Error('no'); }, persisted: async () => false }), false);
  assert.equal(await requestDurableStorage(undefined), false);
});
