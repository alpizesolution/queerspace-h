// Mandatory onboarding against the real Auth and Firestore emulators, using the app's OWN services (anonymous sign-in, name reservation,
// saveAnonymousProfile, loadAnonymousProfile): a fresh anonymous account passes the birthday step, saves its profile, and only then can
// take part. Also what the server refuses until the profile is saved. Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
// The app's own Firebase module reads these; it is pointed at the emulators below (not through its fixed local ports), never at a real project.
process.env.VITE_FIREBASE_API_KEY ||= 'fake-key-for-emulator';
process.env.VITE_FIREBASE_PROJECT_ID ||= process.env.GCLOUD_PROJECT;
process.env.VITE_FIREBASE_APP_ID ||= '1:1:web:1';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH_URL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const [FS_HOST, FS_PORT] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

let wired = null;
// The web SDK keeps connections open; close them so the run can end.
after(async () => {
  if (!wired) return;
  const { terminate } = await import('firebase/firestore');
  const { deleteApp } = await import('firebase/app');
  const { getApp } = await import('firebase/app');
  try { await terminate(wired.lib.db); await deleteApp(getApp()); } catch { /* already closed */ }
});
async function app() {
  if (wired) return wired;
  const lib = await import('../../src/lib/firebase.ts');
  const persistence = await import('../../src/services/profilePersistence.ts');
  const names = await import('../../src/services/pseudonymService.ts');
  const { connectAuthEmulator, signOut } = await import('firebase/auth');
  const { connectFirestoreEmulator, doc, getDoc, setDoc, Timestamp } = await import('firebase/firestore');
  assert.ok(lib.isFirebaseConfigured && lib.auth && lib.db, 'the app module is configured');
  connectAuthEmulator(lib.auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  connectFirestoreEmulator(lib.db, FS_HOST, Number(FS_PORT));
  const { default: pseudonymApi } = await import('../../api/pseudonym.js');
  const { default: atlasApi } = await import('../../api/atlas.js');
  const { default: signalsApi } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');
  wired = { lib, persistence, names, signOut, doc, getDoc, setDoc, Timestamp, pseudonymApi, atlasApi, signalsApi, admin: getFirestore(getAdminApp()), AdminTimestamp };
  return wired;
}

async function handle(handler, method, token, body, query) {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await handler({ method, body, query: query ?? {}, url: '/', headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}

/** The app as a brand-new visitor: no stored sign-in, no stored profile (the emulator is emptied first). */
async function freshVisitor() {
  const x = await app();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await x.signOut(x.lib.auth);
  const user = await x.lib.ensureAnonymousAuth();
  assert.ok(user?.uid, 'anonymous sign-in');
  const token = await user.getIdToken();
  const send = (body) => handle(x.pseudonymApi, 'POST', token, body).then((r) => ({ status: r.statusCode, json: async () => r.body }));
  /** What App.persistPrefs does: confirm the name with the server, then save on the device and in the cloud. */
  const persist = async (prefs, options = {}) => {
    const reserved = await x.names.reservePseudonym(prefs.displayName, { generated: options.generated === true }, send);
    assert.equal(reserved.status, 'reserved', `the name is confirmed first (${JSON.stringify(reserved)})`);
    return x.persistence.saveAnonymousProfile({ ...prefs, displayName: reserved.name }, [], true, { withBirthDate: options.withBirthDate === true });
  };
  return { ...x, user, uid: user.uid, token, persist, send };
}

const basePrefs = (over = {}) => ({ displayName: 'VelvetOrbit', pronouns: 'she/her', intention: 'open', topics: [], region: 'Anywhere / Worldwide', ...over });
const ADULT = new Date(Date.now() - 30 * YEAR).toISOString().slice(0, 10);

test('a fresh anonymous account passes the birthday step and saves its profile: every write is accepted, and a returning load sees a complete member', { skip }, async () => {
  const v = await freshVisitor();
  // Nothing in the cloud yet: a new account, not a failed read.
  const first = await v.persistence.loadAnonymousProfile();
  assert.equal(first.fromCloudSuccess, false);
  assert.equal(first.cloudError, undefined, 'no profile yet is not an error');

  // Birthday step: the same write the age gate makes (name confirmed, then profile + birthday saved).
  const age = await v.persist(basePrefs({ birthDate: ADULT, profileComplete: false }), { generated: true, withBirthDate: true });
  assert.equal(age.savedToCloud, true, `birthday write accepted (${age.userMessage})`);
  const privateAfterAge = (await v.getDoc(v.doc(v.lib.db, 'users', v.uid, 'private', 'settings'))).data();
  assert.ok(privateAfterAge.birthDate instanceof v.Timestamp, 'the birthday is stored');
  assert.ok(privateAfterAge.createdAt && privateAfterAge.updatedAt, 'with its creation stamp');
  assert.equal((await v.getDoc(v.doc(v.lib.db, 'users', v.uid, 'public', 'profile'))).data().profileComplete, false, 'not a member yet');

  // Profile step: what Save and continue does.
  const saved = await v.persist(basePrefs({ displayName: 'Moon Fern', birthDate: ADULT, aboutMe: 'Tea and rain.', profileComplete: true }));
  assert.equal(saved.savedToCloud, true, `profile write accepted (${saved.userMessage})`);
  const publicProfile = (await v.getDoc(v.doc(v.lib.db, 'users', v.uid, 'public', 'profile'))).data();
  assert.equal(publicProfile.profileComplete, true);
  assert.equal(publicProfile.displayName, 'Moon Fern');
  assert.equal(publicProfile.aboutMe, 'Tea and rain.');
  const privateAfterSave = (await v.getDoc(v.doc(v.lib.db, 'users', v.uid, 'private', 'settings'))).data();
  assert.equal(privateAfterSave.birthDate.toMillis(), privateAfterAge.birthDate.toMillis(), 'the birthday is never rewritten');
  assert.equal(privateAfterSave.createdAt.toMillis(), privateAfterAge.createdAt.toMillis(), 'nor the creation stamp');

  // Coming back: the account is complete, so no setup again.
  const again = await v.persistence.loadAnonymousProfile();
  assert.equal(again.fromCloudSuccess, true);
  assert.equal(again.prefs.profileComplete, true);
  assert.equal(again.cloudHasBirthDate, true);
  assert.equal(again.cloudDisplayName, 'Moon Fern');
});

test('the birthday-only fallback write is accepted for a fresh account, and a profile save after it still succeeds', { skip }, async () => {
  const v = await freshVisitor();
  assert.equal(await v.persistence.saveBirthDateOnly(ADULT), true);
  const doc = (await v.getDoc(v.doc(v.lib.db, 'users', v.uid, 'private', 'settings'))).data();
  assert.ok(doc.createdAt, 'the fallback creates the record with a creation stamp, so later saves are valid');
  const saved = await v.persist(basePrefs({ birthDate: ADULT, profileComplete: true }), { generated: true });
  assert.equal(saved.savedToCloud, true, saved.userMessage);
});

test('an older private record with no creation stamp (what an Admin-side or legacy write can leave) does not lock the member out of saving', { skip }, async () => {
  const v = await freshVisitor();
  // The exact state that denied every save: the birthday exists, the creation stamp does not.
  await v.admin.doc(`users/${v.uid}/private/settings`).set({ birthDate: v.AdminTimestamp.fromDate(new Date(`${ADULT}T00:00:00Z`)) });
  const saved = await v.persist(basePrefs({ birthDate: ADULT, profileComplete: true }), { generated: true });
  assert.equal(saved.savedToCloud, true, `accepted (${saved.userMessage})`);
  const stored = (await v.admin.doc(`users/${v.uid}/private/settings`).get()).data();
  assert.ok(stored.birthDate, 'birthday untouched');
  assert.equal(stored.createdAt, undefined, 'the member never has to supply a creation stamp');
});

test('until the profile is saved the server refuses to let the account act (pin, edit, request, search GIFs), and accepts it once saved', { skip }, async () => {
  const v = await freshVisitor();
  await v.persist(basePrefs({ birthDate: ADULT, profileComplete: false }), { generated: true, withBirthDate: true });
  const memory = { action: 'create', id: 'mem_onboard_0001', title: 'First light', text: 'A quiet morning.', date: '2024-06-01', lat: 14.6, lng: 120.98, placeLabel: 'Manila', visibility: 'public' };

  const early = await handle(v.atlasApi, 'POST', v.token, memory);
  assert.equal(early.statusCode, 403, 'cannot pin before the profile is saved');
  assert.equal(early.body.error, 'profile_required');
  assert.equal((await handle(v.atlasApi, 'POST', v.token, { ...memory, action: 'update' })).statusCode, 403);
  assert.equal((await handle(v.signalsApi, 'GET', v.token, undefined, { view: 'gifs' })).statusCode, 403, 'GIF search is for members who can message');
  // Browsing is still open: the map can be looked at.
  const browse = await handle(v.atlasApi, 'POST', v.token, { action: 'list', scope: 'community' });
  assert.equal(browse.statusCode, 200, 'public content stays browsable');

  await v.persist(basePrefs({ displayName: 'Moon Fern', birthDate: ADULT, profileComplete: true }));
  const created = await handle(v.atlasApi, 'POST', v.token, memory);
  assert.equal(created.statusCode, 201, `allowed once the profile is saved (${JSON.stringify(created.body)})`);
  assert.notEqual((await handle(v.signalsApi, 'GET', v.token, undefined, { view: 'gifs' })).statusCode, 403);
});

test('being an adult is still required: a saved profile without an adult birthday gets nothing', { skip }, async () => {
  const v = await freshVisitor();
  await v.admin.doc(`users/${v.uid}/public/profile`).set({ displayName: 'Minor', pronouns: 'she/her', profileComplete: true });
  await v.admin.doc(`users/${v.uid}/private/settings`).set({ birthDate: v.AdminTimestamp.fromMillis(Date.now() - 15 * YEAR) });
  const res = await handle(v.atlasApi, 'POST', v.token, { action: 'create', id: 'mem_minor_0001', title: 'x', text: 'y', date: '2024-06-01', lat: 1, lng: 1, visibility: 'public' });
  assert.equal(res.statusCode, 403);
  assert.equal((await handle(v.signalsApi, 'GET', v.token, undefined, { view: 'gifs' })).statusCode, 403);
});

test('choosing a name and the birthday API stay open to an account with no profile, because setup depends on them', { skip }, async () => {
  const v = await freshVisitor();
  const suggested = await handle(v.pseudonymApi, 'POST', v.token, { action: 'suggest', names: ['Quiet Heron', 'Soft Lantern'] });
  assert.equal(suggested.statusCode, 200);
  const reserved = await handle(v.pseudonymApi, 'POST', v.token, { action: 'reserve', names: ['Quiet Heron'] });
  assert.equal(reserved.statusCode, 200);
});

test('connection requests need a saved profile on both sides, at sending and at accepting', { skip }, async () => {
  const x = await app();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const mk = async (complete) => {
    const r = await (await fetch(`${AUTH_URL}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
    await x.admin.doc(`users/${r.localId}/private/settings`).set({ birthDate: x.AdminTimestamp.fromMillis(Date.now() - 30 * YEAR), createdAt: new Date(), updatedAt: new Date() });
    await x.admin.doc(`users/${r.localId}/public/profile`).set({ displayName: `M${r.localId.slice(0, 5)}`, pronouns: 'she/her', avatar: 'cat.1.2', profileComplete: complete });
    return { uid: r.localId, token: r.idToken };
  };
  const author = await mk(true);
  const postId = `${author.uid}_dating`;
  await x.admin.doc(`looking_for_posts/${postId}`).set({ authorId: author.uid, intention: 'dating', title: 'Quiet reader', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: x.AdminTimestamp.now() });
  let n = 0;
  const ask = async (from, to = author) => {
    n += 1;
    await x.admin.doc(`signalsRateLimits/${from.uid}`).delete();
    return handle(x.signalsApi, 'POST', from.token, { action: 'request-create', recipientId: to.uid, lookingForPostId: postId, idempotencyKey: `idem-onboarding-${Date.now()}-${n}`, message: 'Hi!' });
  };
  const incomplete = await mk(false);
  assert.equal((await ask(incomplete)).statusCode, 403, 'an unfinished profile cannot send a request');
  const complete = await mk(true);
  const sent = await ask(complete);
  assert.equal(sent.statusCode, 201, JSON.stringify(sent.body));
  // The author's profile is taken away (a data fix, a rollback): they cannot accept either.
  await x.admin.doc(`users/${author.uid}/public/profile`).update({ profileComplete: false });
  const accept = await handle(x.signalsApi, 'POST', author.token, { action: 'request-accept', requestId: sent.body.requestId });
  assert.equal(accept.statusCode, 403, 'accepting needs a saved profile too');
  await x.admin.doc(`users/${author.uid}/public/profile`).update({ profileComplete: true });
  assert.equal((await handle(x.signalsApi, 'POST', author.token, { action: 'request-accept', requestId: sent.body.requestId })).statusCode, 200);
  // And a request to someone without a saved profile is refused, too.
  const ghost = await mk(false);
  await x.admin.doc(`looking_for_posts/${ghost.uid}_dating`).set({ authorId: ghost.uid, intention: 'dating', title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: x.AdminTimestamp.now() });
  await x.admin.doc(`signalsRateLimits/${complete.uid}`).delete();
  const toGhost = await handle(x.signalsApi, 'POST', complete.token, { action: 'request-create', recipientId: ghost.uid, lookingForPostId: `${ghost.uid}_dating`, idempotencyKey: `idem-onboarding-ghost-${Date.now()}`, message: 'Hi!' });
  assert.equal(toGhost.statusCode, 403);
});

test('an administrator (Google sign-in, no member profile) is not blocked by the member rules: they can still remove a memory', { skip }, async () => {
  const x = await app();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const owner = await (await fetch(`${AUTH_URL}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  await x.admin.doc(`users/${owner.localId}/private/settings`).set({ birthDate: x.AdminTimestamp.fromMillis(Date.now() - 30 * YEAR), createdAt: new Date(), updatedAt: new Date() });
  await x.admin.doc(`users/${owner.localId}/public/profile`).set({ displayName: 'Owner', pronouns: 'she/her', profileComplete: true });
  const made = await handle(x.atlasApi, 'POST', owner.idToken, { action: 'create', title: 'Pier', text: 'Evening.', date: '2024-06-01', lat: 14.6, lng: 120.98, visibility: 'public' });
  assert.equal(made.statusCode, 201);
  const sub = `g-${Date.now()}`;
  const idToken = JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true });
  const g = await (await fetch(`${AUTH_URL}/accounts:signInWithIdp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) })).json();
  await x.admin.doc(`admins/${g.localId}`).set({ createdAt: new Date() });
  const removed = await handle(x.atlasApi, 'POST', g.idToken, { action: 'delete', id: made.body.memory.id });
  assert.equal(removed.statusCode, 200, JSON.stringify(removed.body));
  // ...while a member with no profile who is not an admin still cannot.
  const stranger = await (await fetch(`${AUTH_URL}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  assert.notEqual((await handle(x.atlasApi, 'POST', stranger.idToken, { action: 'delete', id: made.body.memory.id })).statusCode, 200);
});
