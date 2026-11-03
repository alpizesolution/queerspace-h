// Timed photos against the real Auth and Firestore emulators, with an in-memory stand-in for R2. The server decides:
// who may send and open, when the one viewing window starts and ends, and what is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GIF, GPS_MARKER, SVG, fakeStore, makeJpeg, makePng, makeWebp, toBase64 } from './media-fixtures.js';

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
  const { default: cleanup } = await import('../../api/media-cleanup.js');
  const media = await import('../../api/_media.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const store = fakeStore();
  media.setMediaStoreForTests(store);
  const member = async (extra = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * 365.25 * 864e5), ...extra });
    return user;
  };
  const response = () => ({ statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } });
  const call = async (user, method, body, query) => {
    const res = response();
    await handler({ method, headers: { authorization: user ? `Bearer ${user.token}` : '' }, body, query: query ?? {} }, res);
    return res;
  };
  const a = await member();
  const b = await member();
  const pairId = `pair-${a.uid.slice(0, 8)}`;
  await db.doc(`signalsPairs/${pairId}`).set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  let n = 0;
  const send = (user, extra = {}, pid = pairId) => { n += 1; return call(user, 'POST', { action: 'send-photo', pairId: pid, messageId: `photo-message-${Date.now()}-${n}`, timerSeconds: 3, image: toBase64(makeJpeg()), ...extra }); };
  const open = (user, messageId, pid = pairId) => call(user, 'POST', { action: 'open-photo', pairId: pid, messageId });
  const meta = async (messageId) => (await db.collection('signalsMedia').where('messageId', '==', messageId).get()).docs[0]?.data();
  const metaCount = async () => (await db.collection('signalsMedia').get()).size;
  /** Handlers on a clock the test controls, for the exact moment a window ends. */
  const clock = { now: Date.now() };
  const timed = media.createMediaHandlers({ getStore: () => store, now: () => clock.now });
  const timedSend = (user, extra = {}) => { n += 1; return timed.sendPhoto(db, user.uid, { pairId, messageId: `timed-message-${Date.now()}-${n}`, timerSeconds: 3, image: toBase64(makeJpeg()), ...extra }); };
  const timedOpen = (user, messageId) => timed.openPhoto(db, user.uid, { pairId, messageId });
  return { db, Timestamp, member, call, a, b, pairId, send, open, meta, metaCount, store, media, cleanup, response, clock, timed, timedSend, timedOpen };
}

const code = async (promise) => promise.then(() => null, (error) => `${error.statusCode}:${error.message}`);

test('an authorized member sends a photo: the image is stored privately under a random key, and the message holds only its timer', { skip }, async () => {
  const { a, b, send, store, db, pairId, meta } = await setup();
  const res = await send(a);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.kind, 'photo');
  assert.deepEqual(res.body.photo, { durationSec: 3, status: 'sent', mine: true });
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(store.objects.size, 1, 'exactly one private object');
  const [[key, object]] = [...store.objects];
  assert.match(key, /^m\/[A-Za-z0-9_-]{32}$/, 'a random, non-guessable key');
  assert.equal(object.body.includes(GPS_MARKER), false, 'metadata was stripped before storing');
  assert.equal(object.contentType, 'image/jpeg');
  const stored = (await db.doc(`signalsPairs/${pairId}/messages/${res.body.id}`).get()).data();
  assert.equal(stored.kind, 'photo');
  assert.equal(stored.durationSec, 3);
  assert.equal(JSON.stringify(stored).includes(key), false, 'the message does not hold the object key');
  assert.equal(JSON.stringify(stored).includes('http'), false, 'nor any link');
  const record = await meta(res.body.id);
  assert.equal(record.key, key);
  assert.equal(record.state, 'unopened');
  assert.equal(record.recipientId, b.uid);
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1, 'the recipient has one unread');
});

