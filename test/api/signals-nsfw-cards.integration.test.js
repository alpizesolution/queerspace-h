// NSFW Cards against the real emulators: sent by id alone like Comfort Cards, but the question is NEVER in anything the server stores or
// returns (message text, previews, both members' views): only the id, the category and the neutral line "Mature card".
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
  const nsfw = await import('../../api/_nsfwCards.js');
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
  const sendCard = (user, cardId, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'card', cardId, ...extra });
  const load = (user) => call(user, 'GET', undefined, { view: 'messages', pairId });
  const inboxOf = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data() ?? {};
  return { db, pairId, a, b, outsider, call, sendCard, load, inboxOf, nsfw };
}

test('a member can send an NSFW Card: the question is nowhere in the response, the stored message, either view or either inbox preview', { skip }, async () => {
  const { a, b, sendCard, load, inboxOf, db, pairId, nsfw } = await setup();
  const card = nsfw.nsfwCardById('nsfw-spicy-03');
  const res = await sendCard(a, card.id);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.kind, 'card');
  assert.equal(res.body.text, nsfw.NSFW_CARD_TEXT);
  assert.deepEqual(res.body.card, { id: 'nsfw-spicy-03', category: 'spicy', deck: 'nsfw' });
  const stored = (await db.doc(`signalsPairs/${pairId}/messages/${res.body.id}`).get()).data();
  assert.equal(stored.text, 'Mature card');
  assert.deepEqual(stored.card, { id: 'nsfw-spicy-03' });
  assert.equal(stored.kind, 'card');
  for (const viewer of [a, b]) {
    const seen = (await load(viewer)).body.messages;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].text, 'Mature card');
    assert.deepEqual(seen[0].card, { id: 'nsfw-spicy-03', category: 'spicy', deck: 'nsfw' });
    assert.equal(seen[0].senderId, a.uid);
  }
  const everything = JSON.stringify([res.body, stored, (await load(a)).body, (await load(b)).body, await inboxOf(a), await inboxOf(b)]);
  for (const c of nsfw.NSFW_CARDS) assert.equal(everything.includes(c.question), false, `the question of ${c.id} must not appear anywhere`);
  const inboxB = await inboxOf(b);
  assert.equal(inboxB.last[pairId].text, '🖤 Mature Card');
  assert.equal(inboxB.last[pairId].mine, false);
  assert.equal(inboxB.unread[pairId], 1, 'the recipient has one unread');
  assert.equal((await inboxOf(a)).last[pairId].mine, true);
  assert.equal((await inboxOf(a)).unread?.[pairId], undefined);
});

test('every NSFW card id can be sent, and every one comes back with its category and no words', { skip }, async () => {
  const { a, sendCard, nsfw } = await setup();
  for (const c of nsfw.NSFW_CARDS) {
    const res = await sendCard(a, c.id);
    assert.equal(res.statusCode, 201, c.id);
    assert.equal(res.body.card.category, c.category);
    assert.equal(res.body.card.deck, 'nsfw');
    assert.equal(res.body.text, 'Mature card');
  }
});

test('a Comfort Card still works exactly as before (question in text, no deck), next to NSFW Cards', { skip }, async () => {
  const { a, b, sendCard, load } = await setup();
  const comfort = await sendCard(a, 'soft-01');
  assert.equal(comfort.statusCode, 201);
  assert.deepEqual(comfort.body.card, { id: 'soft-01', category: 'soft' });
  assert.match(comfort.body.text, /smile today/);
  await sendCard(b, 'nsfw-flirty-01');
  const seen = (await load(a)).body.messages;
  assert.deepEqual(seen.map((m) => m.card?.deck ?? 'comfort'), ['comfort', 'nsfw']);
});

test('forging an NSFW card is refused: unknown ids, wrong case, words of your own and extra fields all fail and store nothing', { skip }, async () => {
  const { a, sendCard, call, pairId, db } = await setup();
  for (const bad of ['nsfw-flirty-99', 'NSFW-FLIRTY-01', 'nsfw-flirty-1', 'nsfw-other-01', 'nsfw-', '', 'x', 5, {}, ['nsfw-flirty-01']]) {
    assert.equal((await sendCard(a, bad)).statusCode, 400, String(bad));
  }
  for (const extra of [{ text: 'my own words' }, { question: 'a forged question' }, { card: { id: 'nsfw-flirty-01' } }, { category: 'spicy' }, { gifId: 'abc' }]) {
    assert.equal((await sendCard(a, 'nsfw-flirty-01', extra)).statusCode, 400, JSON.stringify(extra));
  }
  // An NSFW id is only ever a card: as plain text it is refused.
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'hi', cardId: 'nsfw-flirty-01' })).statusCode, 400);
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 0, 'nothing was stored');
});

test('a retry of the same send never makes a second NSFW card or a second unread', { skip }, async () => {
  const { a, sendCard, inboxOf, db, pairId, b } = await setup();
  const first = await sendCard(a, 'nsfw-intimate-02', { messageId: 'nsfw-message-0001' });
  assert.equal(first.statusCode, 201);
  const again = await sendCard(a, 'nsfw-intimate-02', { messageId: 'nsfw-message-0001' });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body.card, { id: 'nsfw-intimate-02', category: 'intimate', deck: 'nsfw' });
  assert.equal(again.body.text, 'Mature card');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 1);
  assert.equal((await inboxOf(b)).unread[pairId], 1);
  // The same id with a different card is not a retry.
  assert.equal((await sendCard(a, 'nsfw-intimate-03', { messageId: 'nsfw-message-0001' })).statusCode, 409);
});

test('NSFW Cards cannot bypass blocking, suspension, ended chats or membership', { skip }, async () => {
  const { a, b, outsider, sendCard, db, pairId, load } = await setup();
  assert.equal((await sendCard(outsider, 'nsfw-flirty-01')).statusCode, 403, 'not in the conversation');
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
  assert.equal((await sendCard(a, 'nsfw-flirty-01')).statusCode, 403, 'blocked');
  assert.equal((await sendCard(b, 'nsfw-flirty-01')).statusCode, 403, 'blocked the other way');
  assert.equal((await load(a)).body.error, 'conversation_unavailable');
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${a.uid}`).set({ source: 'admin', reason: 'test' });
  assert.equal((await sendCard(b, 'nsfw-flirty-01')).statusCode, 403, 'suspended');
  await db.doc(`suspensions/${a.uid}`).delete();
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await sendCard(a, 'nsfw-flirty-01')).statusCode, 409, 'ended conversations are closed');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 0);
});

test('either member can answer an NSFW Card with an ordinary reply, and the quote never carries the question', { skip }, async () => {
  const { a, b, sendCard, call, pairId, load, nsfw } = await setup();
  const card = await sendCard(a, 'nsfw-boundaries-01');
  const reply = await call(b, 'POST', { action: 'send-message', pairId, text: 'I like being asked first.', replyTo: { messageId: card.body.id, text: 'Mature card', sender: 'partner' } });
  assert.equal(reply.statusCode, 201);
  const seen = (await load(a)).body.messages;
  assert.equal(seen[1].replyTo.messageId, card.body.id);
  assert.equal(seen[1].replyTo.text, 'Mature card');
  assert.equal(JSON.stringify(seen).includes(nsfw.nsfwCardById('nsfw-boundaries-01').question), false);
});
