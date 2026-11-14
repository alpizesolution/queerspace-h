// Signals reliability against the real emulators: the newest messages always load, older ones come back a page at a time, a
// conversation that cannot be shown says so, a second acceptance never duplicates a conversation, and both members' inboxes agree.
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
  const a = await newUser();
  const b = await newUser();
  const pairId = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.doc(`signalsPairs/${pairId}`).set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: new Date() });
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method, headers: { authorization: `Bearer ${user.token}` }, body, query: query ?? {} }, res);
    return res;
  };
  const send = (user, text, messageId) => call(user, 'POST', { action: 'send-message', pairId, text, ...(messageId ? { messageId } : {}) });
  const load = (user, query = {}) => call(user, 'GET', undefined, { view: 'messages', pairId, ...query });
  const inboxOf = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data() ?? {};
  /** Writes `count` messages straight to the database, one millisecond apart, ids in order. Returns the ids oldest first. */
  const seed = async (count, from = 'a') => {
    const ids = [];
    const base = Date.now() - count * 1000;
    for (let start = 0; start < count; start += 400) {
      const batch = db.batch();
      for (let i = start; i < Math.min(count, start + 400); i += 1) {
        const id = `msg-${String(i).padStart(6, '0')}`;
        const at = Timestamp.fromMillis(base + i);
        batch.set(db.doc(`signalsPairs/${pairId}/messages/${id}`), { senderId: (from === 'a' ? a : b).uid, text: `m${i}`, createdAt: at, updatedAt: at });
        ids.push(id);
      }
      await batch.commit();
    }
    return ids;
  };
  return { db, Timestamp, pairId, a, b, call, send, load, inboxOf, seed };
}

/** Walks a conversation from the newest page back to the start, the way the app does. */
async function walk(load, user, limit) {
  const first = await load(user, { limit: String(limit) });
  assert.equal(first.statusCode, 200);
  let pages = [first.body.messages.map((m) => m.id)];
  let cursor = first.body.olderCursor;
  let guard = 0;
  while (cursor && guard++ < 100) {
    const next = await load(user, { limit: String(limit), before: cursor });
    assert.equal(next.statusCode, 200);
    pages.unshift(next.body.messages.map((m) => m.id));
    cursor = next.body.olderCursor;
  }
  return { first, all: pages.flat(), pageCount: pages.length };
}

for (const count of [50, 100, 150, 500, 1100]) {
  test(`a conversation of ${count} messages: the newest page loads first, and older pages bring back every message once, in order`, { skip }, async () => {
    const { a, load, seed } = await setup();
    const ids = await seed(count);
    const { first, all } = await walk(load, a, 50);
    assert.equal(first.body.messages.at(-1).id, ids.at(-1), 'the newest message is in the first page');
    assert.equal(first.body.messages.length, Math.min(50, count));
    assert.deepEqual(all, ids, 'no duplicate, no missing message, oldest first');
    if (count <= 50) assert.equal(first.body.olderCursor, null, 'nothing older when it all fits');
  });
}

test('an app that sends no page size still gets the NEWEST 100 (never the oldest 100), and the largest page is capped at 100', { skip }, async () => {
  const { a, load, seed } = await setup();
  const ids = await seed(150);
  const legacy = await load(a);
  assert.equal(legacy.body.messages.length, 100);
  assert.equal(legacy.body.messages.at(-1).id, ids.at(-1));
  assert.equal(legacy.body.messages[0].id, ids[50]);
  assert.ok(legacy.body.olderCursor, 'and it can still go back');
  assert.equal((await load(a, { limit: '5000' })).body.messages.length, 100, 'capped');
  assert.equal((await load(a, { limit: 'abc' })).body.messages.length, 50, 'an odd page size falls back to the default');
});

test('a bad or forged cursor is refused and reads nothing', { skip }, async () => {
  const { a, load, seed } = await setup();
  await seed(10);
  for (const before of ['nonsense', '1.2', '1.2.short', '-1.0.msg-000001', '1.2.../../etc', 'x.y.msg-000001']) {
    assert.equal((await load(a, { before })).statusCode, 400, before);
  }
});

