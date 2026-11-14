// Support Chat pictures against the real emulators, with an in-memory stand-in for R2: a member and the team can send a picture with NO
// timer, it is checked and stored under the support prefix, it never expires, and only that thread's member and admins can see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXE, GIF, GPS_MARKER, HTML, SVG, fakeStore, makeJpeg, makePng, toBase64 } from './media-fixtures.js';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

/** A Google sign-in (what an admin uses), through the emulator's test identity provider. */
async function newGoogleUser() {
  const sub = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idToken = JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true });
  const r = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: signals } = await import('../../api/signals.js');
  const media = await import('../../api/_media.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const store = fakeStore();
  media.setMediaStoreForTests(store);
  const member = await newUser();
  const other = await newUser();
  const admin = await newGoogleUser();
  await db.doc(`admins/${admin.uid}`).set({ createdAt: new Date() });
  await db.doc(`users/${member.uid}/public/profile`).set({ displayName: 'Willow', avatar: 'cat.1.2' });
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await signals({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {}, url: '/' }, res);
    return res;
  };
  let n = 0;
  const id = () => `support-msg-${Date.now()}-${n += 1}`;
  const send = (user, buffer, extra = {}) => call(user, 'POST', { action: 'support-image-send', image: toBase64(buffer), messageId: id(), ...extra });
  const view = (user, threadId, messageId) => call(user, 'GET', undefined, { view: 'support-image', threadId, messageId });
  return { db, store, member, other, admin, call, send, view, id };
}

test('a member can send a picture to support: no timer, stored under the support prefix with the camera details removed, and the thread is updated', { skip }, async () => {
  const { member, send, db, store } = await setup();
  const res = await send(member, makeJpeg({ withMetadata: true }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.from, 'user');
  const message = (await db.doc(`support_threads/${member.uid}/messages/${res.body.id}`).get()).data();
  assert.equal(message.from, 'user');
  assert.equal(message.text, '📷 Photo');
  assert.deepEqual(Object.keys(message.image).sort(), ['height', 'type', 'width']);
  assert.ok(message.timestamp);
  for (const forbidden of ['durationSec', 'expiresAt', 'deleteAfter', 'mediaId', 'state']) assert.equal(forbidden in message, false, `no ${forbidden}: it never expires`);
  const key = `support/${member.uid}/${res.body.id}`;
  assert.ok(store.objects.has(key), 'stored in the private bucket under the support prefix');
  assert.equal(store.objects.get(key).body.includes(Buffer.from(GPS_MARKER)), false, 'camera details are removed');
  const thread = (await db.doc(`support_threads/${member.uid}`).get()).data();
  assert.equal(thread.lastMessage, '📷 Photo');
  assert.equal(thread.lastFrom, 'user');
  assert.equal(thread.unreadForTeam, true);
  assert.equal(thread.displayName, 'Willow');
  assert.equal((await db.collection('signalsMedia').get()).size, 0, 'it does not use the timed-photo records, so no timer or cleanup can ever apply');
});

test('the member sees their own picture; another member does not; an admin sees any', { skip }, async () => {
  const { member, other, admin, send, view } = await setup();
  const res = await send(member, makePng());
  const own = await view(member, member.uid, res.body.id);
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.contentType, 'image/png');
  assert.ok(Buffer.from(own.body.image, 'base64').length > 8);
  assert.equal((await view(other, member.uid, res.body.id)).statusCode, 404, 'not found, never "forbidden": it does not say it exists');
  assert.equal((await view(admin, member.uid, res.body.id)).statusCode, 200);
  assert.equal((await view(member, member.uid, 'support-msg-does-not-exist')).statusCode, 404);
  assert.equal((await view(member, '../../x', res.body.id)).statusCode, 400);
});

