import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initializeClientApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import handler from './signals.js';
import { getAdminApp } from './_lib.js';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

async function callApi(user, method, body) {
  const res = response();
  await handler({
    method,
    headers: { authorization: `Bearer ${await user.getIdToken(true)}` },
    body,
  }, res);
  return res;
}

async function handlerGetPairs(user) {
  const res = response();
  await handler({
    method: 'GET',
    url: '/api/signals?view=pairs',
    query: { view: 'pairs' },
    headers: { authorization: `Bearer ${await user.getIdToken(true)}` },
  }, res);
  return res;
}

function pairRefFor(db, pairId) {
  return db.doc(`signalsPairs/${pairId}`);
}

test('Signals API emulator lifecycle: create, idempotent retry, accept, block, and private inbox', {
  skip: !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false,
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  const clientApps = [];
  async function newAnonymousUser(label) {
    const app = initializeClientApp({
      apiKey: 'fake-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId: `1:123456789:web:signals-${label}`,
    }, `signals-integration-${label}-${Date.now()}-${Math.random()}`);
    clientApps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return (await signInAnonymously(auth)).user;
  }

  try {
    const sender = await newAnonymousUser('sender');
    const recipient = await newAnonymousUser('recipient');
    const outsider = await newAnonymousUser('outsider');

    // Signals only travel inside an active, server-created match between the two members.
    const seedDb = getFirestore(getAdminApp());
    await seedDb.doc('conversations/signals-conv-main').set({ participants: [sender.uid, recipient.uid].sort(), status: 'active', createdAt: new Date(), updatedAt: new Date() });
    const key = `signals-test-${Date.now()}-create`;
    const created = await callApi(sender, 'POST', {
      action: 'create',
      recipientId: recipient.uid,
      convId: 'signals-conv-main',
      idempotencyKey: key,
      message: 'Hello, if you would like to talk.',
    });
    assert.equal(created.statusCode, 201, `create failed: ${JSON.stringify(created.body)}; sender=${sender.uid}; recipient=${recipient.uid}`);
    assert.equal(created.body.replayed, false);
    assert.ok(created.body.invitationId);

    // The first API request initializes its Admin SDK in emulator mode; never use production credentials.
    const adminApp = getAdminApps().find(app => app.options.projectId === projectId);
    assert.ok(adminApp, 'Signals API should initialize its Firebase Admin app against the emulator project');
    const db = getFirestore(adminApp);

    const retry = await callApi(sender, 'POST', {
      action: 'create',
      recipientId: recipient.uid,
      convId: 'signals-conv-main',
      idempotencyKey: key,
      message: 'Hello, if you would like to talk.',
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.replayed, true);
    assert.equal(retry.body.invitationId, created.body.invitationId);

    const invitationRef = db.doc(`signalsInvitations/${created.body.invitationId}`);
    const invitationBeforeAccept = await invitationRef.get();
    assert.equal(invitationBeforeAccept.data()?.status, 'pending');

    // Live inbox: the recipient sees exactly one pending id (the idempotent retry added nothing) and no sender identity.
    const recipientInbox = await db.doc(`signalsInbox/${recipient.uid}`).get();
    assert.deepEqual(Object.keys(recipientInbox.data()?.pending || {}), [created.body.invitationId]);
    assert.equal(JSON.stringify(recipientInbox.data()).includes(sender.uid), false);
    const revBefore = recipientInbox.data()?.rev;
    assert.equal(typeof revBefore, 'number');
    assert.equal((await db.doc(`signalsInbox/${outsider.uid}`).get()).exists, false);

    // The recipient reviewing the invitation sees the SENDER's pseudonym (never their own, nothing private).
    await db.doc(`users/${sender.uid}/public/profile`).set({ displayName: 'Moon_Fox', avatar: 'fox.1.2', birthDate: 'never exposed' });
    await db.doc(`users/${recipient.uid}/public/profile`).set({ displayName: 'Night_Owl' });
    const recipientInvites = await callApi(recipient, 'GET');
    assert.equal(recipientInvites.body.invitations.length, 1);
    assert.equal(recipientInvites.body.invitations[0].direction, 'received');
    assert.deepEqual(recipientInvites.body.invitations[0].partner, { displayName: 'Moon_Fox', avatar: 'fox.1.2' });
    assert.equal(JSON.stringify(recipientInvites.body).includes('never exposed'), false);
    const senderInvites = await callApi(sender, 'GET');
    assert.deepEqual(senderInvites.body.invitations[0].partner, { displayName: 'Night_Owl', avatar: null }, 'sender sees the recipient, not themselves');

    const forbiddenAccept = await callApi(outsider, 'POST', {
      action: 'accept',
      invitationId: created.body.invitationId,
    });
    assert.equal(forbiddenAccept.statusCode, 403);
    assert.equal((await invitationRef.get()).data()?.status, 'pending');

    const accepted = await callApi(recipient, 'POST', {
      action: 'accept',
      invitationId: created.body.invitationId,
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.status, 'accepted');

    const inboxAfter = await db.doc(`signalsInbox/${recipient.uid}`).get();
    assert.deepEqual(inboxAfter.data()?.pending || {}, {}, 'accepting clears the pending entry');
    assert.ok(inboxAfter.data()?.rev > revBefore, 'accepting wakes the recipient listener');
    assert.ok((await db.doc(`signalsInbox/${sender.uid}`).get()).data()?.rev >= 2, 'and the sender listener');

    const pair = await db.doc(`signalsPairs/${created.body.invitationId}`).get();
    assert.equal(pair.exists, true);
    assert.deepEqual(pair.data()?.participants, [sender.uid, recipient.uid].sort());
    assert.equal(pair.data()?.status, 'active');

    const senderPairs = await callApi(sender, 'GET');
    assert.equal(senderPairs.statusCode, 200);
    assert.equal(senderPairs.body.pairs, undefined, 'default GET remains the invitation inbox');
    const senderActivePairs = await handlerGetPairs(sender);
    assert.equal(senderActivePairs.statusCode, 200);
    assert.equal(senderActivePairs.body.pairs.length, 1, JSON.stringify(senderActivePairs.body));
    assert.equal(senderActivePairs.body.pairs[0].id, created.body.invitationId);
    assert.equal(senderActivePairs.body.pairs[0].status, 'active');
    // Each person sees the OTHER participant's pseudonym; a missing profile falls back to null.
    const recipientActivePairs = await handlerGetPairs(recipient);
    assert.deepEqual(recipientActivePairs.body.pairs[0].partner, { displayName: 'Moon_Fox', avatar: 'fox.1.2' });
    assert.deepEqual(senderActivePairs.body.pairs[0].partner, { displayName: 'Night_Owl', avatar: null });
    assert.equal(JSON.stringify(recipientActivePairs.body).includes('never exposed'), false);

    const outsiderPairs = await handlerGetPairs(outsider);
    assert.equal(outsiderPairs.statusCode, 200);
    assert.deepEqual(outsiderPairs.body.pairs, []);

    const outsiderEnd = await callApi(outsider, 'POST', {
      action: 'end',
      pairId: created.body.invitationId,
    });
    assert.equal(outsiderEnd.statusCode, 403);
    assert.equal((await pairRefFor(db, created.body.invitationId).get()).data()?.status, 'active');

    const ended = await callApi(sender, 'POST', {
      action: 'end',
      pairId: created.body.invitationId,
    });
    assert.equal(ended.statusCode, 200);
    assert.deepEqual(ended.body, { status: 'ended', alreadyEnded: false });
    const endedPair = await pairRefFor(db, created.body.invitationId).get();
    assert.equal(endedPair.data()?.status, 'ended');
    assert.equal(endedPair.data()?.endedBy, sender.uid);

    const endRetry = await callApi(recipient, 'POST', {
      action: 'end',
      pairId: created.body.invitationId,
    });
    assert.equal(endRetry.statusCode, 200);
    assert.deepEqual(endRetry.body, { status: 'ended', alreadyEnded: true });

    const recipientPairs = await handlerGetPairs(recipient);
    assert.equal(recipientPairs.body.pairs[0].status, 'ended');

    const inbox = await callApi(outsider, 'GET');
    assert.equal(inbox.statusCode, 200);
    assert.deepEqual(inbox.body.invitations, []);

    // A recipient-side block must prevent a new invitation from being created.
    const blockedSender = await newAnonymousUser('blocked-sender');
    const blockedRecipient = await newAnonymousUser('blocked-recipient');
    await db.doc(`users/${blockedRecipient.uid}/private/settings`).set({
      blockedPartnerIds: [blockedSender.uid],
    });
    await seedDb.doc('conversations/signals-conv-blocked').set({ participants: [blockedSender.uid, blockedRecipient.uid].sort(), status: 'active', createdAt: new Date(), updatedAt: new Date() });
    const blocked = await callApi(blockedSender, 'POST', {
      action: 'create',
      recipientId: blockedRecipient.uid,
      convId: 'signals-conv-blocked',
      idempotencyKey: `signals-test-${Date.now()}-blocked`,
      message: 'This should not be created.',
    });
    assert.equal(blocked.statusCode, 403);
    const blockedInvites = await db.collection('signalsInvitations')
      .where('senderId', '==', blockedSender.uid).get();
    assert.equal(blockedInvites.size, 0);
  } finally {
    await Promise.all(clientApps.map(app => deleteApp(app)));
  }
});
