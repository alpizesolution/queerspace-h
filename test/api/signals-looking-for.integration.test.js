// Contacting someone from their Looking For post, against the real emulators. The server decides: the sender's age
// comes from private account data, and every block, suspension, duplicate and rate rule still applies.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const sender = await newUser();
  const author = await newUser();
  const other = await newUser();
  const adult = Timestamp.fromMillis(Date.now() - 30 * YEAR);
  await db.doc(`users/${sender.uid}/private/settings`).set({ birthDate: adult });
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult });
  const postId = `${author.uid}_dating`;
  await db.doc(`looking_for_posts/${postId}`).set({ authorId: author.uid, intention: 'dating', title: 't', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: Timestamp.now() });
  const call = async (user, body) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body, query: {} }, res);
    return res;
  };
  let n = 0;
  const contact = async (from, to, extra = {}) => {
    n += 1;
    await db.doc(`signalsRateLimits/${from.uid}`).delete();
    return call(from, { action: 'create', recipientId: to.uid, lookingForPostId: postId, idempotencyKey: `idem-looking-for-${Date.now()}-${n}`, message: 'Hello!', ...extra });
  };
  const pendingFor = async (user) => (await db.collection('signalsInvitations').where('recipientId', '==', user.uid).get()).size;
  return { db, Timestamp, sender, author, other, postId, call, contact, pendingFor };
}

test('an adult member can Signal the author of a live Looking For post, and the author still has to accept', { skip }, async () => {
  const { db, sender, author, contact, call } = await setup();
  const res = await contact(sender, author);
  assert.equal(res.statusCode, 201);
  const invite = (await db.doc(`signalsInvitations/${res.body.invitationId}`).get()).data();
  assert.equal(invite.status, 'pending');
  assert.equal(invite.senderId, sender.uid);
  assert.equal(invite.recipientId, author.uid);
  assert.ok((await db.doc(`signalsInbox/${author.uid}`).get()).data().pending[res.body.invitationId], 'the author is told live');
  assert.equal((await db.doc(`signalsPairs/${res.body.invitationId}`).get()).exists, false, 'no chat until the author accepts');
  const accepted = await call(author, { action: 'accept', invitationId: res.body.invitationId });
  assert.equal(accepted.body.status, 'accepted');
  assert.ok((await db.doc(`signalsInbox/${sender.uid}`).get()).data().notifications[res.body.invitationId], 'the acceptance notification still works');
});

test('without a match or a post, contact is still refused: the matched-only rule is unchanged', { skip }, async () => {
  const { sender, author, call } = await setup();
  const none = await call(sender, { action: 'create', recipientId: author.uid, idempotencyKey: 'idem-looking-for-none-1', message: 'hi' });
  assert.equal(none.statusCode, 403);
  const badPost = await call(sender, { action: 'create', recipientId: author.uid, lookingForPostId: 'not-a-real-post', idempotencyKey: 'idem-looking-for-none-2' });
  assert.equal(badPost.statusCode, 403);
  // Naming a conversation means the matched path is used, so a post cannot stand in for a missing match.
  const withConv = await call(sender, { action: 'create', recipientId: author.uid, convId: 'conv-that-does-not-exist', lookingForPostId: `${author.uid}_dating`, idempotencyKey: 'idem-looking-for-none-3' });
  assert.equal(withConv.statusCode, 403);
});

test('the post must belong to the person being contacted, and must still exist', { skip }, async () => {
  const { db, sender, author, other, postId, contact, pendingFor } = await setup();
  assert.equal((await contact(sender, other)).statusCode, 403, 'someone else cannot be contacted through this post');
  await db.doc(`looking_for_posts/${postId}`).delete();
  assert.equal((await contact(sender, author)).statusCode, 403, 'a deleted post is no longer an invitation to contact');
  assert.equal(await pendingFor(author), 0);
});

test('the sender must be an adult by their private birthday, never by what the request says', { skip }, async () => {
  const { db, Timestamp, sender, author, contact } = await setup();
  await db.doc(`users/${sender.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 16 * YEAR) });
  const minor = await contact(sender, author, { birthDate: '1990-01-01', age: 30, isAdult: true });
  assert.equal(minor.statusCode, 403);
  await db.doc(`users/${sender.uid}/private/settings`).delete();
  assert.equal((await contact(sender, author)).statusCode, 403, 'no birthday on file means no contact');
  await db.doc(`users/${sender.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
  assert.equal((await contact(sender, author)).statusCode, 201);
});

test('blocks in either direction and suspensions stop contact', { skip }, async () => {
  const { db, Timestamp, sender, author, contact } = await setup();
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR), blockedPartnerIds: [sender.uid] });
  assert.equal((await contact(sender, author)).statusCode, 403, 'the author blocked the sender');
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
  await db.doc(`users/${sender.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR), blockedPartnerIds: [author.uid] });
  assert.equal((await contact(sender, author)).statusCode, 403, 'the sender blocked the author');
  await db.doc(`users/${sender.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR) });
  await db.doc(`suspensions/${sender.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await contact(sender, author)).statusCode, 403, 'a suspended member cannot Signal');
  await db.doc(`suspensions/${sender.uid}`).delete();
  assert.equal((await contact(sender, author)).statusCode, 201);
});

test('no stacking: one waiting Signal per person, none to someone already connected, and the 30-second pace holds', { skip }, async () => {
  const { db, sender, author, call, contact } = await setup();
  const first = await contact(sender, author);
  assert.equal(first.statusCode, 201);
  const again = await contact(sender, author);
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'already_invited');
  const accepted = await call(author, { action: 'accept', invitationId: first.body.invitationId });
  assert.equal(accepted.body.status, 'accepted');
  const connected = await contact(sender, author);
  assert.equal(connected.statusCode, 409);
  assert.equal(connected.body.error, 'already_connected');
  // The pace is the same shared 30-second cooldown as matched Signals.
  const { author: other2 } = { author: await (async () => { const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }); const d = await r.json(); return { uid: d.localId, token: d.idToken }; })() };
  await db.doc(`users/${other2.uid}/private/settings`).set({ birthDate: new Date(Date.now() - 30 * 365.25 * 24 * 3600 * 1000) });
  await db.doc(`looking_for_posts/${other2.uid}_open`).set({ authorId: other2.uid, intention: 'open' });
  await db.doc(`signalsRateLimits/${sender.uid}`).set({ lastCreatedAt: new Date() });
  const fast = await call(sender, { action: 'create', recipientId: other2.uid, lookingForPostId: `${other2.uid}_open`, idempotencyKey: 'idem-looking-for-fast-1' });
  assert.equal(fast.statusCode, 429);
});

test('a retried send with the same key is answered once, not duplicated', { skip }, async () => {
  const { sender, author, call, pendingFor } = await setup();
  const body = { action: 'create', recipientId: author.uid, lookingForPostId: `${author.uid}_dating`, idempotencyKey: 'idem-looking-for-retry-1', message: 'hi' };
  const first = await call(sender, body);
  assert.equal(first.statusCode, 201);
  const retry = await call(sender, body);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.invitationId, first.body.invitationId);
  assert.equal(await pendingFor(author), 1);
});
