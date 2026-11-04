// GIF sharing against the real emulators, with GIPHY itself replaced by a fake: search and trending, sending, receiving,
// and every way a GIF must be refused. No network call to GIPHY is ever made and no real key is used.
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

// A fake GIPHY. Everything else (the Auth emulator) goes to the real fetch.
const realFetch = globalThis.fetch;
const giphyCalls = [];
let giphyMode = 'ok';
const media = (id, name, host = 'media3.giphy.com') => `https://${host}/media/v1.Y2lkPTc5MGI3NjEx/${id}/${name}.gif?cid=1`;
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
  if (giphyMode === 'down') return new Response('{}', { status: 500 });
  const path = url.pathname.replace('/v1/gifs/', '');
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === 'trending' || path === 'search') {
    return json({ data: [gifObject(GOOD), gifObject('second12345'), gifObject('thirdgif999', { rating: 'r' })], pagination: { total_count: 50, count: 3, offset: 0 } });
  }
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
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {} }, res);
    return res;
  };
  const sendGif = (user, gifId, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'gif', gifId, ...extra });
  const browse = (user, query = {}) => call(user, 'GET', undefined, { view: 'gifs', ...query });
  const load = (user, after) => call(user, 'GET', undefined, { view: 'messages', pairId, ...(after ? { after } : {}) });
  const count = async () => (await db.collection(`signalsPairs/${pairId}/messages`).get()).size;
  return { db, pairId, a, b, outsider, call, sendGif, browse, load, count };
}

test('trending GIFs come from the server, with only approved fields and no key', { skip }, async () => {
  const { a, browse } = await setup();
  const res = await browse(a);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.gifs.map(g => g.id), [GOOD, 'second12345'], 'a GIF above the rating cap is left out');
  assert.equal(res.body.nextOffset, 3);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(JSON.stringify(res.body).includes(KEY), false);
  assert.equal(giphyCalls[0].pathname, '/v1/gifs/trending');
  assert.equal(giphyCalls[0].searchParams.get('api_key'), KEY, 'the key is used on the server only');
  assert.equal(giphyCalls[0].searchParams.get('rating'), 'pg-13');
});

test('GIF search passes the text on, pages, and refuses bad parameters', { skip }, async () => {
  const { a, browse } = await setup();
  const found = await browse(a, { q: 'happy dance', limit: '12', offset: '24' });
  assert.equal(found.statusCode, 200);
  assert.equal(giphyCalls[0].pathname, '/v1/gifs/search');
  assert.equal(giphyCalls[0].searchParams.get('q'), 'happy dance');
  assert.equal(giphyCalls[0].searchParams.get('limit'), '12');
  const before = giphyCalls.length;
  for (const bad of [{ q: 'x'.repeat(51) }, { limit: '31' }, { limit: '0' }, { offset: '-1' }, { offset: '9999' }, { limit: 'many' }]) {
    const res = await browse(a, bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.equal(res.body.error, 'invalid_gif_request');
  }
  assert.equal(giphyCalls.length, before, 'bad parameters never reach GIPHY');
});

test('GIF browsing needs a signed-in member who is not suspended', { skip }, async () => {
  const { a, db, call, browse } = await setup();
  assert.equal((await call(null, 'GET', undefined, { view: 'gifs' })).statusCode, 401);
  await db.doc(`suspensions/${a.uid}`).set({ reason: 'test' });
  const res = await browse(a);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'account_unavailable');
  assert.equal(giphyCalls.length, 0);
});

test('GIPHY rate limits, outages and a missing key are reported gently', { skip }, async () => {
  const { a, browse } = await setup();
  giphyMode = 'rate';
  const limited = await browse(a, { q: 'cats' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error, 'gif_rate_limited');
  giphyMode = 'down';
  const down = await browse(a, { q: 'dogs' });
  assert.equal(down.statusCode, 502);
  assert.equal(down.body.error, 'gif_unavailable');
  giphyMode = 'ok';
  delete process.env.GIPHY_API_KEY;
  const quiet = console.error;
  console.error = () => {};
  try {
    const none = await browse(a, { q: 'birds' });
    assert.equal(none.statusCode, 503);
    assert.equal(none.body.error, 'gif_not_configured');
  } finally {
    console.error = quiet;
  }
});

test('a member who searches too fast is slowed down by us, before GIPHY is asked again', { skip }, async () => {
  const { a, browse } = await setup();
  let last;
  for (let i = 0; i < 41; i += 1) last = await browse(a, { q: `cat ${i}` });
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.error, 'rate_limited');
  assert.equal(giphyCalls.length, 40);
});

