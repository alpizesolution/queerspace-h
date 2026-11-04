// Galaxy Room GIFs against the real emulators, with GIPHY replaced by a fake. No real GIPHY call and no real key.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const KEY = 'fake-giphy-key-for-tests';
const GOOD = 'goodGif123';

const realFetch = globalThis.fetch;
const giphyCalls = [];
let giphyMode = 'ok';
const media = (id, name) => `https://media3.giphy.com/media/v1.Y2lkPTc5/${id}/${name}.gif?cid=1`;
const gifObject = (id, over = {}) => ({
  id, rating: 'g', title: `GIF ${id}`,
  images: {
    fixed_width: { url: media(id, '200w'), width: '200', height: '150' },
    downsized_medium: { url: media(id, 'giphy-downsized-medium'), width: '400', height: '300' },
    fixed_width_still: { url: media(id, '200w_s'), width: '200', height: '150' },
  },
  ...over,
});
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.giphy.com') return realFetch(input, init);
  giphyCalls.push(url);
  if (giphyMode === 'rate') return new Response('{}', { status: 429 });
  const path = url.pathname.replace('/v1/gifs/', '');
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === GOOD) return json({ data: gifObject(GOOD) });
  if (path === 'foreign1234') return json({ data: gifObject('foreign1234', { images: { fixed_width: { url: 'https://evil.example/foreign1234.gif', width: '200', height: '100' }, downsized_medium: { url: 'https://evil.example/foreign1234.gif', width: '200', height: '100' } } }) });
  if (path === 'adultgif123') return json({ data: gifObject('adultgif123', { rating: 'r' }) });
  return new Response('{}', { status: 404 });
};

async function newUser() {
  const r = await realFetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  process.env.GIPHY_API_KEY = KEY;
  giphyMode = 'ok';
  giphyCalls.length = 0;
  await realFetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/room.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const adultBirth = Timestamp.fromMillis(Date.now() - 30 * 365 * 86400000);
  const member = async (profile = {}, settings = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: adultBirth, createdAt: new Date(), ...settings });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: 'Willow', pronouns: 'she/her', avatar: 'fox.1.2', profileComplete: true, ...profile });
    return user;
  };
  const call = async (user, body, method = 'POST') => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body }, res);
    return res;
  };
  const sendGif = (user, gifId, extra = {}) => call(user, { action: 'send-gif', gifId, ...extra });
  const count = async () => (await db.collection('public_room_messages').get()).size;
  /** Pretend the last room message was a while ago, so the slow mode does not interfere. */
  const rested = user => db.doc(`rate_limits/${user.uid}`).set({ publicRoom: Timestamp.fromMillis(Date.now() - 60_000) }, { merge: true });
  return { db, member, call, sendGif, count, rested, newUser };
}

test('a member sends a GIF: stored as a room message with their own profile identity and server time', { skip }, async () => {
  const { db, member, sendGif } = await setup();
  const a = await member();
  const res = await sendGif(a, GOOD, { messageId: 'room-gif-message-1' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.kind, 'gif');
  assert.equal(res.body.gif.id, GOOD);
  assert.equal(JSON.stringify(res.body).includes(KEY), false);
  const stored = (await db.doc('public_room_messages/room-gif-message-1').get()).data();
  assert.equal(stored.kind, 'gif');
  assert.equal(stored.text, 'GIF');
  assert.equal(stored.authorId, a.uid);
  assert.equal(stored.authorName, 'Willow');
  assert.equal(stored.authorPronouns, 'she/her');
  assert.equal(stored.authorAvatar, 'fox.1.2');
  assert.equal(stored.gif.id, GOOD);
  assert.match(stored.gif.url, /^https:\/\/media3\.giphy\.com\//);
  assert.ok(typeof stored.timestamp.toMillis === 'function', 'a server timestamp, so the room orders and shows the time');
  assert.ok((await db.doc(`rate_limits/${a.uid}`).get()).data().publicRoom, 'the room slow mode is stamped, shared with text');
});

test('the author is never taken from the request: extra fields are refused', { skip }, async () => {
  const { member, sendGif, count } = await setup();
  const a = await member();
  for (const extra of [{ authorName: 'Admin' }, { authorId: 'someone-else' }, { team: true }, { text: 'sneaky' }, { url: 'https://evil.example/x.gif' }, { gifUrl: 'https://media.giphy.com/media/goodGif123/giphy.gif' }, { gif: { id: GOOD, url: 'https://evil.example/x.gif' } }, { replyTo: { id: 'x', author: 'y', text: 'z' } }]) {
    const res = await sendGif(a, GOOD, extra);
    assert.equal(res.statusCode, 400, JSON.stringify(extra));
    assert.equal(res.body.error, 'invalid_gif');
  }
  assert.equal(giphyCalls.length, 0);
  assert.equal(await count(), 0);
});

test('invalid GIF ids and message ids are refused before GIPHY is asked', { skip }, async () => {
  const { member, sendGif, call, count } = await setup();
  const a = await member();
  for (const id of [undefined, '', 'abc', '../../v1/gifs/search', 'has space 12345', 'x'.repeat(31), 12345678, { $ne: 1 }, ['a']]) {
    const res = await sendGif(a, id);
    assert.equal(res.statusCode, 400, JSON.stringify(id));
    assert.equal(res.body.error, 'invalid_gif');
  }
  assert.equal((await sendGif(a, GOOD, { messageId: 'no spaces allowed here' })).body.error, 'invalid_message');
  assert.equal((await call(a, { action: 'send-text', gifId: GOOD })).statusCode, 400);
  assert.equal((await call(a, undefined)).statusCode, 400);
  assert.equal(giphyCalls.length, 0);
  assert.equal(await count(), 0);
});

test('a GIF GIPHY does not know, with addresses off GIPHY, or rated too strongly, is not sent', { skip }, async () => {
  const { member, sendGif, count, rested } = await setup();
  const a = await member();
  for (const id of ['unknown12345', 'foreign1234', 'adultgif123']) {
    await rested(a);
    const res = await sendGif(a, id);
    assert.equal(res.statusCode, 404, id);
    assert.equal(res.body.error, 'gif_not_found');
  }
  assert.equal(await count(), 0);
});

test('only authenticated, adult members with a completed profile who are not suspended can send', { skip }, async () => {
  const { db, member, sendGif, call, count, newUser } = await setup();
  assert.equal((await call(null, { action: 'send-gif', gifId: GOOD })).statusCode, 401);
  assert.equal((await call({ token: 'not-a-real-token' }, { action: 'send-gif', gifId: GOOD })).statusCode, 401);
  assert.equal((await call(await member(), { action: 'send-gif', gifId: GOOD }, 'GET')).statusCode, 405);

  const stranger = await newUser(); // signed in, but never set up a profile
  assert.equal((await sendGif(stranger, GOOD)).statusCode, 403);
  const { Timestamp } = await import('firebase-admin/firestore');
  const minor = await member({}, { birthDate: Timestamp.fromMillis(Date.now() - 15 * 365 * 86400000) });
  assert.equal((await sendGif(minor, GOOD)).statusCode, 403);
  const unfinished = await member({ profileComplete: false });
  assert.equal((await sendGif(unfinished, GOOD)).statusCode, 403);
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ reason: 'test' });
  const res = await sendGif(suspended, GOOD);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'account_unavailable');

  assert.equal(giphyCalls.length, 0, 'GIPHY is never asked for someone who may not send');
  assert.equal(await count(), 0);
});