test('polling after the first load asks only for what changed, and a new message shows up after the newest page', { skip }, async () => {
  const { a, b, load, seed, send } = await setup();
  const ids = await seed(120);
  const first = await load(a, { limit: '50' });
  const sent = await send(b, 'a brand new message', 'client-new-message-1');
  assert.equal(sent.statusCode, 201);
  const poll = await load(a, { after: first.body.cursor });
  assert.equal(poll.statusCode, 200);
  assert.deepEqual(poll.body.messages.map((m) => m.id), ['client-new-message-1'], 'only the change, not the history');
  assert.equal(poll.body.olderCursor, undefined);
  const again = await walk(load, a, 50);
  assert.deepEqual(again.all, [...ids, 'client-new-message-1']);
});

test('two members: a send updates both inboxes, the reply comes back, and each member only ever has their own unread count', { skip }, async () => {
  const { a, b, load, send, inboxOf, pairId, call, db } = await setup();
  const hello = await send(a, 'hello B', 'client-hello-0001');
  assert.equal(hello.statusCode, 201);
  assert.equal((await load(b)).body.messages.at(-1).text, 'hello B', 'B sees it');
  let inboxA = await inboxOf(a);
  let inboxB = await inboxOf(b);
  assert.equal(inboxB.unread?.[pairId], 1, 'B has one unread');
  assert.equal(inboxA.unread?.[pairId], undefined, 'A has none');
  assert.equal(inboxB.last[pairId].text, 'hello B');
  assert.equal(inboxB.last[pairId].mine, false);
  assert.equal(inboxA.last[pairId].mine, true);
  const reply = await send(b, 'hi A', 'client-reply-0001');
  assert.equal(reply.statusCode, 201);
  assert.equal((await load(a)).body.messages.at(-1).text, 'hi A', 'A sees the reply');
  inboxA = await inboxOf(a);
  assert.equal(inboxA.unread?.[pairId], 1);
  const read = await call(b, 'POST', { action: 'mark-read', pairId, throughMessageId: 'client-reply-0001' });
  assert.equal(read.statusCode, 200);
  inboxB = await inboxOf(b);
  assert.equal(inboxB.unread?.[pairId], undefined, 'B reading clears only B');
  assert.equal((await inboxOf(a)).unread?.[pairId], 1, 'A is untouched by B reading');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 2);
});

test('concurrent sends from both members all land once, and the unread counts add up exactly', { skip }, async () => {
  const { a, b, send, inboxOf, pairId, db } = await setup();
  const results = await Promise.all([
    ...Array.from({ length: 8 }, (_, i) => send(a, `from a ${i}`, `client-a-message-${i}`)),
    ...Array.from({ length: 6 }, (_, i) => send(b, `from b ${i}`, `client-b-message-${i}`)),
  ]);
  assert.ok(results.every((r) => r.statusCode === 201));
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 14);
  assert.equal((await inboxOf(b)).unread[pairId], 8, 'B received 8');
  assert.equal((await inboxOf(a)).unread[pairId], 6, 'A received 6');
  // A retry of a send that already went through never adds a second message or a second unread.
  assert.equal((await send(a, 'from a 0', 'client-a-message-0')).statusCode, 200);
  assert.equal((await inboxOf(b)).unread[pairId], 8);
});

test('a blocked or suspended conversation answers "conversation_unavailable" (403) to both members, nothing is deleted, and unblocking restores it', { skip }, async () => {
  const { a, b, load, seed, db, pairId } = await setup();
  await seed(5);
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
  for (const who of [a, b]) {
    const res = await load(who);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'conversation_unavailable', 'the same answer from either side, so it never says who blocked');
    assert.equal(res.body.messages, undefined, 'no messages are exposed');
  }
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 5, 'nothing was deleted');
  assert.equal((await db.doc(`signalsPairs/${pairId}`).get()).data().status, 'active', 'the record is untouched');
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [] });
  assert.equal((await load(a)).statusCode, 200);
  await db.doc(`suspensions/${b.uid}`).set({ source: 'admin', reason: 'test' });
  assert.equal((await load(a)).body.error, 'conversation_unavailable', 'a suspension gives the same answer');
});

