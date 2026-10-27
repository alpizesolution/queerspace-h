import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initializeClientApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import handler from './signals.js';

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

    const key = `signals-test-${Date.now()}-create`;
    const created = await callApi(sender, 'POST', {
      action: 'create',
      recipientId: recipient.uid,
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
      idempotencyKey: key,
      message: 'Hello, if you would like to talk.',
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.replayed, true);
    assert.equal(retry.body.invitationId, created.body.invitationId);

    const invitationRef = db.doc(`signalsInvitations/${created.body.invitationId}`);
    const invitationBeforeAccept = await invitationRef.get();
    assert.equal(invitationBeforeAccept.data()?.status, 'pending');

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

    const pair = await db.doc(`signalsPairs/${created.body.invitationId}`).get();
    assert.equal(pair.exists, true);
    assert.deepEqual(pair.data()?.participants, [sender.uid, recipient.uid].sort());
    assert.equal(pair.data()?.status, 'active');

    const inbox = await callApi(outsider, 'GET');
    assert.equal(inbox.statusCode, 200);
    assert.deepEqual(inbox.body.invitations, []);

    // A recipient-side block must prevent a new invitation from being created.
    const blockedSender = await newAnonymousUser('blocked-sender');
    const blockedRecipient = await newAnonymousUser('blocked-recipient');
    await db.doc(`users/${blockedRecipient.uid}/private/settings`).set({
      blockedPartnerIds: [blockedSender.uid],
    });
    const blocked = await callApi(blockedSender, 'POST', {
      action: 'create',
      recipientId: blockedRecipient.uid,
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
