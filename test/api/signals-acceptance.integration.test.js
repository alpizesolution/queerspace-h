// Accepting a Signal against the real emulators: the sender is notified exactly once, and only after the connection exists.
import test from 'node:test';
import assert from 'node:assert/strict';

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

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const sender = await newUser();
  const recipient = await newUser();
  const stranger = await newUser();
  const call = async (user, body) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body, query: {} }, res);
    return res;
  };
  let n = 0;
  /** A pending invitation from `sender` to `recipient`, written the way the create action writes it. */
  const invite = async (expiresInMs = 60_000) => {
    n += 1;
    const id = `invitation-${Date.now()}-${n}`;
    await db.doc(`signalsInvitations/${id}`).set({
      senderId: sender.uid, recipientId: recipient.uid, message: 'hi', status: 'pending',
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs), updatedAt: Timestamp.now(),
    });
    return id;
  };
  const notes = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data()?.notifications ?? {};
  return { db, sender, recipient, stranger, call, invite, notes };
}

test('accepting notifies the original sender, keyed by the new connection id, and the recipient gets nothing', { skip }, async () => {
  const { db, sender, recipient, call, invite, notes } = await setup();
  const id = await invite();
  assert.deepEqual(await notes(sender), {}, 'nothing before acceptance');
  const accepted = await call(recipient, { action: 'accept', invitationId: id });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.body.pairId, id);
  assert.ok((await db.doc(`signalsPairs/${id}`).get()).exists, 'the connection exists');
  const stored = await notes(sender);
  assert.deepEqual(Object.keys(stored), [id], 'keyed by the connection id');
  assert.equal(stored[id].type, 'accepted');
  assert.equal(stored[id].read, false);
  assert.ok(stored[id].createdAt, 'persisted with a server timestamp');
  assert.deepEqual(Object.keys(stored[id]).sort(), ['createdAt', 'read', 'type'], 'carries no identity');
  assert.deepEqual(await notes(recipient), {}, 'the person who accepted is not notified');
});

test('a retried or simultaneous accept never creates a second notification', { skip }, async () => {
  const { sender, recipient, call, invite, notes } = await setup();
  const id = await invite();
  const results = await Promise.all([call(recipient, { action: 'accept', invitationId: id }), call(recipient, { action: 'accept', invitationId: id })]);
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1, 'exactly one acceptance wins');
  const first = await notes(sender);
  assert.deepEqual(Object.keys(first), [id]);
  const retry = await call(recipient, { action: 'accept', invitationId: id });
  assert.equal(retry.statusCode, 409, 'a later retry is refused, not applied again');
  const after = await notes(sender);
  assert.deepEqual(Object.keys(after), [id]);
  assert.equal(after[id].createdAt.toMillis(), first[id].createdAt.toMillis(), 'the original notification is untouched');
});

test('declining, withdrawing, expiry and a blocked acceptance send no acceptance notification', { skip }, async () => {
  const { db, sender, recipient, call, invite, notes } = await setup();
  const declined = await invite();
  assert.equal((await call(recipient, { action: 'decline', invitationId: declined })).body.status, 'declined');
  const revoked = await invite();
  assert.equal((await call(sender, { action: 'revoke', invitationId: revoked })).body.status, 'revoked');
  const expired = await invite(-1000);
  assert.equal((await call(recipient, { action: 'accept', invitationId: expired })).body.status, 'expired');
  const blocked = await invite();
  await db.doc(`users/${recipient.uid}/private/settings`).set({ blockedPartnerIds: [sender.uid] });
  assert.equal((await call(recipient, { action: 'accept', invitationId: blocked })).body.status, 'declined');
  assert.deepEqual(await notes(sender), {});
  for (const id of [declined, revoked, expired, blocked]) assert.equal((await db.doc(`signalsPairs/${id}`).get()).exists, false);
  // Declining does not use up the ability to accept a different, later invitation.
  await db.doc(`users/${recipient.uid}/private/settings`).delete();
  const later = await invite();
  assert.equal((await call(recipient, { action: 'accept', invitationId: later })).body.status, 'accepted');
  assert.deepEqual(Object.keys(await notes(sender)), [later]);
});

test('only the invited member can accept; nobody else can trigger a notification', { skip }, async () => {
  const { sender, stranger, call, invite, notes } = await setup();
  const id = await invite();
  assert.equal((await call(stranger, { action: 'accept', invitationId: id })).statusCode, 403);
  assert.equal((await call(sender, { action: 'accept', invitationId: id })).statusCode, 403, 'the sender cannot accept their own request');
  assert.deepEqual(await notes(sender), {});
});

test('a failed acceptance leaves the invitation pending so it can be retried, and the retry notifies once', { skip }, async () => {
  const { db, sender, recipient, call, invite, notes } = await setup();
  const id = await invite();
  // A pair already sitting at this id makes the transaction fail; nothing else may be written.
  await db.doc(`signalsPairs/${id}`).set({ participants: ['x', 'y'], status: 'ended' });
  const failed = await call(recipient, { action: 'accept', invitationId: id });
  assert.equal(failed.statusCode, 409);
  assert.equal((await db.doc(`signalsInvitations/${id}`).get()).data().status, 'pending', 'the invitation is not lost');
  assert.deepEqual(await notes(sender), {}, 'no notification when the connection was not established');
  await db.doc(`signalsPairs/${id}`).delete();
  assert.equal((await call(recipient, { action: 'accept', invitationId: id })).statusCode, 200);
  assert.deepEqual(Object.keys(await notes(sender)), [id]);
});

test('marking a notification read is personal, one-way and idempotent', { skip }, async () => {
  const { sender, recipient, stranger, call, invite, notes } = await setup();
  const id = await invite();
  await call(recipient, { action: 'accept', invitationId: id });
  // Someone else acknowledging the same id changes nothing for the sender.
  assert.equal((await call(stranger, { action: 'ack-notification', pairId: id })).statusCode, 200);
  assert.equal((await call(recipient, { action: 'ack-notification', pairId: id })).statusCode, 200);
  assert.equal((await notes(sender))[id].read, false);
  assert.equal((await call(sender, { action: 'ack-notification', pairId: id })).statusCode, 200);
  const read = await notes(sender);
  assert.equal(read[id].read, true);
  assert.equal(read[id].type, 'accepted', 'the rest of the note is kept');
  assert.equal((await call(sender, { action: 'ack-notification', pairId: id })).statusCode, 200);
  assert.equal((await notes(sender))[id].read, true);
  assert.equal((await call(sender, { action: 'ack-notification', pairId: 'no spaces allowed' })).statusCode, 400);
  assert.deepEqual(await notes(stranger), {}, 'acknowledging never creates a notification');
});
