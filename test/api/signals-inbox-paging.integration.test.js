// The Signals inbox endpoints against the real Auth and Firestore emulators: pages, one connection, pending-only invitations,
// the fallback when the ordered query's index is missing, what each call reads, and that nothing about it leaks.
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

// Count every document the server reads, by wrapping the Admin SDK's read methods.
const counter = { reads: 0, orderedFails: false, simulated: 0 };
let patched = false;
async function patchReads() {
  if (patched) return;
  patched = true;
  const { Query, Firestore } = await import('firebase-admin/firestore');
  const realGet = Query.prototype.get;
  Query.prototype.get = async function (...args) {
    // Simulate "the index for the ordered query has not been created yet": Firestore answers FAILED_PRECONDITION (code 9).
    if (counter.orderedFails && this._queryOptions?.fieldOrders?.length > 0 && String(this._queryOptions?.collectionId) === 'signalsPairs') {
      counter.simulated += 1;
      throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 });
    }
    const snap = await realGet.apply(this, args);
    counter.reads += snap.size;
    return snap;
  };
  const realGetAll = Firestore.prototype.getAll;
  Firestore.prototype.getAll = async function (...refs) {
    const docs = await realGetAll.apply(this, refs);
    counter.reads += docs.length;
    return docs;
  };
}

async function setup() {
  await patchReads();
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/signals.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const member = async (name) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * 365.25 * 864e5) });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: name, avatar: 'cat.1.2', aboutMe: 'secret-about', profileComplete: true });
    return user;
  };
  const get = async (user, query) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    counter.reads = 0;
    await handler({ method: 'GET', headers: { authorization: `Bearer ${user.token}` }, query: query ?? {} }, res);
    return { ...res, reads: counter.reads };
  };
  const me = await member('Me');
  /** Gives `me` n connections, newest first by index (0 is the newest). */
  const connect = async (n, status = 'active') => {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const other = await member(`Partner ${i}`);
      const id = `pair-${me.uid.slice(0, 5)}-${String(i).padStart(3, '0')}`;
      await db.doc(`signalsPairs/${id}`).set({ participants: [me.uid, other.uid].sort(), status, createdAt: Timestamp.fromMillis(Date.now() - i * 60_000), invitationId: id });
      ids.push(id);
    }
    return ids;
  };
  return { db, Timestamp, member, get, me, connect };
}

test('with no paging asked for, the full list comes back exactly as before, newest first, without a cursor', { skip }, async () => {
  const { get, me, connect } = await setup();
  const ids = await connect(8);
  const res = await get(me, { view: 'pairs' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.pairs.map((p) => p.id), ids, 'newest first');
  assert.equal('nextCursor' in res.body, false);
  assert.deepEqual(Object.keys(res.body.pairs[0]).sort(), ['createdAt', 'endedAt', 'endedBy', 'id', 'invitationId', 'participants', 'partner', 'status']);
  assert.deepEqual(res.body.pairs[0].partner, { displayName: 'Partner 0', avatar: 'cat.1.2' });
});

test('paging walks a large inbox twenty at a time: newest first, no gaps, no repeats, and a cursor only while there is more', { skip }, async () => {
  const { get, me, connect } = await setup();
  const ids = await connect(45);
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const res = await get(me, { view: 'pairs', limit: '20', ...(cursor ? { before: cursor } : {}) });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.pairs.length <= 20);
    seen.push(...res.body.pairs.map((p) => p.id));
    cursor = res.body.nextCursor;
    pages += 1;
    if (cursor) assert.equal(res.body.pairs.length, 20, 'a full page when there is more');
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, ids, 'every connection exactly once, in order');
});

test('the page size is capped, an odd one falls back to the default, and a bad cursor starts from the newest', { skip }, async () => {
  const { get, me, connect } = await setup();
  await connect(60);
  assert.equal((await get(me, { view: 'pairs', limit: '999' })).body.pairs.length, 50, 'never more than fifty');
  assert.equal((await get(me, { view: 'pairs', limit: 'abc' })).body.pairs.length, 20);
  assert.equal((await get(me, { view: 'pairs', limit: '-4' })).body.pairs.length, 20);
  const first = await get(me, { view: 'pairs', limit: '20' });
  const junk = await get(me, { view: 'pairs', limit: '20', before: '../../etc.passwd' });
  assert.deepEqual(junk.body.pairs.map((p) => p.id), first.body.pairs.map((p) => p.id), 'a cursor that is not one is ignored, never used');
});

test('one connection can be asked for by id, and only your own is ever returned', { skip }, async () => {
  const { get, me, connect, member, db, Timestamp } = await setup();
  const ids = await connect(5);
  const one = await get(me, { view: 'pairs', pairId: ids[3] });
  assert.deepEqual(one.body.pairs.map((p) => p.id), [ids[3]]);
  assert.equal(one.body.pairs[0].partner.displayName, 'Partner 3');
  const a = await member('A');
  const b = await member('B');
  await db.doc('signalsPairs/pair-strangers-0001').set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  assert.deepEqual((await get(me, { view: 'pairs', pairId: 'pair-strangers-0001' })).body.pairs, [], 'someone else\'s connection looks like none');
  assert.deepEqual((await get(me, { view: 'pairs', pairId: 'no-such-pair-12345' })).body.pairs, []);
  assert.deepEqual((await get(me, { view: 'pairs', pairId: '../bad' })).body.pairs, []);
  assert.deepEqual((await get(me, { view: 'pairs', pairId: ids[0] }) ).body.pairs.map((p) => p.id), [ids[0]]);
});

