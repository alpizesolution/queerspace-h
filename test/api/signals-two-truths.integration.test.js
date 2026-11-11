// Two Truths and a Lie against the real emulators: the answer is never in anything a member can read before the recipient's guess,
// only the intended recipient can guess, once, and both members then see the same result.
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

const GAME = { statements: ['I have climbed a volcano', 'I have a pet snake', 'I can juggle five balls'], lie: 1, intro: 'Try me!' };

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
  const sendGame = (user, game = GAME, extra = {}) => call(user, 'POST', { action: 'send-message', pairId, kind: 'game', game, ...extra });
  const guess = (user, messageId, value, extra = {}) => call(user, 'POST', { action: 'guess-game', pairId, messageId, guess: value, ...extra });
  const load = (user, after) => call(user, 'GET', undefined, { view: 'messages', pairId, ...(after ? { after } : {}) });
  return { db, pairId, a, b, outsider, call, sendGame, guess, load };
}

test('a challenge is sent as one message; the recipient sees the statements and can guess, the sender cannot', { skip }, async () => {
  const { a, b, sendGame, load } = await setup();
  const sent = await sendGame(a);
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.kind, 'game');
  assert.deepEqual(sent.body.game.statements, GAME.statements);
  assert.equal(sent.body.game.intro, 'Try me!');
  assert.equal(sent.body.game.canGuess, false, 'the sender does not guess their own');
  const theirs = (await load(b)).body.messages;
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0].game.canGuess, true);
  assert.equal(theirs[0].game.status, 'open');
  assert.equal(theirs[0].senderId, a.uid);
  assert.equal((await load(a)).body.messages[0].game.canGuess, false);
});

test('the answer is in nothing a member can read before the guess: not the API, not the response to sending, not Firestore data they can reach', { skip }, async () => {
  const { a, b, sendGame, load, db, pairId } = await setup();
  const sent = await sendGame(a);
  const id = sent.body.id;
  for (const body of [sent.body, (await load(a)).body, (await load(b)).body]) {
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /"lie"|"correct"|"guess"/, 'no answer field');
  }
  // The visible message document holds no answer; it is in the separate document only.
  const message = (await db.doc(`signalsPairs/${pairId}/messages/${id}`).get()).data();
  assert.equal(message.game.lie, undefined);
  assert.equal(message.game.guess, undefined);
  assert.equal((await db.doc(`signalsPairs/${pairId}/gameSecrets/${id}`).get()).data().lie, GAME.lie);
});

test('a correct and a wrong guess reveal the answer to both members, and the same result is seen after reloading', { skip }, async () => {
  for (const [value, correct] of [[1, true], [0, false]]) {
    const { a, b, sendGame, guess, load } = await setup();
    const id = (await sendGame(a)).body.id;
    const res = await guess(b, id, value);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.game.status, 'complete');
    assert.equal(res.body.game.lie, 1);
    assert.equal(res.body.game.guess, value);
    assert.equal(res.body.game.correct, correct);
    assert.equal(res.body.game.canGuess, false);
    for (const viewer of [a, b]) {
      const seen = (await load(viewer)).body.messages;
      assert.equal(seen.length, 1, 'no duplicate card');
      assert.deepEqual(seen[0].game, { statements: GAME.statements, intro: 'Try me!', status: 'complete', canGuess: false, guess: value, lie: 1, correct });
    }
  }
});

test('a guess reaches the sender through the next poll (it bumps the message), so both screens update without a refresh', { skip }, async () => {
  const { a, b, sendGame, guess, load } = await setup();
  const id = (await sendGame(a)).body.id;
  const first = await load(a);
  await new Promise(resolve => setTimeout(resolve, 50));
  await guess(b, id, 2);
  const delta = await load(a, first.body.cursor);
  assert.equal(delta.body.messages.length, 1);
  assert.equal(delta.body.messages[0].game.status, 'complete');
  assert.equal(delta.body.messages[0].game.lie, 1);
});

test('only the intended recipient can guess: not the sender, not an outsider, not someone signed out', { skip }, async () => {
  const { a, outsider, b, sendGame, guess, call, load } = await setup();
  const id = (await sendGame(a)).body.id;
  assert.equal((await guess(a, id, 1)).statusCode, 403, 'the sender cannot guess their own challenge');
  assert.equal((await guess(outsider, id, 1)).statusCode, 403);
  assert.equal((await call(null, 'POST', { action: 'guess-game', pairId: 'x'.repeat(10), messageId: id, guess: 1 })).statusCode, 401);
  const still = (await load(b)).body.messages[0].game;
  assert.equal(still.status, 'open');
  assert.equal(still.lie, undefined, 'a refused guess reveals nothing');
});

