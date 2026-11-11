// Comfort Cards against the real emulators: a card is sent by its id alone, the words come from the server's list, either member can
// answer it with an ordinary reply, and every way of forging or abusing a card is refused.
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

async function setup(pairStatus = 'active') {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { cardById } = await import('../../api/_cards.js');
  const db = getFirestore(getAdminApp());
  const a = await newUser();
  const b = await newUser();
  const outsider = await newUser();
  const pairId = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.doc(`signalsPairs/${pairId}`).set({ participants: [a.uid, b.uid].sort(), status: pairStatus, createdAt: new Date() });
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {} }, res);
    return res;
  };
  const sendCard = (user, cardId, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'card', cardId, ...extra });
  const sendText = (user, text, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, text, ...extra });
  const load = (user, after) => call(user, 'GET', undefined, { view: 'messages', pairId, ...(after ? { after } : {}) });
  const count = async () => (await db.collection(`signalsPairs/${pairId}/messages`).get()).size;
  return { db, pairId, a, b, outsider, call, sendCard, sendText, load, count, cardById };
}

test('a member can send a Comfort Card; the question comes from the server list and both people see it', { skip }, async () => {
  const { a, b, sendCard, load, cardById } = await setup();
  const res = await sendCard(a, 'soft-01');
  assert.equal(res.statusCode, 201);
  const card = cardById('soft-01');
  assert.equal(res.body.kind, 'card');
  assert.equal(res.body.text, card.question);
  assert.deepEqual(res.body.card, { id: 'soft-01', category: 'soft' });
  assert.equal(res.body.senderId, a.uid);
  assert.ok(res.body.createdAt, 'a timestamp');
  for (const viewer of [a, b]) {
    const seen = (await load(viewer)).body.messages;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'card');
    assert.equal(seen[0].text, card.question);
    assert.deepEqual(seen[0].card, { id: 'soft-01', category: 'soft' });
    assert.equal(seen[0].senderId, a.uid);
  }
});

test('either person can answer the same card, and answers are ordinary replies in the same conversation', { skip }, async () => {
  const { a, b, sendCard, sendText, load, count } = await setup();
  const card = (await sendCard(a, 'deep-03')).body;
  const quote = (sender) => ({ messageId: card.id, text: card.text, sender });
  const fromB = await sendText(b, 'Mine is slow mornings.', { replyTo: quote('partner') });
  const fromA = await sendText(a, 'Mine too, honestly.', { replyTo: quote('self') });
  assert.equal(fromB.statusCode, 201);
  assert.equal(fromA.statusCode, 201);
  assert.equal(await count(), 3);
  const thread = (await load(b)).body.messages;
  assert.equal(thread.length, 3);
  assert.equal(thread[0].kind, 'card');
  assert.equal(thread[1].kind, undefined, 'an answer is plain text');
  assert.equal(thread[1].replyTo.messageId, card.id);
  assert.equal(thread[2].replyTo.messageId, card.id);
});

test('a card cannot carry words of its own, and an unknown card is refused', { skip }, async () => {
  const { a, sendCard, call, pairId, count } = await setup();
  const base = { action: 'send-message', pairId, kind: 'card' };
  const refused = [
    await sendCard(a, 'not-a-card'),
    await sendCard(a, undefined),
    await sendCard(a, 5),
    await sendCard(a, { id: 'soft-01' }),
    await sendCard(a, 'soft-01', { text: 'my own words' }),
    await sendCard(a, 'soft-01', { question: 'my own words' }),
    await sendCard(a, 'soft-01', { card: { id: 'soft-01', question: 'x' } }),
    await sendCard(a, 'soft-01', { gifId: 'goodGif123' }),
    await call(a, 'POST', { ...base, text: 'just text as a card' }),
  ];
  for (const r of refused) assert.equal(r.statusCode, 400, JSON.stringify(r.body));
  // Card fields on an ordinary message are refused too.
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'hi', cardId: 'soft-01' })).statusCode, 400);
  assert.equal(await count(), 0, 'nothing was stored');
});

test('only a member of an active connection can send a card', { skip }, async () => {
  const { outsider, a, sendCard, call, pairId, count } = await setup();
  assert.equal((await sendCard(outsider, 'soft-01')).statusCode, 403);
  assert.equal((await call(null, 'POST', { action: 'send-message', pairId, kind: 'card', cardId: 'soft-01' })).statusCode, 401);
  assert.equal(await count(), 0);
  const ended = await setup('ended');
  assert.equal((await ended.sendCard(ended.a, 'soft-01')).statusCode, 409);
  assert.equal(await ended.count(), 0);
});

test('blocked and suspended members cannot send cards, exactly like text', { skip }, async () => {
  const { db, a, b, sendCard, sendText, count } = await setup();
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
  assert.equal((await sendCard(a, 'soft-01')).statusCode, 403);
  assert.equal((await sendText(a, 'hi')).statusCode, 403);
  assert.equal(await count(), 0);
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${a.uid}`).set({ source: 'admin', reason: 'test', createdAt: new Date() });
  assert.equal((await sendCard(a, 'soft-01')).statusCode, 403);
  assert.equal(await count(), 0);
});

test('retrying a card send with the same message id never makes a second card or a second unread', { skip }, async () => {
  const { db, a, b, sendCard, count, pairId } = await setup();
  const messageId = 'card-retry-0001';
  const first = await sendCard(a, 'fun-02', { messageId });
  const again = await sendCard(a, 'fun-02', { messageId });
  assert.equal(first.statusCode, 201);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body.card, { id: 'fun-02', category: 'fun' });
  assert.equal(again.body.id, messageId);
  assert.equal(await count(), 1);
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1);
  // The same message id with a different card, or from someone else, is refused rather than overwriting.
  assert.equal((await sendCard(a, 'fun-03', { messageId })).statusCode, 409);
  assert.equal((await sendCard(b, 'fun-02', { messageId })).statusCode, 409);
});

test('a stored card record with a forged question still shows the approved words; an unknown card id shows as plain text', { skip }, async () => {
  const { db, a, b, pairId, load, cardById } = await setup();
  const col = db.collection(`signalsPairs/${pairId}/messages`);
  await col.doc('forged1').set({ senderId: a.uid, text: 'FORGED WORDS', kind: 'card', card: { id: 'love-01', question: 'FORGED WORDS' }, createdAt: new Date(1000), updatedAt: new Date(1000) });
  await col.doc('unknown1').set({ senderId: a.uid, text: 'old plain text', kind: 'card', card: { id: 'gone-99' }, createdAt: new Date(2000), updatedAt: new Date(2000) });
  const messages = (await load(b)).body.messages;
  assert.equal(messages[0].text, cardById('love-01').question);
  assert.equal(messages[0].kind, 'card');
  assert.equal(messages[1].kind, undefined);
  assert.equal(messages[1].text, 'old plain text');
});

test('existing text messages still send and load exactly as before', { skip }, async () => {
  const { a, b, sendText, load } = await setup();
  const sent = await sendText(a, '  hello there  ');
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.text, 'hello there');
  assert.equal(sent.body.kind, undefined);
  const seen = (await load(b)).body.messages;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, undefined);
  assert.equal(seen[0].card, undefined);
});