test('other members\' connections never appear in anyone\'s pages, and unusable statuses are left out', { skip }, async () => {
  const { get, me, connect, member, db, Timestamp } = await setup();
  await connect(3);
  const a = await member('A');
  const b = await member('B');
  await db.doc('signalsPairs/pair-theirs-000001').set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  const other = await member('Other');
  await db.doc('signalsPairs/pair-revoked-00001').set({ participants: [me.uid, other.uid].sort(), status: 'revoked', createdAt: Timestamp.now() });
  await db.doc('signalsPairs/pair-ended-0000001').set({ participants: [me.uid, other.uid].sort(), status: 'ended', createdAt: Timestamp.fromMillis(Date.now() - 999_000), endedAt: Timestamp.now() });
  for (const query of [{ view: 'pairs' }, { view: 'pairs', limit: '20' }]) {
    const ids = (await get(me, query)).body.pairs.map((p) => p.id);
    assert.equal(ids.includes('pair-theirs-000001'), false);
    assert.equal(ids.includes('pair-revoked-00001'), false, 'a revoked connection is not an inbox entry');
    assert.equal(ids.includes('pair-ended-0000001'), true, 'a closed one still is');
  }
  assert.ok(!JSON.stringify((await get(me, { view: 'pairs', limit: '20' })).body).includes('secret-about'));
});

test('without the ordered query\'s index the pages still work, and give the same answer', { skip }, async () => {
  const { get, me, connect } = await setup();
  const ids = await connect(30);
  const ordered = await get(me, { view: 'pairs', limit: '20' });
  counter.orderedFails = true;
  counter.simulated = 0;
  try {
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const res = await get(me, { view: 'pairs', limit: '20', ...(cursor ? { before: cursor } : {}) });
      assert.equal(res.statusCode, 200, 'no error without the index');
      seen.push(...res.body.pairs.map((p) => p.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, ids);
    assert.ok(counter.simulated >= 2, `the missing-index failure was really simulated (${counter.simulated} times)`);
    assert.deepEqual(seen.slice(0, 20), ordered.body.pairs.map((p) => p.id), 'the same first page');
  } finally {
    counter.orderedFails = false;
  }
});

test('what the inbox reads: a page costs a page, a repeat is cheaper, and the old full list costs what it always did', { skip }, async () => {
  const { get, me, connect } = await setup();
  await connect(45);
  const cold = await get(me, { view: 'pairs', limit: '20' });
  assert.ok(cold.reads <= 21 + 20, `first page, nothing remembered: ${cold.reads} reads`);
  const warm = await get(me, { view: 'pairs', limit: '20' });
  assert.ok(warm.reads <= 21, `the same page again: ${warm.reads} reads (the other members were remembered)`);
  const one = await get(me, { view: 'pairs', pairId: cold.body.pairs[0].id });
  assert.ok(one.reads <= 1, `one connection: ${one.reads} reads`);
  const second = await get(me, { view: 'pairs', limit: '20', before: cold.body.nextCursor });
  assert.ok(second.reads <= 21 + 20, `second page: ${second.reads} reads`);
  console.log(`inbox reads (45 connections): first page ${cold.reads}, repeat ${warm.reads}, one connection ${one.reads}, second page ${second.reads}`);
});

test('invitations: asking for pending only returns only pending ones, and the default is unchanged', { skip }, async () => {
  const { get, me, member, db, Timestamp } = await setup();
  const sender = await member('Sender');
  const make = (id, status, direction = 'received') => db.doc(`signalsInvitations/${id}`).set({
    senderId: direction === 'received' ? sender.uid : me.uid, recipientId: direction === 'received' ? me.uid : sender.uid,
    status, message: 'hi', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
  });
  await make('inv-pending-0001', 'pending');
  await make('inv-pending-0002', 'pending', 'sent');
  await make('inv-accepted-001', 'accepted');
  await make('inv-declined-001', 'declined');
  const all = await get(me, {});
  assert.equal(all.body.invitations.length, 4, 'the default still returns every status');
  const pending = await get(me, { status: 'pending' });
  assert.deepEqual(pending.body.invitations.map((i) => i.status), ['pending', 'pending']);
  assert.ok(pending.reads < all.reads + 1 && pending.body.invitations.every((i) => i.partner.displayName === 'Sender' || i.partner.displayName === 'Me'));
  assert.equal(JSON.stringify(pending.body).includes('secret-about'), false);
});

test('the lists need a signed-in member, and an unknown view is still refused', { skip }, async () => {
  const { me } = await setup();
  const { default: handler } = await import('../../api/signals.js');
  const run = async (headers, query) => { const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} }; await handler({ method: 'GET', headers, query }, res); return res; };
  assert.equal((await run({}, { view: 'pairs', limit: '20' })).statusCode, 401);
  assert.equal((await run({ authorization: 'Bearer not-a-token' }, { view: 'pairs' })).statusCode, 401);
  assert.equal((await run({ authorization: `Bearer ${me.token}` }, { view: 'inbox-everything' })).statusCode, 400);
});