test('one guess per challenge: a different second guess is refused and changes nothing; the same guess again is a harmless retry', { skip }, async () => {
  const { a, b, sendGame, guess, load } = await setup();
  const id = (await sendGame(a)).body.id;
  assert.equal((await guess(b, id, 0)).statusCode, 200);
  const second = await guess(b, id, 1);
  assert.equal(second.statusCode, 409);
  assert.doesNotMatch(JSON.stringify(second.body), /"lie"/);
  const retry = await guess(b, id, 0);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.replayed, true);
  const stored = (await load(a)).body.messages[0].game;
  assert.equal(stored.guess, 0);
  assert.equal(stored.correct, false);
});

test('two guesses at once record one', { skip }, async () => {
  const { a, b, sendGame, guess, load } = await setup();
  const id = (await sendGame(a)).body.id;
  const results = await Promise.all([guess(b, id, 0), guess(b, id, 1), guess(b, id, 2)]);
  assert.equal(results.filter(r => r.statusCode === 200).length >= 1, true);
  const stored = (await load(a)).body.messages[0].game;
  assert.equal(stored.status, 'complete');
  assert.ok([0, 1, 2].includes(stored.guess));
  assert.equal(results.filter(r => r.statusCode === 200 && !r.body.replayed).length, 1, 'exactly one guess was recorded');
});

test('each challenge is its own game: several in one conversation, from both members, each with its own answer', { skip }, async () => {
  const { a, b, sendGame, guess, load } = await setup();
  const one = (await sendGame(a, { ...GAME, lie: 0 })).body.id;
  const two = (await sendGame(a, { statements: ['x one', 'y two', 'z three'], lie: 2 })).body.id;
  const three = (await sendGame(b, { statements: ['p one', 'q two', 'r three'], lie: 1 })).body.id;
  await guess(b, one, 0);
  assert.equal((await guess(a, three, 2)).body.game.correct, false);
  const seen = (await load(a)).body.messages;
  const by = Object.fromEntries(seen.map(m => [m.id, m.game]));
  assert.equal(by[one].status, 'complete');
  assert.equal(by[two].status, 'open');
  assert.equal(by[two].lie, undefined);
  assert.equal(by[three].lie, 1);
  assert.equal((await guess(b, two, 2)).body.game.correct, true);
  assert.equal((await guess(b, three, 0)).statusCode, 403, 'b made game three and cannot guess it');
});

test('a challenge that is not valid is refused and nothing is stored', { skip }, async () => {
  const { a, db, pairId, sendGame } = await setup();
  const bad = [
    { ...GAME, statements: ['one', 'two'] },
    { ...GAME, statements: ['one', 'two', ''] },
    { ...GAME, statements: ['one', 'two', '   '] },
    { ...GAME, statements: ['Same thing', 'same THING', 'other'] },
    { ...GAME, statements: ['one', 'two', 'x'.repeat(141)] },
    { ...GAME, lie: 3 },
    { ...GAME, lie: -1 },
    { ...GAME, lie: '1' },
    { ...GAME, lie: undefined },
    { ...GAME, intro: 'x'.repeat(141) },
    { ...GAME, extra: true },
    { ...GAME, statements: [1, 2, 3] },
    'nope',
  ];
  for (const game of bad) assert.equal((await sendGame(a, game)).statusCode, 400, JSON.stringify(game));
  assert.equal((await sendGame(a, GAME, { text: 'hi' })).statusCode, 400, 'no extra text');
  assert.equal((await sendGame(a, GAME, { cardId: 'soft-01' })).statusCode, 400);
  assert.equal((await db.collection(`signalsPairs/${pairId}/messages`).get()).size, 0);
  assert.equal((await db.collection(`signalsPairs/${pairId}/gameSecrets`).get()).size, 0);
});

test('a game cannot be forged through an ordinary message, and an ordinary message cannot be guessed', { skip }, async () => {
  const { a, b, call, pairId, guess } = await setup();
  const forged = await call(a, 'POST', { action: 'send-message', pairId, text: 'hello', game: GAME });
  assert.equal(forged.statusCode, 400);
  const plain = await call(a, 'POST', { action: 'send-message', pairId, text: 'hello' });
  assert.equal((await guess(b, plain.body.id, 0)).statusCode, 404);
  assert.equal((await guess(b, 'no-such-message', 0)).statusCode, 404);
  for (const value of [3, -1, '1', null, 1.5]) assert.equal((await guess(b, plain.body.id, value)).statusCode, 400);
});