test('the team can send a picture into a member\'s thread, and the member can see it', { skip }, async () => {
  const { member, admin, send, view, db, store } = await setup();
  const res = await send(admin, makeJpeg(), { threadId: member.uid });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.from, 'team');
  assert.ok(store.objects.has(`support/${member.uid}/${res.body.id}`));
  const thread = (await db.doc(`support_threads/${member.uid}`).get()).data();
  assert.equal(thread.lastFrom, 'team');
  assert.equal(thread.unreadForUser, true);
  assert.equal(thread.unreadForTeam, false);
  assert.equal((await view(member, member.uid, res.body.id)).statusCode, 200);
});

test('nobody else can send into someone\'s thread: a member cannot name another thread, and a non-admin Google user is not the team', { skip }, async () => {
  const { member, other, send, db } = await setup();
  assert.equal((await send(other, makePng(), { threadId: member.uid })).statusCode, 403);
  const notAdmin = await newGoogleUser();
  assert.equal((await send(notAdmin, makePng(), { threadId: member.uid })).statusCode, 403, 'a Google sign-in alone is not enough');
  assert.equal((await db.collection(`support_threads/${member.uid}/messages`).get()).size, 0);
});

test('only real JPEG, PNG or WebP pictures up to 3 MB are accepted: other files, forged fields and oversized pictures are refused', { skip }, async () => {
  const { member, send, call, db } = await setup();
  for (const bad of [SVG, GIF, EXE, HTML, Buffer.from('not an image at all')]) assert.equal((await send(member, bad)).statusCode, 400);
  assert.equal((await call(member, 'POST', { action: 'support-image-send', image: toBase64(makePng()), messageId: 'support-msg-forged-1', text: 'hi' })).statusCode, 400);
  assert.equal((await call(member, 'POST', { action: 'support-image-send', image: toBase64(makePng()), messageId: 'short' })).statusCode, 400);
  assert.equal((await call(member, 'POST', { action: 'support-image-send', image: '!!!not base64', messageId: 'support-msg-bad-b64' })).statusCode, 400);
  const big = Buffer.alloc(3_100_000, 1);
  assert.equal((await send(member, big)).statusCode, 413);
  assert.equal((await send(member, makeJpeg({ pad: 2_800_000 }))).statusCode, 201, 'a picture just under 3 MB is accepted');
  assert.equal((await db.collection(`support_threads/${member.uid}/messages`).get()).size, 1);
});

test('repeating a send with the same message id is one message', { skip }, async () => {
  const { member, call, db, store } = await setup();
  const body = { action: 'support-image-send', image: toBase64(makePng()), messageId: 'support-msg-repeat-1' };
  const first = await call(member, 'POST', body);
  const again = await Promise.all([call(member, 'POST', body), call(member, 'POST', body)]);
  assert.equal(first.statusCode, 201);
  assert.ok(again.every((r) => r.statusCode === 200 || r.statusCode === 201));
  assert.equal((await db.collection(`support_threads/${member.uid}/messages`).get()).size, 1);
  assert.equal([...store.objects.keys()].filter((k) => k.startsWith('support/')).length, 1);
});

test('a suspended member can still send a picture to support, like text; nothing else about Signals changes', { skip }, async () => {
  const { member, send, db } = await setup();
  await db.doc(`suspensions/${member.uid}`).set({ source: 'admin', reason: 'test' });
  assert.equal((await send(member, makePng())).statusCode, 201);
});

test('without picture storage configured the answer is a clear 503 and nothing is written', { skip }, async () => {
  const { member, db } = await setup();
  const media = await import('../../api/_media.js');
  media.setMediaStoreForTests(null);
  const { default: signals } = await import('../../api/signals.js');
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
  await signals({ method: 'POST', headers: { authorization: `Bearer ${member.token}` }, body: { action: 'support-image-send', image: toBase64(makePng()), messageId: 'support-msg-nostore' }, query: {}, url: '/' }, res);
  assert.ok([503, 500].includes(res.statusCode));
  assert.equal((await db.collection(`support_threads/${member.uid}/messages`).get()).size, 0);
  media.setMediaStoreForTests(fakeStore());
});