test('only an eligible participant can send: signed-out, strangers, blocked, suspended and ended conversations are all refused before anything is stored', { skip }, async () => {
  const { a, b, member, send, store, db, Timestamp, pairId, call, metaCount } = await setup();
  assert.equal((await call(null, 'POST', { action: 'send-photo', pairId, timerSeconds: 3, image: toBase64(makeJpeg()) })).statusCode, 401);
  const stranger = await member();
  assert.equal((await send(stranger)).statusCode, 403, 'wrong participant');
  assert.equal((await send(a, {}, 'pair-does-not-exist-1')).statusCode, 404);
  await db.doc(`users/${b.uid}/private/settings`).update({ blockedPartnerIds: [a.uid] });
  assert.equal((await send(a)).statusCode, 403, 'blocked by the recipient');
  await db.doc(`users/${b.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`users/${a.uid}/private/settings`).update({ blockedPartnerIds: [b.uid] });
  assert.equal((await send(a)).statusCode, 403, 'the sender blocked them');
  assert.equal((await send(b)).statusCode, 403, 'and they cannot send either');
  await db.doc(`users/${a.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${b.uid}`).set({ reason: 'test', at: Timestamp.now() });
  assert.equal((await send(a)).statusCode, 403, 'the recipient is suspended');
  assert.equal((await send(b)).statusCode, 403, 'a suspended member cannot send');
  await db.doc(`suspensions/${b.uid}`).delete();
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await send(a)).statusCode, 409, 'the conversation ended');
  assert.equal(store.objects.size, 0, 'nothing was uploaded for any refused send');
  assert.equal(await metaCount(), 0, 'and no record was created');
});

test('only 3, 5 and 8 seconds are accepted by the server, and nothing is stored for any other value', { skip }, async () => {
  const { a, send, store, metaCount } = await setup();
  for (const timerSeconds of [0, 1, 2, 4, 6, 7, 9, 10, 30, -3, 3.5, '3', null, undefined, NaN]) {
    const res = await send(a, { timerSeconds });
    assert.equal(res.statusCode, 400, `timer ${String(timerSeconds)}`);
    assert.equal(res.body.error, 'invalid_timer');
  }
  assert.equal(store.objects.size, 0);
  assert.equal(await metaCount(), 0);
  for (const timerSeconds of [3, 5, 8]) assert.equal((await send(a, { timerSeconds })).statusCode, 201, `timer ${timerSeconds}`);
  assert.equal(store.objects.size, 3);
});

test('invalid files are refused: SVG, GIF, scripts, damaged and animated images, and oversized or non-base64 input', { skip }, async () => {
  const { a, send, store, metaCount } = await setup();
  const refused = async (image, status, label) => {
    const res = await send(a, { image });
    assert.equal(res.statusCode, status, label);
  };
  await refused(toBase64(SVG), 400, 'svg');
  await refused(toBase64(GIF), 400, 'gif');
  await refused(toBase64(Buffer.from('<?php system($_GET[0]); ?>'.padEnd(64, ' '))), 400, 'script');
  await refused(toBase64(makeJpeg().subarray(0, 30)), 400, 'truncated');
  await refused(toBase64(makeWebp({ animated: true })), 400, 'animated');
  await refused(toBase64(makeJpeg({ width: 60000, height: 60000 })), 400, 'decompression bomb');
  await refused('not base64 !!!', 400, 'not base64');
  await refused('', 400, 'empty');
  await refused(undefined, 400, 'missing');
  await refused(toBase64(makeJpeg({ pad: 2_600_000 })), 413, 'oversized');
  assert.equal(store.objects.size, 0);
  assert.equal(await metaCount(), 0);
  assert.equal((await send(a, { image: toBase64(makePng()) })).statusCode, 201, 'a PNG is fine');
  assert.equal((await send(a, { image: toBase64(makeWebp()) })).statusCode, 201, 'a WebP is fine');
});

test('the recipient opens the photo once: the image arrives in that response, never cached, and the window ends exactly at the chosen time', { skip }, async () => {
  for (const seconds of [3, 5, 8]) {
    const { a, b, timedSend, timedOpen, clock, store, db, pairId } = await setup();
    const sent = (await timedSend(a, { timerSeconds: seconds })).body;
    assert.equal(sent.photo.durationSec, seconds);
    const start = clock.now;
    const first = (await timedOpen(b, sent.id)).body;
    assert.equal(first.expiresAt, start + seconds * 1000, `${seconds}s window starts when it is opened`);
    assert.equal(first.durationSec, seconds);
    assert.equal(first.remainingMs, seconds * 1000);
    assert.equal(Buffer.from(first.image, 'base64').includes(GPS_MARKER), false);
    assert.equal(first.contentType, 'image/jpeg');
    assert.equal(JSON.stringify(first).match(/https?:/), null, 'no URL in the answer');
    // inside the window it still works, with the SAME end time: it never resets
    clock.now = start + seconds * 1000 - 1;
    const late = (await timedOpen(b, sent.id)).body;
    assert.equal(late.expiresAt, first.expiresAt, 'the countdown is not reset by opening again');
    assert.equal(late.remainingMs, 1);
    // at the end it is gone, for good
    clock.now = start + seconds * 1000;
    assert.equal(await code(timedOpen(b, sent.id)), '410:photo_expired', `${seconds}s: closed exactly at the end`);
    clock.now = start + seconds * 1000 + 3_600_000;
    assert.equal(await code(timedOpen(b, sent.id)), '410:photo_expired', 'and an hour later');
    assert.equal(store.objects.size, 0, 'the object was deleted when the expired request was seen');
    assert.equal((await db.collection('signalsMedia').get()).size, 0, 'and its record');
    assert.ok((await db.doc(`signalsPairs/${pairId}/messages/${sent.id}`).get()).exists, 'the message itself stays, now showing "Photo expired"');
  }
});

test('opening through the API is limited to the recipient, sets no-store headers, and a repeat cannot move the end time', { skip }, async () => {
  const { a, b, member, send, open, call, db, meta } = await setup();
  const sent = (await send(a, { timerSeconds: 8 })).body;
  assert.equal((await open(a, sent.id)).statusCode, 403, 'the sender cannot open their own photo');
  assert.equal((await open(await member(), sent.id)).statusCode, 403, 'a stranger cannot');
  assert.equal((await call(null, 'POST', { action: 'open-photo', pairId: sent.id, messageId: sent.id })).statusCode, 401);
  assert.equal((await open(b, 'no-such-message-1')).statusCode, 404);
  const opened = await open(b, sent.id);
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(opened.headers.pragma, 'no-cache');
  assert.equal(opened.headers['x-content-type-options'], 'nosniff');
  const record = await meta(sent.id);
  assert.equal(record.state, 'viewing');
  assert.equal(record.expiresAt.toMillis() - record.openedAt.toMillis(), 8000);
  await new Promise((r) => setTimeout(r, 120));
  const again = await open(b, sent.id);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.expiresAt, opened.body.expiresAt, 'the same end time');
  assert.equal((await meta(sent.id)).openedAt.toMillis(), record.openedAt.toMillis(), 'the opening time was not rewritten');
  const messages = await call(b, 'GET', undefined, { view: 'messages', pairId: (await db.collection('signalsPairs').get()).docs[0].id });
  const shown = messages.body.messages.find((m) => m.id === sent.id);
  assert.equal(shown.kind, 'photo');
  assert.deepEqual([shown.photo.status, shown.photo.mine, shown.photo.durationSec], ['viewing', false, 8]);
  assert.equal(JSON.stringify(messages.body).includes((await meta(sent.id)).key), false, 'the object key never leaves the server');
  assert.equal(JSON.stringify(messages.body).includes('mediaId'), false);
});

test('ten simultaneous opens give everyone the same single window, and only one of them starts it', { skip }, async () => {
  const { a, b, timedSend, timedOpen, db } = await setup();
  const sent = (await timedSend(a, { timerSeconds: 5 })).body;
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => timedOpen(b, sent.id)));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.body);
  assert.equal(ok.length, 10, 'every one of the ten was answered: ' + JSON.stringify(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message)));
  assert.equal(new Set(ok.map((r) => r.expiresAt)).size, 1, 'one end time for all of them');
  const records = (await db.collection('signalsMedia').get()).docs.map((d) => d.data());
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'viewing');
  assert.equal(records[0].expiresAt.toMillis() - records[0].openedAt.toMillis(), 5000);
});

test('sending the same photo twice, even at the same instant, makes one message, one object and one unread', { skip }, async () => {
  const { a, b, timed, db, pairId, store, metaCount } = await setup();
  const body = { pairId, messageId: 'same-photo-message-1', timerSeconds: 3, image: toBase64(makeJpeg()) };
  const results = await Promise.allSettled([timed.sendPhoto(db, a.uid, body), timed.sendPhoto(db, a.uid, body), timed.sendPhoto(db, a.uid, body)]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const again = await timed.sendPhoto(db, a.uid, body);
  assert.equal(again.status, 200, 'a later repeat is answered with the stored message');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 1);
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1);
  assert.equal(store.objects.size, 1, 'the extra uploads were deleted');
  assert.equal(await metaCount(), 1);
});

test('a revoked permission stops opening, and the photo is not used up by the refusal', { skip }, async () => {
  const { a, b, send, open, db, Timestamp, pairId, meta } = await setup();
  const sent = (await send(a)).body;
  await db.doc(`users/${a.uid}/private/settings`).update({ blockedPartnerIds: [b.uid] });
  assert.equal((await open(b, sent.id)).statusCode, 403, 'blocked');
  await db.doc(`users/${a.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${a.uid}`).set({ reason: 'test', at: Timestamp.now() });
  assert.equal((await open(b, sent.id)).statusCode, 403, 'suspended');
  await db.doc(`suspensions/${a.uid}`).delete();
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await open(b, sent.id)).statusCode, 409, 'the conversation ended');
  assert.equal((await meta(sent.id)).state, 'unopened', 'still unopened');
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'active' });
  assert.equal((await open(b, sent.id)).statusCode, 200, 'and it opens once permission is back');
});

test('a photo nobody opens expires after a day, and an upload failure leaves no message and nothing behind', { skip }, async () => {
  const { a, b, timedSend, timedOpen, clock, store, timed, db, metaCount, media } = await setup();
  const sent = (await timedSend(a)).body;
  clock.now += media.UNOPENED_TTL_MS - 1;
  assert.equal((await timedOpen(b, sent.id)).status, 200, 'still openable just before a day');
  const second = (await timedSend(a)).body;
  clock.now += media.UNOPENED_TTL_MS + 1000;
  assert.equal(await code(timedOpen(b, second.id)), '410:photo_expired', 'not after a day');
  // an upload that fails
  store.failPut = true;
  assert.equal(await code(timedSend(a)), '502:media_storage_failed');
  store.failPut = false;
  const messagesBefore = (await db.collectionGroup('messages').get()).size;
  assert.equal(messagesBefore, 2, 'no message for the failed upload');
  assert.ok((await metaCount()) >= 1, 'a pending record remains for the cleanup');
  clock.now += media.PENDING_TTL_MS + 1000;
  const swept = await timed.sweep(db);
  assert.ok(swept.deleted >= 1);
  assert.equal(await metaCount(), 0, 'cleanup removed every record');
  assert.equal(store.objects.size, 0, 'and every object: no orphans');
});

test('if storage fails when opening, the viewing is not used up and a retry works', { skip }, async () => {
  const { a, b, timedSend, timedOpen, store, db } = await setup();
  const sent = (await timedSend(a)).body;
  store.failGet = true;
  assert.equal(await code(timedOpen(b, sent.id)), '502:media_storage_failed');
  assert.equal((await db.collection('signalsMedia').get()).docs[0].data().state, 'unopened');
  store.failGet = false;
  assert.equal((await timedOpen(b, sent.id)).status, 200);
});

test('cleanup deletes what is due, retries failures with a growing pause, can be repeated, and leaves live photos alone', { skip }, async () => {
  const { a, b, timedSend, timedOpen, clock, store, timed, db, metaCount } = await setup();
  const live = (await timedSend(a, { timerSeconds: 8 })).body;
  const gone = (await timedSend(a, { timerSeconds: 3 })).body;
  await timedOpen(b, gone.id);
  clock.now += 3000;
  store.failDelete = true;
  const first = await timed.sweep(db);
  assert.deepEqual([first.due, first.deleted, first.failed], [1, 0, 1], 'the due one failed to delete');
  let record = (await db.collection('signalsMedia').where('messageId', '==', gone.id).get()).docs[0].data();
  assert.equal(record.attempts, 1);
  assert.equal(record.lastError, 'r2_500');
  assert.ok(record.deleteAfter.toMillis() > clock.now, 'the next try is later');
  assert.equal((await timed.sweep(db)).due, 0, 'not retried before its time');
  store.failDelete = false;
  clock.now += 24 * 3_600_000;
  const second = await timed.sweep(db);
  assert.equal(second.failed, 0);
  assert.ok(second.deleted >= 1);
  assert.equal((await timed.sweep(db)).failed, 0, 'repeating is harmless');
  record = (await db.collection('signalsMedia').where('messageId', '==', gone.id).get()).docs[0];
  assert.equal(record, undefined, 'its record is gone');
  assert.ok((await metaCount()) <= 1);
  void live;
});

test('the cleanup endpoint only answers to the scheduler\'s secret', { skip }, async () => {
  const { cleanup, response, store } = await setup();
  const run = async (headers) => { const res = response(); await cleanup({ method: 'GET', headers }, res); return res; };
  delete process.env.CRON_SECRET;
  assert.equal((await run({ authorization: 'Bearer anything-at-all-123456' })).statusCode, 401, 'no secret configured');
  process.env.CRON_SECRET = 'a-long-random-cron-secret-value';
  assert.equal((await run({})).statusCode, 401);
  assert.equal((await run({ authorization: 'Bearer wrong-secret-of-the-same-length!!' })).statusCode, 401);
  assert.equal((await run({ authorization: 'Bearer a-long-random-cron-secret-valuX' })).statusCode, 401);
  const ok = await run({ authorization: 'Bearer a-long-random-cron-secret-value' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { due: 0, deleted: 0, failed: 0 });
  assert.equal(ok.headers['cache-control'], 'no-store');
  void store;
  delete process.env.CRON_SECRET;
});

test('sending is rate limited, and the feature says it is unavailable when storage is not configured', { skip }, async () => {
  const { a, send, media } = await setup();
  const results = [];
  for (let i = 0; i < 11; i += 1) results.push((await send(a)).statusCode);
  assert.deepEqual(results.slice(0, 10), Array(10).fill(201));
  assert.equal(results[10], 429);
  media.setMediaStoreForTests(null);
  const saved = { ...process.env };
  for (const key of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) delete process.env[key];
  const b = await send(a);
  assert.ok([429, 503].includes(b.statusCode));
  assert.notEqual(b.body?.error, 'media_storage_failed');
  Object.assign(process.env, saved);
});

test('ordinary text messages and history are unchanged, and clients cannot read photo records', { skip }, async () => {
  const { a, b, call, pairId, send, db } = await setup();
  const text = await call(a, 'POST', { action: 'send-message', pairId, messageId: 'plain-text-message-1', text: 'hello' });
  assert.equal(text.statusCode, 201);
  await send(a);
  const list = await call(b, 'GET', undefined, { view: 'messages', pairId });
  const [first, second] = list.body.messages;
  assert.equal(first.text, 'hello');
  assert.equal(first.kind, undefined, 'a text message has no photo fields');
  assert.equal(second.kind, 'photo');
  assert.equal(second.photo.status, 'unopened');
  assert.equal((await db.collection('signalsMedia').get()).size, 1);
});

const withoutR2Settings = async (fn) => {
  const saved = Object.fromEntries(['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].map((k) => [k, process.env[k]]));
  for (const key of Object.keys(saved)) delete process.env[key];
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v; }
};

test('with storage not configured, sending says so plainly (not a generic failure), and stores nothing', { skip }, async () => {
  const { a, send, media, db, metaCount } = await setup();
  media.setMediaStoreForTests(null);
  await withoutR2Settings(async () => {
    const res = await send(a);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'media_not_configured');
    assert.equal((await db.collectionGroup('messages').get()).size, 0);
    assert.equal(await metaCount(), 0, 'nothing was even recorded');
  });
});

test('an upload that R2 rejects says so, creates no message, and leaves nothing behind once cleaned up', { skip }, async () => {
  const { a, send, store, db, metaCount, timed, clock } = await setup();
  store.failPut = true;
  const res = await send(a);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'media_storage_failed');
  assert.equal((await db.collectionGroup('messages').get()).size, 0, 'no message when the upload failed');
  store.failPut = false;
  clock.now += 2 * 3_600_000;
  await timed.sweep(db);
  assert.equal(await metaCount(), 0);
  assert.equal(store.objects.size, 0);
});

test('if the message cannot be saved after a good upload, that is reported separately and the stored object is removed', { skip }, async () => {
  const { a, db, store, timed, metaCount, pairId } = await setup();
  const failingBatch = new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') return () => { const batch = target.batch(); return new Proxy(batch, { get(b, p) { if (p === 'commit') return async () => { throw Object.assign(new Error('write failed'), { code: 14 }); }; const v = b[p]; return typeof v === 'function' ? v.bind(b) : v; } }); };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  let uploaded = 0;
  const watched = { ...store, put: async (...args) => { uploaded += 1; return store.put(...args); }, get: store.get, delete: store.delete };
  const handlers = (await import('../../api/_media.js')).createMediaHandlers({ getStore: () => watched });
  const error = await code(handlers.sendPhoto(failingBatch, a.uid, { pairId, messageId: 'message-fails-after-upload-1', timerSeconds: 3, image: toBase64(makeJpeg()) }));
  assert.equal(error, '503:photo_not_saved');
  assert.equal(uploaded, 1, 'the upload did happen first');
  assert.equal(store.objects.size, 0, 'and the orphaned object was removed straight away');
  assert.equal(await metaCount(), 0, 'with its record');
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 0, 'no message exists');
  void timed;
});

test('if removing the orphan also fails, the record stays due so the cleanup removes it later', { skip }, async () => {
  const { a, db, store, timed, metaCount, pairId, clock } = await setup();
  const failingBatch = new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') return () => { const batch = target.batch(); return new Proxy(batch, { get(b, p) { if (p === 'commit') return async () => { throw Object.assign(new Error('write failed'), { code: 14 }); }; const v = b[p]; return typeof v === 'function' ? v.bind(b) : v; } }); };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const flaky = { put: store.put, get: store.get, delete: async () => { throw Object.assign(new Error('r2 down'), { code: 'r2_500' }); } };
  const handlers = (await import('../../api/_media.js')).createMediaHandlers({ getStore: () => flaky, now: () => clock.now });
  assert.equal(await code(handlers.sendPhoto(failingBatch, a.uid, { pairId, messageId: 'message-fails-after-upload-2', timerSeconds: 5, image: toBase64(makeJpeg()) })), '503:photo_not_saved');
  assert.equal(store.objects.size, 1, 'the object could not be removed right now');
  assert.equal(await metaCount(), 1, 'but its record remains, due for deletion');
  clock.now += 60_000;
  const swept = await timed.sweep(db);
  assert.ok(swept.deleted >= 1);
  assert.equal(store.objects.size, 0);
  assert.equal(await metaCount(), 0);
});

test('tapping Send several times, and retrying after a failure, with one message id makes exactly one message', { skip }, async () => {
  const { a, call, store, db, pairId, metaCount } = await setup();
  const body = { action: 'send-photo', pairId, messageId: 'one-photo-many-taps-1', timerSeconds: 5, image: toBase64(makeJpeg()) };
  store.failPut = true;
  assert.equal((await call(a, 'POST', body)).statusCode, 502, 'the first try fails at storage');
  store.failPut = false;
  const taps = await Promise.all([call(a, 'POST', body), call(a, 'POST', body), call(a, 'POST', body), call(a, 'POST', body)]);
  assert.ok(taps.every((r) => [200, 201].includes(r.statusCode)), JSON.stringify(taps.map((r) => [r.statusCode, r.body?.error])));
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 1, 'one message');
  assert.equal(new Set(taps.map((r) => r.body.id)).size, 1);
  assert.equal(store.objects.size, 1, 'one stored object');
  assert.equal((await call(a, 'POST', body)).statusCode, 200, 'and a later repeat is answered with the stored message');
  assert.ok((await metaCount()) <= 2);
});

test('with the real R2 client over HTTP, a photo uploads, the message is created, the recipient opens it, and cleanup deletes it', { skip }, async () => {
  const { a, b, db, pairId, media, clock } = await setup();
  const { startFakeS3 } = await import('./fake-s3-server.js');
  const s3 = await startFakeS3();
  try {
    const real = media.createR2Store({ endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey });
    const handlers = media.createMediaHandlers({ getStore: () => real, now: () => clock.now });
    for (const timerSeconds of [3, 5, 8]) {
      const sent = await handlers.sendPhoto(db, a.uid, { pairId, messageId: `real-http-photo-${timerSeconds}`, timerSeconds, image: toBase64(makeJpeg({ pad: 400 })) });
      assert.equal(sent.status, 201, `${timerSeconds}s`);
      assert.equal((await db.doc(`signalsPairs/${pairId}/messages/real-http-photo-${timerSeconds}`).get()).data().durationSec, timerSeconds);
    }
    assert.equal(s3.objects.size, 3, 'three private objects were stored over HTTP');
    assert.ok(s3.requests.every((r) => r.authorized), 'every request was correctly signed');
    const opened = await handlers.openPhoto(db, b.uid, { pairId, messageId: 'real-http-photo-5' });
    assert.equal(opened.body.durationSec, 5);
    assert.equal(opened.body.remainingMs, 5000);
    assert.equal(Buffer.from(opened.body.image, 'base64').includes(GPS_MARKER), false);
    clock.now += 10_000;
    assert.equal(await code(handlers.openPhoto(db, b.uid, { pairId, messageId: 'real-http-photo-5' })), '410:photo_expired');
    clock.now += 2 * 24 * 3_600_000;
    const swept = await handlers.sweep(db);
    assert.equal(swept.failed, 0);
    assert.equal(s3.objects.size, 0, 'cleanup deleted every object over HTTP');
    assert.equal((await db.collection('signalsMedia').get()).size, 0);
  } finally {
    await s3.close();
  }
});

test('the protected storage check reports each step, and only to the scheduler\'s secret', { skip }, async () => {
  const { cleanup, response, media, store } = await setup();
  const run = async (headers, query) => { const res = response(); await cleanup({ method: 'GET', headers, query }, res); return res; };
  process.env.CRON_SECRET = 'a-long-random-cron-secret-value';
  const auth = { authorization: 'Bearer a-long-random-cron-secret-value' };
  assert.equal((await run({}, { check: '1' })).statusCode, 401, 'no secret, no check');
  const ok = await run(auth, { check: '1' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([ok.body.configured, ok.body.put, ok.body.get, ok.body.delete, ok.body.ok], [true, 'ok', 'ok', 'ok', true]);
  store.failPut = true;
  const broken = await run(auth, { check: '1' });
  assert.deepEqual([broken.body.ok, broken.body.put], [false, 'r2_500']);
  store.failPut = false;
  media.setMediaStoreForTests(null);
  await withoutR2Settings(async () => {
    const none = await run(auth, { check: '1' });
    assert.equal(none.body.configured, false);
    assert.deepEqual(none.body.missing, ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
    assert.equal(/cron-secret|https?:|cloudflarestorage/.test(JSON.stringify(none.body)), false, 'only setting names, never a value or URL');
  });
  delete process.env.CRON_SECRET;
});