test('a retried send makes one card and one answer, and an outsider or a ended connection cannot send or guess', { skip }, async () => {
  const { a, b, outsider, sendGame, guess, load, db, pairId } = await setup();
  const messageId = `game-${Date.now()}-retry`;
  const first = await sendGame(a, GAME, { messageId });
  const again = await sendGame(a, GAME, { messageId });
  assert.equal(first.statusCode, 201);
  assert.equal(again.statusCode, 200);
  assert.equal((await load(b)).body.messages.length, 1);
  assert.equal((await db.collection(`signalsPairs/${pairId}/gameSecrets`).get()).size, 1);
  assert.equal((await sendGame(outsider)).statusCode, 403);
  await db.doc(`signalsPairs/${pairId}`).update({ status: 'ended' });
  assert.equal((await guess(b, messageId, 1)).statusCode, 409);
  assert.equal((await sendGame(a)).statusCode, 409);
});

test('the recipient gets an unread count and the inbox preview; the sender gets their own preview', { skip }, async () => {
  const { a, b, sendGame, db, pairId } = await setup();
  await sendGame(a);
  const theirs = (await db.doc(`signalsInbox/${b.uid}`).get()).data();
  assert.equal(theirs.unread[pairId], 1);
  assert.equal(theirs.last[pairId].text, '✨ Sent you a Two Truths and a Lie challenge.');
  assert.equal((await db.doc(`signalsInbox/${a.uid}`).get()).data().last[pairId].text, '✨ You sent a Two Truths and a Lie challenge.');
});

// ---------------------------------------------------------------- the creator's notification
const GUESSED = '✨ Someone guessed your Two Truths and a Lie!';
const inboxOf = async (db, uid) => (await db.doc(`signalsInbox/${uid}`).get()).data() ?? {};

test('a guess notifies the creator once: one more unread and the fixed line, nothing about the guess or the answer', { skip }, async () => {
  const { a, b, sendGame, guess, db, pairId } = await setup();
  const id = (await sendGame(a)).body.id;
  assert.equal((await inboxOf(db, a.uid)).unread?.[pairId], undefined, 'nothing unread for the sender before a guess');
  await guess(b, id, 0);
  const after = await inboxOf(db, a.uid);
  assert.equal(after.unread[pairId], 1);
  assert.equal(after.last[pairId].text, GUESSED);
  assert.equal(after.last[pairId].mine, false);
  assert.doesNotMatch(JSON.stringify(after), /statement|"lie"|"guess"|volcano|snake|juggle/i, 'the inbox carries no answer, guess or statement');
  // The guesser is not notified of their own guess, and their own latest line is the challenge they received.
  const guesser = await inboxOf(db, b.uid);
  assert.equal(guesser.unread?.[pairId], 1, 'still just the challenge');
  assert.equal(guesser.last[pairId].text, '✨ Sent you a Two Truths and a Lie challenge.');
});

test('a retried or simultaneous guess does not notify twice', { skip }, async () => {
  const { a, b, sendGame, guess, db, pairId } = await setup();
  const id = (await sendGame(a)).body.id;
  await Promise.all([guess(b, id, 1), guess(b, id, 1), guess(b, id, 2)]);
  await guess(b, id, 1);
  await guess(b, id, 2);
  assert.equal((await inboxOf(db, a.uid)).unread[pairId], 1);
});

test('marking the conversation read clears the guess notification, even when the other person never wrote', { skip }, async () => {
  const { a, b, sendGame, guess, call, db, pairId } = await setup();
  const id = (await sendGame(a)).body.id;
  await guess(b, id, 0);
  assert.equal((await inboxOf(db, a.uid)).unread[pairId], 1);
  const read = await call(a, 'POST', { action: 'mark-read', pairId, throughMessageId: id });
  assert.equal(read.statusCode, 200);
  assert.equal((await inboxOf(db, a.uid)).unread?.[pairId], undefined);
});

test('a refused guess notifies nobody and changes no inbox', { skip }, async () => {
  const { a, b, outsider, sendGame, guess, db } = await setup();
  const id = (await sendGame(a)).body.id;
  const before = JSON.stringify(await inboxOf(db, a.uid));
  await guess(a, id, 1);
  await guess(outsider, id, 1);
  await guess(b, id, 9);
  assert.equal(JSON.stringify(await inboxOf(db, a.uid)), before);
  assert.equal((await inboxOf(db, outsider.uid)).last, undefined);
});

