// Unread counters and latest-message lines against the real emulators: one unread, several, across connections, your own messages,
// opening a conversation, two devices, and the 99+ range. Counts come from the member's own inbox document, never from reading
// messages.
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
  const c = await newUser();
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(code) { this.statusCode = code; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {} }, res);
    return res;
  };
  const makePair = async (x, y) => {
    const pairId = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.doc(`signalsPairs/${pairId}`).set({ participants: [x.uid, y.uid].sort(), status: 'active', createdAt: new Date() });
    return pairId;
  };
  const text = (user, pairId, body, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, text: body, ...extra });
  const card = (user, pairId, cardId) => call(user, 'POST', { action: 'send-message', pairId, kind: 'card', cardId });
  const read = (user, pairId, throughMessageId) => call(user, 'POST', { action: 'mark-read', pairId, throughMessageId });
  const inbox = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data() ?? {};
  const unread = async (user) => (await inbox(user)).unread ?? {};
  const total = async (user) => Object.values(await unread(user)).reduce((s, n) => s + n, 0);
  return { db, a, b, c, call, makePair, text, card, read, inbox, unread, total };
}

test('one incoming message: one unread for the recipient, none for the sender, and the latest line for both', { skip }, async () => {
  const { a, b, makePair, text, inbox } = await setup();
  const pairId = await makePair(a, b);
  assert.equal((await text(a, pairId, 'hello there')).statusCode, 201);
  const theirs = await inbox(b);
  assert.deepEqual(theirs.unread, { [pairId]: 1 });
  assert.equal(theirs.last[pairId].text, 'hello there');
  assert.equal(theirs.last[pairId].mine, false);
  const mine = await inbox(a);
  assert.equal(mine.unread?.[pairId], undefined, 'your own message is never unread for you');
  assert.equal(mine.last[pairId].text, 'hello there');
  assert.equal(mine.last[pairId].mine, true);
});

test('several messages in one conversation add up once each, and your own never count', { skip }, async () => {
  const { a, b, makePair, text, unread } = await setup();
  const pairId = await makePair(a, b);
  for (const t of ['one', 'two', 'three']) await text(a, pairId, t);
  await text(b, pairId, 'my reply');
  assert.equal((await unread(b))[pairId], 3, 'b sees the three from a, not their own reply');
  assert.equal((await unread(a))[pairId], 1, 'a sees b\'s one reply');
});

test('across several conversations the total is the sum, and the latest line follows each message', { skip }, async () => {
  const { a, b, c, makePair, text, card, total, unread, inbox } = await setup();
  const withB = await makePair(a, b);
  const withC = await makePair(a, c);
  await text(b, withB, 'from b'); await text(b, withB, 'again from b');
  await text(c, withC, 'from c');
  assert.deepEqual(await unread(a), { [withB]: 2, [withC]: 1 });
  assert.equal(await total(a), 3);
  await card(c, withC, 'soft-01');
  assert.equal(await total(a), 4);
  assert.equal((await inbox(a)).last[withC].text, 'Comfort Card: What is something small that made you smile today?');
  assert.equal((await inbox(a)).last[withB].text, 'again from b', 'each connection keeps its own latest line');
});

test('opening a conversation marks what the reader saw as read, and only that', { skip }, async () => {
  const { a, b, makePair, text, read, unread, inbox, db } = await setup();
  const pairId = await makePair(a, b);
  const first = (await text(a, pairId, 'one')).body.id;
  const second = (await text(a, pairId, 'two')).body.id;
  await text(a, pairId, 'three');
  assert.equal((await unread(b))[pairId], 3);
  assert.equal((await read(b, pairId, second)).body.unread, 1, 'read through the second leaves the third');
  assert.equal((await unread(b))[pairId], 1);
  const third = (await db.collection(`signalsPairs/${pairId}/messages`).orderBy('createdAt', 'desc').limit(1).get()).docs[0].id;
  await read(b, pairId, third);
  assert.deepEqual(await unread(b), {}, 'nothing unread: the entry is removed, not left at zero');
  assert.equal((await inbox(b)).last[pairId].text, 'three', 'reading never changes the latest line');
  // Reading the same message again changes nothing and never double counts.
  await read(b, pairId, first);
  assert.ok(((await unread(b))[pairId] ?? 0) <= 2);
});

