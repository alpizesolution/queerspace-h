// Stickers in Signals against the real emulators: a sticker is sent by its id alone, the server checks it against its own list, both people see it,
// the inbox preview and unread count follow, ordering and paging include it, and every way of forging or abusing one is refused.
// After Dark (18+) is not available: its ids are refused like any other unknown id.
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
  const sendSticker = (user, stickerId, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'sticker', stickerId, ...extra });
  const sendText = (user, text, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, text, ...extra });
  const load = (user, query = {}) => call(user, 'GET', undefined, { view: 'messages', pairId, ...query });
  const count = async () => (await db.collection(`signalsPairs/${pairId}/messages`).get()).size;
  return { db, pairId, a, b, outsider, call, sendSticker, sendText, load, count };
}

test('a member can send a sticker by id; the server stores only the id and pack, and both people see it', { skip }, async () => {
  const { db, pairId, a, b, sendSticker, load } = await setup();
  const res = await sendSticker(a, 'sapphic-feelings-05');
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.kind, 'sticker');
  assert.equal(res.body.text, 'Sticker');
  assert.deepEqual(res.body.sticker, { id: 'sapphic-feelings-05', packId: 'sapphic-feelings' });
  assert.equal(res.body.senderId, a.uid);
  assert.ok(res.body.createdAt);
  const stored = (await db.collection(`signalsPairs/${pairId}/messages`).doc(res.body.id).get()).data();
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'kind', 'senderId', 'sticker', 'text', 'updatedAt']);
  assert.deepEqual(stored.sticker, { id: 'sapphic-feelings-05', packId: 'sapphic-feelings' });
  for (const viewer of [a, b]) {
    const seen = (await load(viewer)).body.messages;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'sticker');
    assert.deepEqual(seen[0].sticker, { id: 'sapphic-feelings-05', packId: 'sapphic-feelings' });
    assert.equal(seen[0].senderId, a.uid);
  }
});

test('every sticker in both regular packs can be sent', { skip }, async () => {
  const { sendSticker, a, count } = await setup();
  const { STICKERS } = await import('../../api/_stickers.js');
  assert.equal(STICKERS.length, 40);
  for (const sticker of STICKERS) {
    const res = await sendSticker(a, sticker.id);
    assert.equal(res.statusCode, 201, sticker.id);
    assert.equal(res.body.sticker.packId, sticker.packId);
  }
  assert.equal(await count(), 40);
});

test('unknown ids, After Dark ids, links and extra fields are refused and nothing is stored', { skip }, async () => {
  const { a, sendSticker, call, pairId, count } = await setup();
  const refused = [
    await sendSticker(a, 'after-dark-01'),
    await sendSticker(a, 'after-dark-20'),
    await sendSticker(a, 'sapphic-feelings-00'),
    await sendSticker(a, 'sapphic-feelings-21'),
    await sendSticker(a, '../sapphic-feelings-01'),
    await sendSticker(a, 'SAPPHIC-FEELINGS-01'),
    await sendSticker(a, undefined),
    await sendSticker(a, 5),
    await sendSticker(a, { id: 'sapphic-feelings-01' }),
    await sendSticker(a, 'sapphic-feelings-01', { text: 'my own words' }),
    await sendSticker(a, 'sapphic-feelings-01', { stickerPackId: 'after-dark' }),
    await sendSticker(a, 'sapphic-feelings-01', { packId: 'after-dark' }),
    await sendSticker(a, 'sapphic-feelings-01', { sticker: { id: 'after-dark-01' } }),
    await sendSticker(a, 'sapphic-feelings-01', { url: 'https://evil.example/x.png' }),
    await sendSticker(a, 'sapphic-feelings-01', { path: '/stickers/after-dark/01_come_here.png' }),
    await sendSticker(a, 'sapphic-feelings-01', { gifId: 'goodGif123' }),
    await sendSticker(a, 'sapphic-feelings-01', { cardId: 'soft-01' }),
    await call(a, 'POST', { action: 'send-message', pairId, kind: 'sticker', text: 'just text as a sticker' }),
  ];
  for (const r of refused) assert.equal(r.statusCode, 400, JSON.stringify(r.body));
  // Sticker fields on an ordinary or another kind of message are refused too.
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'hi', stickerId: 'sapphic-feelings-01' })).statusCode, 400);
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, kind: 'card', cardId: 'soft-01', stickerId: 'sapphic-feelings-01' })).statusCode, 400);
  assert.equal(await count(), 0, 'nothing was stored');
});

