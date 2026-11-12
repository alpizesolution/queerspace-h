import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/** The Google path of account linking, with Firebase's popup calls replaced (a popup needs a browser). */
let linkCalls: unknown[] = [];
let linkError: unknown = null;
let signInCalls = 0;
mock.module('firebase/auth', {
  namedExports: {
    EmailAuthProvider: { credential: () => ({}) },
    GoogleAuthProvider: class {},
    linkWithCredential: async () => { throw new Error('unused'); },
    linkWithPopup: async (user: { uid: string }, provider: unknown) => {
      linkCalls.push([user.uid, provider]);
      if (linkError) throw linkError;
      return { user: { ...user, providerData: [{ providerId: 'google.com' }] } };
    },
    signInWithEmailAndPassword: async () => { signInCalls += 1; return { user: { uid: 'x', providerData: [] } }; },
    signInWithPopup: async () => { signInCalls += 1; return { user: { uid: 'saved', providerData: [{ providerId: 'google.com' }] } }; },
  },
});
const { linkGoogle, signInToSavedAccount } = await import('./accountLinking.ts');

const anonymousAuth = { currentUser: { uid: 'anon-uid', isAnonymous: true, providerData: [] } } as never;

test('Google linking calls the link function on the CURRENT anonymous user (so the uid is kept) and never signs in', async () => {
  linkCalls = []; linkError = null; signInCalls = 0;
  const result = await linkGoogle(anonymousAuth);
  assert.deepEqual(result, { ok: true, uid: 'anon-uid', providers: ['google.com'] });
  assert.equal(linkCalls.length, 1);
  assert.equal((linkCalls[0] as [string])[0], 'anon-uid');
  assert.equal(signInCalls, 0, 'linking never signs in (which would replace the uid)');
});

test('a Google account that already belongs to someone is a refused collision: no sign-in, no merge', async () => {
  linkCalls = []; linkError = Object.assign(new Error('x'), { code: 'auth/credential-already-in-use' }); signInCalls = 0;
  assert.deepEqual(await linkGoogle(anonymousAuth), { ok: false, reason: 'collision' });
  assert.equal(signInCalls, 0, 'the other account\'s credential is not used to sign in');
});

test('closing the popup, a blocked popup and no session are reported without touching the session', async () => {
  linkError = Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' });
  assert.deepEqual(await linkGoogle(anonymousAuth), { ok: false, reason: 'cancelled' });
  linkError = Object.assign(new Error('x'), { code: 'auth/popup-blocked' });
  assert.deepEqual(await linkGoogle(anonymousAuth), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await linkGoogle({ currentUser: null } as never), { ok: false, reason: 'not-signed-in' });
  assert.deepEqual(await linkGoogle({ currentUser: { uid: 'u', isAnonymous: false, providerData: [] } } as never), { ok: false, reason: 'not-anonymous' });
});

test('signing in to a saved Google account is a separate, explicit call', async () => {
  signInCalls = 0; linkError = null;
  assert.deepEqual(await signInToSavedAccount(anonymousAuth, { kind: 'google' }), { ok: true, uid: 'saved', providers: ['google.com'] });
  assert.equal(signInCalls, 1);
});