test('sending a GIF stores only the id and GIPHY approved addresses, and the other member receives it', { skip }, async () => {
  const { db, pairId, a, b, sendGif, load, count } = await setup();
  const sent = await sendGif(a, GOOD, { messageId: 'gif-message-0001' });
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.kind, 'gif');
  assert.equal(sent.body.senderId, a.uid);
  assert.equal(sent.body.text, 'GIF');
  assert.equal(sent.body.gif.id, GOOD);
  assert.ok(sent.body.createdAt);

  const stored = (await db.doc(`signalsPairs/${pairId}/messages/gif-message-0001`).get()).data();
  assert.equal(stored.kind, 'gif');
  assert.equal(stored.senderId, a.uid);
  assert.equal(stored.gif.id, GOOD);
  assert.match(stored.gif.url, /^https:\/\/media3\.giphy\.com\//);
  assert.ok(stored.createdAt && stored.updatedAt);
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1, 'the recipient has one unread message');

  // The recipient's poll (what the real-time view uses) shows it, with the sender and time kept.
  const received = await load(b);
  const message = received.body.messages.find(m => m.id === 'gif-message-0001');
  assert.equal(message.kind, 'gif');
  assert.equal(message.senderId, a.uid);
  assert.equal(message.gif.url, stored.gif.url);
  assert.ok(message.createdAt);
  assert.equal(await count(), 1);
});

test('a GIF that arrives after the first load comes through the change-only poll', { skip }, async () => {
  const { a, b, sendGif, call, pairId, load } = await setup();
  await call(a, 'POST', { action: 'send-message', pairId, text: 'hello', messageId: 'text-message-0001' });
  const first = await load(b);
  assert.deepEqual(first.body.messages.map(m => m.id), ['text-message-0001']);
  await sendGif(a, GOOD, { messageId: 'gif-message-0002' });
  const delta = await load(b, first.body.cursor);
  const gif = delta.body.messages.find(m => m.id === 'gif-message-0002');
  assert.equal(gif.kind, 'gif');
  assert.equal(gif.gif.id, GOOD);
});

test('sending the same GIF message twice makes one message and does not ask GIPHY again', { skip }, async () => {
  const { sendGif, count, a } = await setup();
  const first = await sendGif(a, GOOD, { messageId: 'gif-message-0003' });
  assert.equal(first.statusCode, 201);
  const callsAfterFirst = giphyCalls.length;
  const again = await sendGif(a, GOOD, { messageId: 'gif-message-0003' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.kind, 'gif');
  assert.equal(giphyCalls.length, callsAfterFirst, 'a repeat is answered from what was stored');
  assert.equal(await count(), 1);
});

test('someone else cannot take over a GIF message id', { skip }, async () => {
  const { a, b, sendGif, count } = await setup();
  assert.equal((await sendGif(a, GOOD, { messageId: 'gif-message-0004' })).statusCode, 201);
  assert.equal((await sendGif(b, GOOD, { messageId: 'gif-message-0004' })).statusCode, 409);
  assert.equal(await count(), 1);
});

test('invalid GIF ids, links and mixed-up requests are refused before GIPHY is asked', { skip }, async () => {
  const { a, call, pairId, sendGif, count } = await setup();
  for (const id of [undefined, '', 'abc', '../../v1/gifs/search', 'has space 12345', 'x'.repeat(31), 'a/b/c/d/e/f', 12345678, { $ne: 1 }]) {
    const res = await sendGif(a, id);
    assert.equal(res.statusCode, 400, JSON.stringify(id));
    assert.equal(res.body.error, 'invalid_gif');
  }
  // Links, whole GIF objects or text cannot ride along: the server decides what is stored.
  for (const extra of [
    { url: 'https://evil.example/x.gif' }, { gifUrl: 'https://media.giphy.com/media/goodGif123/giphy.gif' },
    { gif: { id: GOOD, url: 'https://evil.example/x.gif' } }, { text: 'sneaky' },
  ]) {
    const res = await sendGif(a, GOOD, extra);
    assert.equal(res.statusCode, 400, JSON.stringify(extra));
    assert.equal(res.body.error, 'invalid_gif');
  }
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, kind: 'video', gifId: GOOD })).statusCode, 400);
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, kind: 'photo', text: 'x' })).statusCode, 400, 'photos only go through send-photo');
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'hi', gifId: GOOD })).statusCode, 400, 'a text message cannot carry a GIF id');
  assert.equal(giphyCalls.length, 0);
  assert.equal(await count(), 0);
});

test('a GIF GIPHY does not know, or whose addresses are not GIPHY, or that is rated too strongly, is not sent', { skip }, async () => {
  const { a, sendGif, count } = await setup();
  for (const id of ['unknown12345', 'foreign1234', 'adultgif123']) {
    const res = await sendGif(a, id);
    assert.equal(res.statusCode, 404, id);
    assert.equal(res.body.error, 'gif_not_found');
  }
  assert.equal(await count(), 0);
});

test('GIPHY trouble while sending fails cleanly and nothing is stored', { skip }, async () => {
  const { db, pairId, a, b, sendGif, count } = await setup();
  giphyMode = 'rate';
  assert.equal((await sendGif(a, GOOD, { messageId: 'gif-message-0005' })).body.error, 'gif_rate_limited');
  giphyMode = 'down';
  assert.equal((await sendGif(a, GOOD, { messageId: 'gif-message-0005' })).body.error, 'gif_unavailable');
  assert.equal(await count(), 0);
  giphyMode = 'ok';
  assert.equal((await sendGif(a, GOOD, { messageId: 'gif-message-0005' })).statusCode, 201, 'the same send works once GIPHY is back');
  assert.equal((await db.doc(`signalsInbox/${b.uid}`).get()).data().unread[pairId], 1, 'only the successful send counted as unread');
});

