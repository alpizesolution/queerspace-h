// Signals are only for members who are matched in an active conversation. Real (emulator) accounts try every way around it.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function load() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler, isActiveMatch } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  return { handler, isActiveMatch, db: getFirestore(getAdminApp()) };
}

async function post(handler, token, body) {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

const conv = (db, id, participants, status = 'active') =>
  db.doc(`conversations/${id}`).set({ participants: [...participants].sort(), status, createdAt: new Date(), updatedAt: new Date() });

let counter = 0;
const create = (handler, user, recipientId, convId) =>
  post(handler, user.token, {
    action: 'create',
    recipientId,
    ...(convId !== undefined ? { convId } : {}),
    idempotencyKey: `matched-only-key-${++counter}-${Date.now()}`,
    message: 'hi',
  });

test('isActiveMatch accepts only an active two-person conversation containing both members', async () => {
  const { isActiveMatch } = await import('../../api/signals.js');
  assert.equal(isActiveMatch({ status: 'active', participants: ['a', 'b'] }, 'a', 'b'), true);
  assert.equal(isActiveMatch({ status: 'ended', participants: ['a', 'b'] }, 'a', 'b'), false);
  assert.equal(isActiveMatch({ status: 'blocked', participants: ['a', 'b'] }, 'a', 'b'), false);
  assert.equal(isActiveMatch({ status: 'active', participants: ['a', 'c'] }, 'a', 'b'), false);
  assert.equal(isActiveMatch({ status: 'active', participants: ['a', 'b', 'c'] }, 'a', 'b'), false);
  assert.equal(isActiveMatch({ status: 'active', participants: ['a', 'a'] }, 'a', 'a'), false);
  assert.equal(isActiveMatch(null, 'a', 'b'), false);
});

test('a member can Signal only the person they are matched with, and only while the chat is active', { skip }, async () => {
  const { handler, db } = await load();
  const alice = await newUser();
  const bob = await newUser();
  const carol = await newUser();
  const dana = await newUser();

  // Strangers: no conversation at all, however the request is shaped.
  assert.equal((await create(handler, alice, bob.uid)).statusCode, 403, 'no conversation id');
  assert.equal((await create(handler, alice, bob.uid, 'does-not-exist')).statusCode, 403, 'made-up conversation id');
  assert.equal((await create(handler, alice, bob.uid, 'bad id!')).statusCode, 403, 'malformed conversation id');
  assert.equal((await create(handler, alice, bob.uid, '')).statusCode, 403, 'empty conversation id');
  await conv(db, 'someone-elses-chat', [carol.uid, dana.uid]);
  assert.equal((await create(handler, alice, bob.uid, 'someone-elses-chat')).statusCode, 403, "another pair's conversation");
  assert.equal((await create(handler, alice, carol.uid, 'someone-elses-chat')).statusCode, 403, 'a conversation I am not in');

  // A real match with Carol cannot be reused to reach Bob, and you cannot Signal yourself.
  await conv(db, 'alice-carol', [alice.uid, carol.uid]);
  assert.equal((await create(handler, alice, bob.uid, 'alice-carol')).statusCode, 403, 'matched with Carol, not Bob');
  assert.equal((await create(handler, alice, alice.uid, 'alice-carol')).statusCode, 400, 'not to myself');

  // Ended or blocked chats are not an open door either.
  await conv(db, 'alice-bob-ended', [alice.uid, bob.uid], 'ended');
  await conv(db, 'alice-bob-blocked', [alice.uid, bob.uid], 'blocked');
  assert.equal((await create(handler, alice, bob.uid, 'alice-bob-ended')).statusCode, 403);
  assert.equal((await create(handler, alice, bob.uid, 'alice-bob-blocked')).statusCode, 403);

  // Nothing was created by any refused attempt, and nobody was notified.
  assert.equal((await db.collection('signalsInvitations').get()).size, 0);
  assert.equal((await db.collection('signalsInbox').get()).size, 0);

  // The matched pair in an active chat can Signal, in either direction.
  await conv(db, 'alice-carol-live', [alice.uid, carol.uid]);
  const ok = await create(handler, alice, carol.uid, 'alice-carol-live');
  assert.equal(ok.statusCode, 201);
  const invitation = (await db.collection('signalsInvitations').get()).docs[0].data();
  assert.equal(invitation.senderId, alice.uid);
  assert.equal(invitation.recipientId, carol.uid);
  assert.equal((await create(handler, carol, alice.uid, 'alice-carol-live')).statusCode, 201);
});