test('only a member of an active connection can send a sticker, and blocked or suspended members cannot, exactly like text', { skip }, async () => {
  const { db, outsider, a, b, sendSticker, sendText, call, pairId, count } = await setup();
  assert.equal((await sendSticker(outsider, 'sapphic-feelings-01')).statusCode, 403);
  assert.equal((await call(null, 'POST', { action: 'send-message', pairId, kind: 'sticker', stickerId: 'sapphic-feelings-01' })).statusCode, 401);
  const ended = await setup('ended');
  assert.equal((await ended.sendSticker(ended.a, 'sapphic-feelings-01')).statusCode, 409);
  assert.equal(await ended.count(), 0);
  const fresh = await setup();
  await fresh.db.doc(`users/${fresh.b.uid}/private/settings`).set({ blockedPartnerIds: [fresh.a.uid] });
  assert.equal((await fresh.sendSticker(fresh.a, 'sapphic-feelings-01')).statusCode, 403);
  assert.equal((await fresh.sendText(fresh.a, 'hi')).statusCode, 403);
  await fresh.db.doc(`users/${fresh.b.uid}/private/settings`).set({ blockedPartnerIds: [] });
  await fresh.db.doc(`suspensions/${fresh.a.uid}`).set({ source: 'admin', reason: 'test', createdAt: new Date() });
  assert.equal((await fresh.sendSticker(fresh.a, 'sapphic-feelings-01')).statusCode, 403);
  assert.equal(await fresh.count(), 0);
  void db; void b; void a; void sendText; void count;
});

test('retrying a sticker send with the same message id never makes a second sticker or a second unread', { skip }, async () => {
  const { db, a, b, sendSticker, count, pairId } = await setup();
  const messageId = 'sticker-retry-0001';
  const first = await sendSticker(a, 'androgynous-sapphic-04', { messageId });
  const again = await sendSticker(a, 'androgynous-sapphic-04', { messageId });
  assert.equal(first.statusCode, 201);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body.sticker, { id: 'androgynous-sapphic-04', packId: 'androgynous-sapphic' });
  assert.equal(again.body.id, messageId);
  assert.equal(await count(), 1);
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1);
  assert.equal((await sendSticker(a, 'androgynous-sapphic-05', { messageId })).statusCode, 409);
  assert.equal((await sendSticker(b, 'androgynous-sapphic-04', { messageId })).statusCode, 409);
});

test('the inbox preview says "Sticker" for both people, and the unread count goes up for the recipient only', { skip }, async () => {
  const { db, a, b, sendSticker, sendText, pairId } = await setup();
  await sendText(a, 'hello');
  await sendSticker(a, 'sapphic-feelings-02');
  const recipient = (await db.doc(`signalsInbox/${b.uid}`).get()).data();
  const sender = (await db.doc(`signalsInbox/${a.uid}`).get()).data();
  assert.equal(recipient.unread[pairId], 2);
  assert.equal(recipient.last[pairId].text, 'Sticker');
  assert.equal(recipient.last[pairId].mine, false);
  assert.equal(sender.last[pairId].text, 'Sticker');
  assert.equal(sender.last[pairId].mine, true);
  assert.equal(sender.unread?.[pairId] ?? 0, 0);
  await sendText(b, 'thanks');
  assert.equal((await db.doc(`signalsInbox/${a.uid}`).get()).data().last[pairId].text, 'thanks', 'a later text replaces the preview');
});

