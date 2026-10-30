// Messaging against the real emulators: safe retries, change-only polling, and one reaction per member.
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
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method, headers: { authorization: `Bearer ${user.token}` }, body, query: query ?? {} }, res);
    return res;
  };
  const send = (user, text, messageId) => call(user, 'POST', { action: 'send-message', pairId, text, ...(messageId ? { messageId } : {}) });
  const react = (user, messageId, emoji) => call(user, 'POST', { action: 'react-message', pairId, messageId, emoji });
  const load = (user, after) => call(user, 'GET', undefined, { view: 'messages', pairId, ...(after ? { after } : {}) });
  return { db, pairId, a, b, outsider, send, react, load };
}

test('a send can be retried safely: the same message id never makes a second copy', { skip }, async () => {
  const { db, pairId, a, b, send } = await setup();
  const id = 'client-message-0001';
  const first = await send(a, 'Hello there', id);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.id, id);
  const retry = await send(a, 'Hello there', id);
  assert.equal(retry.statusCode, 200, 'a retry answers with what was stored');
  assert.equal(retry.body.id, id);
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 1);
  assert.ok((await db.doc(`signalsPairs/${pairId}/messages/${id}`).get()).data().updatedAt, 'new messages carry updatedAt so polling can ask for changes');
  // Someone else cannot claim an id that is already used, and bad ids are refused.
  assert.equal((await send(b, 'Hijack', id)).statusCode, 409);
  assert.equal((await send(a, 'x', 'no spaces allowed here')).statusCode, 400);
  assert.equal((await send(a, 'x', 'short')).statusCode, 400);
  // Without a client id the server still makes one.
  const plain = await send(a, 'No id given');
  assert.equal(plain.statusCode, 201);
  assert.ok(plain.body.id);
});

test('polling after the first load returns only what changed', { skip }, async () => {
  const { DELTA_OVERLAP_MS } = await import('../../api/signals.js');
  const wait = () => new Promise((r) => setTimeout(r, DELTA_OVERLAP_MS + 200));
  const { a, b, send, react, load } = await setup();
  for (let n = 1; n <= 5; n += 1) await send(a, `message ${n}`, `client-message-100${n}`);
  const full = await load(b);
  assert.equal(full.body.messages.length, 5);
  assert.ok(full.body.cursor);
  // A poll shortly after a change may send it once more (the overlap); then a quiet conversation sends nothing.
  await wait();
  const warm = await load(b, full.body.cursor);
  assert.ok(warm.body.messages.length <= 5);
  await wait();
  const idle = await load(b, warm.body.cursor);
  assert.equal(idle.statusCode, 200);
  assert.equal(idle.body.messages.length, 0, 'an idle conversation costs no message reads');
  // One new message: only that one comes back, not the five before it.
  await send(a, 'a sixth message', 'client-message-1006');
  const delta = await load(b, idle.body.cursor);
  assert.deepEqual(delta.body.messages.map((m) => m.id), ['client-message-1006']);
  // A reaction to an old message brings that message back with its reaction, and none of the untouched ones.
  await wait();
  await react(a, 'client-message-1001', '😻');
  const afterReact = await load(b, delta.body.cursor);
  const ids = afterReact.body.messages.map((m) => m.id);
  assert.ok(ids.includes('client-message-1001'));
  for (const untouched of ['client-message-1002', 'client-message-1003', 'client-message-1004', 'client-message-1005']) assert.ok(!ids.includes(untouched));
  assert.deepEqual(afterReact.body.messages.find((m) => m.id === 'client-message-1001').reactions, [{ emoji: '😻', count: 1, userReacted: false }]);
});

test('reactions: the cat set, one per member, change and remove, both members see them, outsiders cannot', { skip }, async () => {
  const { a, b, outsider, send, react, load } = await setup();
  const sent = await send(a, 'react to me', 'client-message-2001');
  assert.equal(sent.statusCode, 201);
  const id = sent.body.id;
  assert.equal((await react(b, id, '😻')).statusCode, 200);
  assert.equal((await react(a, id, '😻')).body.count, 2);
  // a changes to another emoji: still one reaction by a.
  const changed = await react(a, id, '🙀');
  assert.equal(changed.body.mine, '🙀');
  const seenByB = (await load(b)).body.messages[0].reactions.map((r) => [r.emoji, r.count, r.userReacted]).sort();
  assert.deepEqual(seenByB, [['🙀', 1, false], ['😻', 1, true]].sort());
  // The same emoji again removes it.
  assert.equal((await react(a, id, '🙀')).body.userReacted, false);
  const seenByA = (await load(a)).body.messages[0].reactions;
  assert.deepEqual(seenByA, [{ emoji: '😻', count: 1, userReacted: false }]);
  // Earlier reactions still work, anything else is refused, and strangers are kept out.
  assert.equal((await react(b, id, '💜')).statusCode, 200);
  assert.equal((await react(b, id, '💩')).statusCode, 400);
  assert.equal((await react(outsider, id, '😻')).statusCode, 403);
  assert.equal((await load(outsider)).statusCode, 403);
  assert.equal((await send(outsider, 'let me in', 'client-message-2002')).statusCode, 403);
});
