// Test Invitations against the real emulators: an ordinary message of kind "test", sent by the test's id alone, shaped from the server's
// catalog, working with unread counts, previews, history paging, blocking and retries. QUEERSPACE stores no answers or results.
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
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const a = await newUser();
  const b = await newUser();
  const outsider = await newUser();
  const pairId = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.doc(`signalsPairs/${pairId}`).set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: new Date() });
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method, headers: { authorization: `Bearer ${user.token}` }, body, query: query ?? {} }, res);
    return res;
  };
  const invite = (user, testId, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'test', testId, ...extra });
  const load = (user, query = {}) => call(user, 'GET', undefined, { view: 'messages', pairId, ...query });
  const inboxOf = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data() ?? {};
  return { db, pairId, a, b, outsider, call, invite, load, inboxOf };
}

test('a member can send a Test Invitation: stored by id, shaped from the catalog for both members, with unread and a named preview', { skip }, async () => {
  const { a, b, invite, load, inboxOf, db, pairId } = await setup();
  const res = await invite(a, 'bdsm-test');
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.kind, 'test');
  assert.deepEqual(res.body.test, { id: 'bdsm-test' });
  assert.equal(res.body.text, 'Test invitation: BDSM Test');
  const stored = (await db.doc(`signalsPairs/${pairId}/messages/${res.body.id}`).get()).data();
  assert.deepEqual(stored.test, { id: 'bdsm-test' });
  assert.equal(stored.kind, 'test');
  for (const viewer of [a, b]) {
    const seen = (await load(viewer)).body.messages;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'test');
    assert.deepEqual(seen[0].test, { id: 'bdsm-test' });
    assert.equal(seen[0].text, 'Test invitation: BDSM Test');
    assert.equal(seen[0].senderId, a.uid, 'the invited-by identity is the sender, as for every message');
  }
  const inboxB = await inboxOf(b);
  assert.equal(inboxB.last[pairId].text, '📝 Test invitation: BDSM Test');
  assert.equal(inboxB.unread[pairId], 1);
  assert.equal((await inboxOf(a)).unread?.[pairId], undefined);
  // Nothing that could hold an answer or a result is stored anywhere on the message.
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'kind', 'senderId', 'test', 'text', 'updatedAt']);
});

test('all three tests can be invited, and a forged record still reads from the catalog', { skip }, async () => {
  const { a, invite, load, db, pairId } = await setup();
  for (const id of ['bdsm-test', 'rice-purity-test', 'attachment-style-quiz']) assert.equal((await invite(a, id)).statusCode, 201, id);
  await db.doc(`signalsPairs/${pairId}/messages/forged-invite-1`).set({ senderId: a.uid, kind: 'test', test: { id: 'rice-purity-test', url: 'https://evil.example/' }, text: 'click here', createdAt: new Date(), updatedAt: new Date() });
  const seen = (await load(a)).body.messages;
  const forged = seen.find((m) => m.id === 'forged-invite-1');
  assert.equal(forged.text, 'Test invitation: Rice Purity Test');
  assert.deepEqual(forged.test, { id: 'rice-purity-test' });
  assert.equal(JSON.stringify(seen).includes('evil.example'), false);
});

test('forging a test invitation is refused: unknown ids, words, links, extra fields, and a test id on another kind of message', { skip }, async () => {
  const { a, invite, call, pairId, db } = await setup();
  for (const bad of ['', 'BDSM-TEST', 'nope', 5, {}, ['bdsm-test'], undefined]) assert.equal((await invite(a, bad)).statusCode, 400, String(bad));
  for (const extra of [{ text: 'my words' }, { url: 'https://evil.example/' }, { name: 'x' }, { description: 'x' }, { test: { id: 'bdsm-test' } }, { cardId: 'soft-01' }]) {
    assert.equal((await invite(a, 'bdsm-test', extra)).statusCode, 400, JSON.stringify(extra));
  }
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'hi', testId: 'bdsm-test' })).statusCode, 400);
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 0);
});

test('repeated clicks cannot make duplicates: the same message id is one invitation and one unread', { skip }, async () => {
  const { a, b, invite, inboxOf, db, pairId } = await setup();
  const first = await invite(a, 'rice-purity-test', { messageId: 'invite-message-0001' });
  const again = await Promise.all([1, 2, 3].map(() => invite(a, 'rice-purity-test', { messageId: 'invite-message-0001' })));
  assert.equal(first.statusCode, 201);
  assert.ok(again.every((r) => r.statusCode === 200 || r.statusCode === 201));
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 1);
  assert.equal((await inboxOf(b)).unread[pairId], 1);
  assert.equal((await invite(a, 'bdsm-test', { messageId: 'invite-message-0001' })).statusCode, 409, 'a different test under the same id is not a retry');
});

test('invitations page like any message, and are never treated as unread by paging back', { skip }, async () => {
  const { a, b, invite, load, inboxOf, pairId, db } = await setup();
  await db.doc(`signalsInbox/${b.uid}`).set({ unread: { [pairId]: 2 } }, { merge: true });
  for (let i = 0; i < 3; i += 1) await invite(a, ['bdsm-test', 'rice-purity-test', 'attachment-style-quiz'][i], { messageId: `invite-page-000${i}` });
  const before = await inboxOf(b);
  const page = await load(b, { limit: '2' });
  assert.deepEqual(page.body.messages.map((m) => m.test.id), ['rice-purity-test', 'attachment-style-quiz']);
  const older = await load(b, { limit: '2', before: page.body.olderCursor });
  assert.deepEqual(older.body.messages.map((m) => m.test.id), ['bdsm-test']);
  assert.deepEqual(await inboxOf(b), before, 'reading history changed no counter');
});

test('invitations respect blocking, suspension, ended chats and membership, and either member can answer with an ordinary reply', { skip }, async () => {
  const { a, b, outsider, invite, db, pairId, call, load } = await setup();
  assert.equal((await invite(outsider, 'bdsm-test')).statusCode, 403);
  const card = await invite(a, 'attachment-style-quiz');
  const reply = await call(b, 'POST', { action: 'send-message', pairId, text: 'Sure, later tonight.', replyTo: { messageId: card.body.id, text: 'Test invitation: Attachment Style Quiz', sender: 'partner' } });
  assert.equal(reply.statusCode, 201);
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
  assert.equal((await invite(a, 'bdsm-test')).statusCode, 403);
  assert.equal((await load(a)).body.error, 'conversation_unavailable');
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${b.uid}`).set({ source: 'admin', reason: 'test' });
  assert.equal((await invite(a, 'bdsm-test')).statusCode, 403);
  await db.doc(`suspensions/${b.uid}`).delete();
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await invite(a, 'bdsm-test')).statusCode, 409);
});