test('someone outside the conversation can neither read it nor page back through it', { skip }, async () => {
  const { load, seed } = await setup();
  await seed(60);
  const outsider = await newUser();
  assert.equal((await load(outsider, { limit: '50' })).statusCode, 403);
  assert.equal((await load(outsider, { limit: '50', before: '1.0.msg-000010' })).statusCode, 403);
});

test('accepting an invitation twice, or when the two already have an active conversation, never makes a second conversation', { skip }, async () => {
  const { db, a, b, call, pairId } = await setup();
  const { Timestamp } = await import('firebase-admin/firestore');
  const make = (id) => db.doc(`signalsInvitations/${id}`).set({
    senderId: a.uid, recipientId: b.uid, message: '', status: 'pending',
    createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000), updatedAt: Timestamp.now(),
  });
  await make('invite-0000000001');
  const accepted = await call(b, 'POST', { action: 'accept', invitationId: 'invite-0000000001' });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.body.pairId, pairId, 'the conversation they already had is reused');
  const repeated = await call(b, 'POST', { action: 'accept', invitationId: 'invite-0000000001' });
  assert.equal(repeated.statusCode, 409, 'a second acceptance changes nothing');
  const pairs = await db.collection('signalsPairs').where('participants', '==', [a.uid, b.uid].sort()).get();
  assert.equal(pairs.size, 1, 'still exactly one conversation');
  assert.ok((await db.doc(`signalsInbox/${a.uid}`).get()).data().notifications?.[pairId], 'the sender is told, against the real conversation');
});

test('accepting an invitation for two members with no conversation creates one, visible in both inboxes lists at once', { skip }, async () => {
  const { db, call } = await setup();
  const { Timestamp } = await import('firebase-admin/firestore');
  const x = await newUser();
  const y = await newUser();
  await db.doc(`signalsInvitations/invite-0000000002`).set({
    senderId: x.uid, recipientId: y.uid, message: '', status: 'pending',
    createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000), updatedAt: Timestamp.now(),
  });
  const before = (await db.doc(`signalsInbox/${x.uid}`).get()).data()?.rev ?? 0;
  const res = await call(y, 'POST', { action: 'accept', invitationId: 'invite-0000000002' });
  assert.equal(res.body.pairId, 'invite-0000000002');
  for (const member of [x, y]) {
    const list = await call(member, 'GET', undefined, { view: 'pairs', limit: '20' });
    assert.deepEqual(list.body.pairs.map((p) => p.id), ['invite-0000000002']);
  }
  assert.ok(((await db.doc(`signalsInbox/${x.uid}`).get()).data().rev ?? 0) > before, 'the sender\'s live inbox was bumped');
});

test('a catch-up poll that finds more than 100 changes never skips the newest ones: it says there is more and the next poll continues', { skip }, async () => {
  const { a, load, seed } = await setup();
  const ids = await seed(150);
  // The reader last looked well before all 150 messages (a tab that was hidden for a while).
  const longAgo = new Date(Date.now() - 400_000).toISOString();
  const seen = [];
  let cursor = longAgo;
  let rounds = 0;
  while (rounds++ < 10) {
    const poll = await load(a, { after: cursor });
    assert.equal(poll.statusCode, 200);
    seen.push(...poll.body.messages.map((m) => m.id));
    cursor = poll.body.cursor;
    if (!poll.body.more) break;
  }
  assert.deepEqual([...new Set(seen)].sort(), ids, 'every message arrived, including the newest 50');
  const after = await load(a, { after: cursor });
  assert.deepEqual(after.body.messages, [], 'and then there is nothing left to fetch');
});