test('GIF messages cannot bypass the conversation rules: outsiders, blocks, suspensions and ended pairs', { skip }, async () => {
  const { db, pairId, a, b, outsider, sendGif, count } = await setup();
  const fresh = () => { giphyCalls.length = 0; };

  fresh();
  assert.equal((await sendGif(outsider, GOOD)).statusCode, 403, 'not in the conversation');
  assert.equal((await sendGif(outsider, GOOD, { pairId: 'pair-does-not-exist-1' })).statusCode, 404, 'no such conversation');
  assert.equal(giphyCalls.length, 0, 'GIPHY is not asked for someone who may not send');

  // I blocked them / they blocked me.
  await db.doc(`users/${a.uid}/private/settings`).set({ blockedPartnerIds: [b.uid] });
  assert.equal((await sendGif(a, GOOD)).statusCode, 403);
  assert.equal((await sendGif(b, GOOD)).statusCode, 403);
  await db.doc(`users/${a.uid}/private/settings`).set({ blockedPartnerIds: [] });
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
  assert.equal((await sendGif(a, GOOD)).statusCode, 403);
  assert.equal((await sendGif(b, GOOD)).statusCode, 403);
  await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [] });

  // Either member suspended.
  await db.doc(`suspensions/${a.uid}`).set({ reason: 'test' });
  assert.equal((await sendGif(a, GOOD)).statusCode, 403);
  assert.equal((await sendGif(b, GOOD)).statusCode, 403);
  await db.doc(`suspensions/${a.uid}`).delete();

  // Ended connection.
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await sendGif(a, GOOD)).statusCode, 409);

  assert.equal(giphyCalls.length, 0, 'GIPHY was never asked for a refused send');
  assert.equal(await count(), 0);
});

test('a member who sends too many GIFs is slowed down', { skip }, async () => {
  const { a, sendGif, count } = await setup();
  let last;
  for (let i = 0; i < 21; i += 1) last = await sendGif(a, GOOD);
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.error, 'rate_limited');
  assert.equal(await count(), 20);
});

test('a GIF can answer another message', { skip }, async () => {
  const { a, b, call, pairId, sendGif, load } = await setup();
  await call(a, 'POST', { action: 'send-message', pairId, text: 'look at this', messageId: 'text-message-0002' });
  const reply = await sendGif(b, GOOD, { messageId: 'gif-message-0006', replyTo: { messageId: 'text-message-0002', text: 'look at this', sender: 'partner' } });
  assert.equal(reply.statusCode, 201);
  assert.equal(reply.body.replyTo.messageId, 'text-message-0002');
  const seen = (await load(a)).body.messages.find(m => m.id === 'gif-message-0006');
  assert.equal(seen.kind, 'gif');
  assert.equal(seen.replyTo.text, 'look at this');
});

test('a stored GIF record with a bad address is shown as plain text, never as a picture', { skip }, async () => {
  const { db, pairId, a, b, load } = await setup();
  await db.doc(`signalsPairs/${pairId}/messages/bad-gif-record-1`).set({
    senderId: a.uid, text: 'GIF', kind: 'gif', createdAt: new Date(), updatedAt: new Date(),
    gif: { id: GOOD, url: 'https://evil.example/x.gif', previewUrl: media(GOOD, '200w'), width: 400, height: 300 },
  });
  await db.doc(`signalsPairs/${pairId}/messages/bad-gif-record-2`).set({
    senderId: a.uid, text: 'GIF', kind: 'gif', createdAt: new Date(Date.now() + 1000), updatedAt: new Date(),
  });
  const seen = (await load(b)).body.messages;
  for (const id of ['bad-gif-record-1', 'bad-gif-record-2']) {
    const m = seen.find(x => x.id === id);
    assert.equal(m.text, 'GIF');
    assert.equal('gif' in m, false, id);
    assert.equal(m.kind, undefined, id);
  }
});

test('text messages, replies and reactions still work exactly as before', { skip }, async () => {
  const { a, b, call, pairId, load } = await setup();
  const text = await call(a, 'POST', { action: 'send-message', pairId, text: 'Hello there', messageId: 'text-message-0003' });
  assert.equal(text.statusCode, 201);
  assert.equal(text.body.kind, undefined);
  assert.equal(text.body.text, 'Hello there');
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: 'x', kind: 'text' })).statusCode, 201, 'an explicit text kind is fine');
  assert.equal((await call(a, 'POST', { action: 'send-message', pairId, text: '' })).statusCode, 400);
  const reaction = await call(b, 'POST', { action: 'react-message', pairId, messageId: 'text-message-0003', emoji: '❤️' });
  assert.equal(reaction.statusCode, 200);
  const seen = (await load(b)).body.messages;
  assert.equal(seen.find(m => m.id === 'text-message-0003').text, 'Hello there');
  assert.equal(seen.find(m => m.id === 'text-message-0003').kind, undefined);
});