test('the room slow mode applies to GIFs, shared with text messages', { skip }, async () => {
  const { db, member, sendGif, rested, count } = await setup();
  const a = await member();
  assert.equal((await sendGif(a, GOOD)).statusCode, 201);
  const fast = await sendGif(a, GOOD);
  assert.equal(fast.statusCode, 429);
  assert.equal(fast.body.error, 'too_fast');
  assert.equal(await count(), 1);
  // A text message just sent (it stamps the same field) also slows the next GIF.
  const b = await member();
  await db.doc(`rate_limits/${b.uid}`).set({ publicRoom: new Date() });
  assert.equal((await sendGif(b, GOOD)).body.error, 'too_fast');
  await rested(a);
  assert.equal((await sendGif(a, GOOD)).statusCode, 201);
});

test('a member who sends too many GIFs in a minute is slowed down', { skip }, async () => {
  const { member, sendGif, rested, count } = await setup();
  const a = await member();
  let last;
  for (let i = 0; i < 11; i += 1) {
    await rested(a);
    last = await sendGif(a, GOOD);
  }
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.error, 'rate_limited');
  assert.equal(await count(), 10);
});

test('sending the same GIF message twice makes one message, and a stranger cannot take its id', { skip }, async () => {
  const { member, sendGif, count, rested } = await setup();
  const a = await member();
  const b = await member();
  assert.equal((await sendGif(a, GOOD, { messageId: 'room-gif-message-2' })).statusCode, 201);
  const calls = giphyCalls.length;
  const again = await sendGif(a, GOOD, { messageId: 'room-gif-message-2' });
  assert.equal(again.statusCode, 201);
  assert.equal(again.body.id, 'room-gif-message-2');
  assert.equal(giphyCalls.length, calls, 'answered from what was stored');
  await rested(b);
  assert.equal((await sendGif(b, GOOD, { messageId: 'room-gif-message-2' })).statusCode, 409);
  assert.equal(await count(), 1);
});

test('GIPHY trouble fails cleanly: rate limit, missing key; nothing is stored and the slow mode is not used up', { skip }, async () => {
  const { db, member, sendGif, count } = await setup();
  const a = await member();
  giphyMode = 'rate';
  assert.equal((await sendGif(a, GOOD)).body.error, 'gif_rate_limited');
  giphyMode = 'ok';
  delete process.env.GIPHY_API_KEY;
  const quiet = console.error;
  console.error = () => {};
  try {
    const none = await sendGif(a, GOOD);
    assert.equal(none.statusCode, 503);
    assert.equal(none.body.error, 'gif_not_configured');
  } finally {
    console.error = quiet;
  }
  assert.equal(await count(), 0);
  assert.equal((await db.doc(`rate_limits/${a.uid}`).get()).exists, false, 'a failed send does not start the slow mode');
  process.env.GIPHY_API_KEY = KEY;
  assert.equal((await sendGif(a, GOOD)).statusCode, 201, 'works as soon as GIPHY is back');
});