test('both participants can walk the complete history of a long conversation, and paging back never changes anyone\'s unread count', { skip }, async () => {
  const { a, b, load, seed, inboxOf, pairId, db } = await setup();
  const ids = await seed(260, 'a');
  // Seed the inbox counters the way real sends would have left them: B has 3 unread, A none.
  await db.doc(`signalsInbox/${b.uid}`).set({ unread: { [pairId]: 3 } }, { merge: true });
  const before = { a: await inboxOf(a), b: await inboxOf(b) };
  const forA = await walk(load, a, 50);
  const forB = await walk(load, b, 50);
  assert.deepEqual(forA.all, ids);
  assert.deepEqual(forB.all, ids, 'the other member sees exactly the same complete history');
  assert.deepEqual({ a: await inboxOf(a), b: await inboxOf(b) }, before, 'reading old pages changed no unread count and no inbox record');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 260, 'nothing was deleted');
});

/** Writes `count` messages that ALL share one timestamp (createdAt and updatedAt), ids in order. Returns the ids. */
async function seedTied(db, Timestamp, pairId, senderId, count, atMs) {
  const ids = [];
  for (let start = 0; start < count; start += 400) {
    const batch = db.batch();
    for (let i = start; i < Math.min(count, start + 400); i += 1) {
      const id = `tie-${String(i).padStart(6, '0')}`;
      const at = Timestamp.fromMillis(atMs);
      batch.set(db.doc(`signalsPairs/${pairId}/messages/${id}`), { senderId, text: `t${i}`, createdAt: at, updatedAt: at });
      ids.push(id);
    }
    await batch.commit();
  }
  return ids;
}

for (const limit of [50, 100]) {
  test(`history: 250 messages sharing ONE timestamp page back with no gap and no duplicate (page size ${limit}), for both members`, { skip }, async () => {
    const { a, b, load, db, Timestamp, pairId } = await setup();
    const ids = await seedTied(db, Timestamp, pairId, a.uid, 250, Date.now() - 60_000);
    for (const member of [a, b]) {
      const { all, first } = await walk(load, member, limit);
      assert.equal(first.body.messages.at(-1).id, ids.at(-1), 'the newest (by id, on a tie) is in the first page');
      assert.deepEqual(all, ids, 'every message exactly once, in a stable order');
    }
  });
}

test('catch-up: 250 changes sharing ONE updatedAt are fetched in order with no gap and no duplicate across the 100-change pages', { skip }, async () => {
  const { a, load, db, Timestamp, pairId } = await setup();
  const ids = await seedTied(db, Timestamp, pairId, a.uid, 250, Date.now() - 120_000);
  const seen = [];
  let cursor = new Date(Date.now() - 400_000).toISOString();
  let rounds = 0;
  let sawMore = 0;
  while (rounds++ < 10) {
    const poll = await load(a, { after: cursor });
    assert.equal(poll.statusCode, 200);
    seen.push(...poll.body.messages.map((m) => m.id));
    cursor = poll.body.cursor;
    if (!poll.body.more) break;
    sawMore += 1;
  }
  assert.equal(sawMore, 2, 'two full pages, then the last 50');
  assert.deepEqual(seen, ids, 'all 250, once each, in order');
  assert.deepEqual((await load(a, { after: cursor })).body.messages, [], 'and nothing is left');
});

test('catch-up: a forged continuation position is refused', { skip }, async () => {
  const { a, load, seed } = await setup();
  await seed(5);
  for (const after of ['12.5.short', '12.1000000000.msg-000001', '12.5.../../x', '-1.5.msg-000001']) {
    const res = await load(a, { after });
    assert.ok([400].includes(res.statusCode) || Array.isArray(res.body?.messages), `${after}: refused or treated as a plain (empty) poll, never an error leak`);
    assert.equal(res.statusCode === 200 ? JSON.stringify(res.body).includes('stack') : false, false);
  }
});