// ---------------------------------------------------------------- audit: blocked, suspended, signed out
test('a blocked or suspended member can neither send nor guess, and nothing is revealed or notified', { skip }, async () => {
  for (const kind of ['recipient blocks sender', 'sender blocks recipient', 'recipient suspended', 'sender suspended']) {
    const { a, b, sendGame, guess, db, pairId, load } = await setup();
    const id = (await sendGame(a)).body.id;
    if (kind === 'recipient blocks sender') await db.doc(`users/${b.uid}/private/settings`).set({ blockedPartnerIds: [a.uid] });
    if (kind === 'sender blocks recipient') await db.doc(`users/${a.uid}/private/settings`).set({ blockedPartnerIds: [b.uid] });
    if (kind === 'recipient suspended') await db.doc(`suspensions/${b.uid}`).set({ reason: 'test' });
    if (kind === 'sender suspended') await db.doc(`suspensions/${a.uid}`).set({ reason: 'test' });
    const before = JSON.stringify(await inboxOf(db, a.uid));
    const res = await guess(b, id, 1);
    assert.equal(res.statusCode, 403, kind);
    assert.doesNotMatch(JSON.stringify(res.body), /"lie"|"correct"/, kind);
    assert.equal(JSON.stringify(await inboxOf(db, a.uid)), before, `${kind}: no notification`);
    assert.equal((await sendGame(b)).statusCode, 403, `${kind}: sending is refused too`);
    assert.equal((await load(b)).statusCode, 403, `${kind}: the conversation cannot be read`);
    assert.equal((await db.doc(`signalsPairs/${pairId}/messages/${id}`).get()).data().game.status, 'open');
  }
});

test('signed out, a bad token and a wrong method are refused before anything is read', { skip }, async () => {
  const { a, b, sendGame, call, pairId } = await setup();
  const id = (await sendGame(a)).body.id;
  assert.equal((await call(null, 'POST', { action: 'guess-game', pairId, messageId: id, guess: 1 })).statusCode, 401);
  assert.equal((await call({ token: 'nope' }, 'POST', { action: 'guess-game', pairId, messageId: id, guess: 1 })).statusCode, 401);
  assert.equal((await call(null, 'GET', undefined, { view: 'messages', pairId })).statusCode, 401);
  assert.equal((await call(b, 'GET', undefined, { view: 'guess-game', pairId, messageId: id })).statusCode, 400, 'guessing is not a GET view');
  assert.equal((await call(b, 'PUT', {})).statusCode, 405);
});

// ---------------------------------------------------------------- audit: no API surface returns the answer before the guess
test('while a game is open, no API action returns the answer, to the sender, the recipient or an outsider', { skip }, async () => {
  const { a, b, outsider, sendGame, call, load, pairId } = await setup();
  const sent = await sendGame(a);
  const id = sent.body.id;
  const text = (x) => JSON.stringify(x.body);
  const surfaces = [
    sent,
    await sendGame(a, GAME, { messageId: id }), // a retry of the same send
    await load(a), await load(b), await load(outsider),
    await load(b, new Date(0).toISOString()), // a delta poll from the beginning of time
    await call(a, 'GET', undefined, { view: 'pairs' }),
    await call(b, 'GET', undefined, { view: 'pairs', pairId }),
    await call(b, 'GET', undefined, { view: 'pairs', limit: '50' }),
    await call(a, 'GET', undefined, { view: 'requests' }),
    await call(a, 'GET', undefined, {}),
    await call(b, 'POST', { action: 'react-message', pairId, messageId: id, emoji: '✨' }),
    await call(b, 'POST', { action: 'mark-read', pairId, throughMessageId: id }),
    await call(b, 'POST', { action: 'send-message', pairId, text: 'hi', replyTo: { messageId: id, text: '✨ Two Truths and a Lie', sender: 'partner' } }),
    await call(b, 'POST', { action: 'open-photo', pairId, messageId: id }),
  ];
  for (const res of surfaces) assert.doesNotMatch(text(res), /"lie"|"correct"|"guess"|gameSecrets/, `${res.statusCode} ${text(res).slice(0, 120)}`);
  assert.equal(surfaces[4].statusCode, 403, 'an outsider gets nothing at all');
  const quoted = (await load(a)).body.messages.find((m) => m.replyTo);
  assert.equal(quoted.replyTo.text, '✨ Two Truths and a Lie', 'a reply that quotes the challenge carries only its fixed title');
});

test('simultaneous guesses always agree, and a loser never learns more than the winner', { skip }, async () => {
  const { a, b, sendGame, guess, load } = await setup();
  const id = (await sendGame(a)).body.id;
  const results = await Promise.all([0, 1, 2, 0, 1, 2].map((value) => guess(b, id, value)));
  const winners = results.filter((r) => r.statusCode === 200 && !r.body.replayed);
  assert.equal(winners.length, 1);
  const final = (await load(a)).body.messages[0].game;
  assert.equal(final.guess, winners[0].body.game.guess);
  for (const r of results.filter((r) => r.statusCode === 200)) assert.deepEqual(r.body.game, final, 'every success reports the one recorded result');
  for (const r of results.filter((r) => r.statusCode !== 200)) {
    assert.equal(r.statusCode, 409);
    assert.doesNotMatch(JSON.stringify(r.body), /"lie"/);
  }
  assert.deepEqual((await load(b)).body.messages[0].game, final, 'both people see the same result');
});