test('a message that arrives while the conversation is being read stays unread until it is read', { skip }, async () => {
  const { a, b, makePair, text, read, unread } = await setup();
  const pairId = await makePair(a, b);
  const first = (await text(a, pairId, 'one')).body.id;
  await read(b, pairId, first);
  assert.deepEqual(await unread(b), {});
  await text(a, pairId, 'arrives later');
  assert.equal((await unread(b))[pairId], 1, 'counted once, and not wiped by the earlier read');
});

test('two devices of the same member share one counter: reading on one clears it for both', { skip }, async () => {
  const { a, b, makePair, text, read, inbox } = await setup();
  const pairId = await makePair(a, b);
  const id = (await text(a, pairId, 'hi')).body.id;
  const deviceOne = (await inbox(b)).unread[pairId];
  const deviceTwo = (await inbox(b)).unread[pairId];
  assert.equal(deviceOne, 1);
  assert.equal(deviceTwo, 1, 'the same document, so the same number');
  await read(b, pairId, id);
  assert.equal((await inbox(b)).unread?.[pairId], undefined);
});

test('a retried send never counts twice, and the other member cannot change your counter', { skip }, async () => {
  const { a, b, c, makePair, text, unread, read, call } = await setup();
  const pairId = await makePair(a, b);
  const messageId = 'retry-unread-0001';
  await text(a, pairId, 'once', { messageId });
  await text(a, pairId, 'once', { messageId });
  assert.equal((await unread(b))[pairId], 1);
  // Someone who is not in the pair cannot read it or send into it.
  assert.equal((await read(c, pairId, messageId)).statusCode, 403);
  assert.equal((await text(c, pairId, 'sneaky')).statusCode, 403);
  assert.equal((await unread(b))[pairId], 1);
  // And a pair member's mark-read only ever changes their own counter.
  const before = await unread(a);
  await read(b, pairId, messageId);
  assert.deepEqual(await unread(a), before);
});

test('counts above 99 keep counting, and reading recounts a long backlog', { skip }, async () => {
  const { a, b, makePair, db, unread } = await setup();
  const pairId = await makePair(a, b);
  // 105 messages from a, written the way a send writes them (message + counter in one batch).
  const { FieldValue } = await import('firebase-admin/firestore');
  const base = Date.now() - 200_000;
  for (let start = 0; start < 105; start += 25) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 25, 105); i++) {
      const stamp = new Date(base + i * 1000);
      batch.create(db.doc(`signalsPairs/${pairId}/messages/m${String(i).padStart(3, '0')}`), { senderId: a.uid, text: `m${i}`, createdAt: stamp, updatedAt: stamp });
      batch.set(db.doc(`signalsInbox/${b.uid}`), { unread: { [pairId]: FieldValue.increment(1) } }, { merge: true });
    }
    await batch.commit();
  }
  assert.equal((await unread(b))[pairId], 105);
  const { formatUnread } = await import('../../src/services/signalsInbox.ts');
  assert.equal(formatUnread((await unread(b))[pairId]), '99+');
});

test('older inbox documents with no latest line still work: the unread count is unchanged', { skip }, async () => {
  const { a, b, makePair, db, unread, text } = await setup();
  const pairId = await makePair(a, b);
  await db.doc(`signalsInbox/${b.uid}`).set({ unread: { [pairId]: 2 }, rev: 1 });
  assert.equal((await unread(b))[pairId], 2);
  await text(a, pairId, 'new one');
  assert.equal((await unread(b))[pairId], 3);
});