test('ordering and paging include stickers with text: newest page first on opening, older pages by cursor, nothing lost or repeated', { skip }, async () => {
  const { a, b, sendSticker, sendText, load } = await setup();
  const order = [];
  for (let i = 1; i <= 24; i += 1) {
    const sender = i % 2 ? a : b;
    const res = i % 3 === 0 ? await sendSticker(sender, `sapphic-feelings-${String((i % 20) + 1).padStart(2, '0')}`) : await sendText(sender, `message ${i}`);
    assert.equal(res.statusCode, 201);
    order.push(res.body.id);
    await new Promise((r) => setTimeout(r, 5));
  }
  const newest = (await load(a, { limit: '10' })).body;
  assert.equal(newest.messages.length, 10);
  assert.deepEqual(newest.messages.map((m) => m.id), order.slice(14), 'the newest ten, oldest first');
  assert.ok(newest.messages.some((m) => m.kind === 'sticker'));
  assert.ok(newest.olderCursor);
  const older = (await load(b, { limit: '10', before: newest.olderCursor })).body;
  assert.deepEqual(older.messages.map((m) => m.id), order.slice(4, 14));
  const oldest = (await load(a, { limit: '10', before: older.olderCursor })).body;
  assert.deepEqual(oldest.messages.map((m) => m.id), order.slice(0, 4));
  assert.equal(oldest.olderCursor, null);
  for (const m of [...older.messages, ...oldest.messages, ...newest.messages].filter((m) => m.kind === 'sticker')) assert.ok(m.sticker.id && m.sticker.packId);
});

test('a stored sticker record with a forged pack or an unlisted id is read back from the list, or as plain text', { skip }, async () => {
  const { db, a, b, pairId, load } = await setup();
  const col = db.collection(`signalsPairs/${pairId}/messages`);
  const now = new Date();
  await col.doc('forged-pack').set({ senderId: a.uid, text: 'Sticker', kind: 'sticker', sticker: { id: 'sapphic-feelings-03', packId: 'after-dark' }, createdAt: now, updatedAt: now });
  await col.doc('after-dark-id').set({ senderId: a.uid, text: 'Sticker', kind: 'sticker', sticker: { id: 'after-dark-03', packId: 'after-dark' }, createdAt: new Date(now.getTime() + 1000), updatedAt: now });
  const seen = (await load(b)).body.messages;
  assert.deepEqual(seen[0].sticker, { id: 'sapphic-feelings-03', packId: 'sapphic-feelings' });
  assert.equal(seen[1].kind, undefined, 'an unlisted id is shown as plain text');
  assert.equal(seen[1].sticker, undefined);
  assert.equal(seen[1].text, 'Sticker');
});

test('existing message types are unaffected: text, replies and Comfort Cards still send and read back; a sticker can be replied to', { skip }, async () => {
  const { a, b, sendText, sendSticker, call, pairId, load } = await setup();
  assert.equal((await sendText(a, 'hello')).statusCode, 201);
  const card = await call(a, 'POST', { action: 'send-message', pairId, kind: 'card', cardId: 'soft-01' });
  assert.equal(card.statusCode, 201);
  const sticker = (await sendSticker(a, 'sapphic-feelings-07')).body;
  const reply = await sendText(b, 'cute!', { replyTo: { messageId: sticker.id, text: sticker.text, sender: 'partner' } });
  assert.equal(reply.statusCode, 201);
  const thread = (await load(b)).body.messages;
  assert.deepEqual(thread.map((m) => m.kind), [undefined, 'card', 'sticker', undefined]);
  assert.equal(thread[3].replyTo.messageId, sticker.id);
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, kind: 'bogus', text: 'x' })).statusCode, 400);
});

test('a sticker can be reacted to like any message', { skip }, async () => {
  const { a, b, sendSticker, call, pairId } = await setup();
  const sticker = (await sendSticker(a, 'sapphic-feelings-09')).body;
  const res = await call(b, 'POST', { action: 'react-message', pairId, messageId: sticker.id, emoji: '❤️' });
  assert.ok([200, 201].includes(res.statusCode), JSON.stringify(res.body));
});
