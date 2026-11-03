// Connection requests against the real Auth and Firestore emulators: sending, the limits on senders, accepting, declining,
// withdrawing, and every safety check. The server decides; nothing here trusts a client field.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: handler } = await import('../../api/signals.js');
  // A second copy of the module has its own in-process queue, like a second serverless instance would.
  const { default: secondInstance } = await import('../../api/signals.js?second-instance');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const adult = () => Timestamp.fromMillis(Date.now() - 30 * YEAR);
  const member = async (extra = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: adult(), ...extra });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: `Member ${user.uid.slice(0, 4)}`, avatar: 'cat.1.2', pronouns: 'she/her', aboutMe: 'Hello there', profileComplete: true });
    return user;
  };
  const callOn = (which) => async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await which({ method, headers: { authorization: `Bearer ${user.token}` }, body, query: query ?? {} }, res);
    return res;
  };
  const call = callOn(handler);
  const callSecond = callOn(secondInstance);
  const author = await member();
  const postId = `${author.uid}_dating`;
  const post = (extra = {}) => db.doc(`looking_for_posts/${postId}`).set({ authorId: author.uid, intention: 'dating', title: 'Quiet reader', intro: 'i', lookingFor: 'l', tags: [], isNsfw: false, contentWarning: null, timestamp: Timestamp.now(), ...extra });
  await post();
  let n = 0;
  /** Asks to connect. `fresh` clears the sender's pace, so most tests are not slowed by the 30-second cool-down. */
  const ask = async (from, extra = {}, { fresh = true, to = author, id = postId } = {}) => {
    n += 1;
    if (fresh) await db.doc(`signalsRateLimits/${from.uid}`).delete();
    return call(from, 'POST', { action: 'request-create', recipientId: to.uid, lookingForPostId: id, idempotencyKey: `idem-request-${Date.now()}-${n}`, message: 'Hi, I loved your post!', ...extra });
  };
  const act = (user, action, requestId) => call(user, 'POST', { action, requestId });
  const actSecond = (user, action, requestId) => callSecond(user, 'POST', { action, requestId });
  const getRequest = async (id) => (await db.doc(`connection_requests/${id}`).get()).data();
  const events = async (id) => (await db.collection('connection_request_events').where('requestId', '==', id).get()).docs.map((d) => d.data().action).sort();
  const list = async (user) => (await call(user, 'GET', undefined, { view: 'requests' })).body;
  const inbox = async (user) => (await db.doc(`signalsInbox/${user.uid}`).get()).data() ?? {};
  return { db, Timestamp, member, call, callSecond, actSecond, author, postId, post, ask, act, getRequest, events, list, inbox, adult, YEAR };
}

test('a valid request is stored with server-controlled fields and nothing private', { skip }, async () => {
  const { db, member, author, postId, ask, getRequest, events, inbox } = await setup();
  const sender = await member();
  const res = await ask(sender, { message: '  Hi there!  ' });
  assert.equal(res.statusCode, 201);
  const request = await getRequest(res.body.requestId);
  assert.equal(request.senderId, sender.uid);
  assert.equal(request.recipientId, author.uid);
  assert.equal(request.lookingForPostId, postId);
  assert.equal(request.intention, 'dating');
  assert.equal(request.message, 'Hi there!', 'trimmed');
  assert.equal(request.status, 'pending');
  assert.ok(request.createdAt && request.updatedAt && request.expiresAt, 'server timestamps');
  assert.equal(request.respondedAt, undefined);
  assert.deepEqual(Object.keys(request).sort(), ['createdAt', 'expiresAt', 'intention', 'lookingForPostId', 'message', 'recipientId', 'senderId', 'status', 'updatedAt'], 'no profile data is duplicated into the request');
  assert.ok(!JSON.stringify(request).includes('birthDate'));
  assert.deepEqual(await events(res.body.requestId), ['create']);
  assert.ok((await inbox(author)).requests[res.body.requestId], 'the author is told live');
  assert.equal((await db.doc(`signalsPairs/${res.body.requestId}`).get()).exists, false, 'no conversation until the author accepts');
});

test('input is validated: message length, ids, self-requests and missing keys', { skip }, async () => {
  const { member, author, postId, ask, call } = await setup();
  const sender = await member();
  assert.equal((await ask(sender, { message: 'x'.repeat(500) })).statusCode, 201);
  assert.equal((await ask(sender, { message: 'x'.repeat(501) })).statusCode, 400);
  assert.equal((await ask(sender, { message: 42 })).statusCode, 400);
  assert.equal((await ask(sender, { recipientId: 'short' })).statusCode, 400);
  assert.equal((await ask(sender, { lookingForPostId: 'no spaces allowed' })).statusCode, 400);
  assert.equal((await ask(sender, { idempotencyKey: 'tiny' })).statusCode, 400);
  const own = await ask(author, {}, { to: author });
  assert.equal(own.statusCode, 400, 'you cannot ask yourself');
  assert.equal((await call(sender, 'POST', { action: 'request-unknown' })).statusCode, 400);
  assert.equal(postId.length > 8, true);
});

test('only one pending request per pair, even when two arrive at the same moment', { skip }, async () => {
  const { member, ask, db, author } = await setup();
  const sender = await member();
  const first = await ask(sender);
  assert.equal(first.statusCode, 201);
  const again = await ask(sender);
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'already_pending');
  const other = await member();
  await db.doc(`signalsRateLimits/${other.uid}`).delete();
  const both = await Promise.all([ask(other, {}, { fresh: false }), ask(other, {}, { fresh: false })]);
  assert.deepEqual(both.map((r) => r.statusCode).sort(), [201, 409].sort(), 'exactly one wins');
  assert.equal((await db.collection('connection_requests').where('senderId', '==', other.uid).get()).size, 1);
  assert.equal((await db.collection('connection_requests').where('recipientId', '==', author.uid).get()).size, 2);
});

test('a retried send with the same key is answered with the same request', { skip }, async () => {
  const { member, call, author, postId, db } = await setup();
  const sender = await member();
  const body = { action: 'request-create', recipientId: author.uid, lookingForPostId: postId, idempotencyKey: 'idem-request-retry-1', message: 'hi' };
  const first = await call(sender, 'POST', body);
  assert.equal(first.statusCode, 201);
  const retry = await call(sender, 'POST', body);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.requestId, first.body.requestId);
  assert.equal((await db.collection('connection_requests').where('senderId', '==', sender.uid).get()).size, 1);
});

test('blocks in either direction, suspensions, and non-adults are all refused', { skip }, async () => {
  const { db, member, author, ask, adult, Timestamp, YEAR } = await setup();
  const blockedByAuthor = await member();
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [blockedByAuthor.uid] });
  assert.equal((await ask(blockedByAuthor)).statusCode, 403, 'the author blocked the sender');
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult() });
  const blocker = await member();
  await db.doc(`users/${blocker.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [author.uid] });
  assert.equal((await ask(blocker)).statusCode, 403, 'the sender blocked the author');
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await ask(suspended)).statusCode, 403, 'a suspended sender');
  const fine = await member();
  await db.doc(`suspensions/${author.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await ask(fine)).statusCode, 403, 'a suspended author');
  await db.doc(`suspensions/${author.uid}`).delete();
  const minor = await member();
  await db.doc(`users/${minor.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 16 * YEAR) });
  assert.equal((await ask(minor, { age: 30, isAdult: true })).statusCode, 403, 'an under-18 sender, whatever the request claims');
  const noBirthday = await member();
  await db.doc(`users/${noBirthday.uid}/private/settings`).delete();
  assert.equal((await ask(noBirthday)).statusCode, 403, 'no birthday on file');
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 16 * YEAR) });
  assert.equal((await ask(fine)).statusCode, 403, 'a recipient who is not an adult');
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult() });
  assert.equal((await ask(fine)).statusCode, 201);
});

test('the post must exist, belong to the recipient, and not be paused or deleted', { skip }, async () => {
  const { db, member, author, postId, post, ask } = await setup();
  const sender = await member();
  const stranger = await member();
  assert.equal((await ask(sender, {}, { to: stranger })).statusCode, 404, 'someone else cannot be asked through this post');
  assert.equal((await ask(sender, { lookingForPostId: 'author-nope_dating' })).statusCode, 404);
  await post({ requestsPaused: true });
  const paused = await ask(sender);
  assert.equal(paused.statusCode, 409);
  assert.equal(paused.body.error, 'post_paused');
  await post({ requestsPaused: false });
  assert.equal((await ask(sender)).statusCode, 201, 'resuming reopens it');
  await db.doc(`looking_for_posts/${postId}`).delete();
  const another = await member();
  assert.equal((await ask(another)).statusCode, 404, 'a deleted post takes no new requests');
  assert.equal(author.uid.length > 0, true);
});

test('sender anti-spam: a cool-down, a daily limit and a cap on waiting requests, never a cap on what an author receives', { skip }, async () => {
  const { db, member, author, ask, Timestamp } = await setup();
  const authorOf = async () => {
    const other = await member();
    await db.doc(`looking_for_posts/${other.uid}_dating`).set({ authorId: other.uid, intention: 'dating', title: 't', isNsfw: false });
    return { to: other, id: `${other.uid}_dating` };
  };
  const sender = await member();
  assert.equal((await ask(sender)).statusCode, 201);
  const second = await authorOf();
  const fast = await ask(sender, {}, { fresh: false, ...second });
  assert.equal(fast.statusCode, 429);
  assert.equal(fast.body.error, 'rate_limited', 'the 30-second pace');

  // A daily limit of 20 new requests per rolling day; the count starts again after a day.
  const busy = await member();
  const stamp = (windowAgoMs, count) => db.doc(`signalsRateLimits/${busy.uid}`).set({
    lastRequestAt: Timestamp.fromMillis(Date.now() - 120_000), requestWindowStart: Timestamp.fromMillis(Date.now() - windowAgoMs), requestWindowCount: count,
  });
  await stamp(3_600_000, 20);
  const over = await ask(busy, {}, { fresh: false, ...(await authorOf()) });
  assert.equal(over.statusCode, 429);
  assert.equal(over.body.error, 'daily_limit');
  await stamp(3_600_000, 19);
  assert.equal((await ask(busy, {}, { fresh: false, ...(await authorOf()) })).statusCode, 201, 'the twentieth is still allowed');
  assert.equal((await db.doc(`signalsRateLimits/${busy.uid}`).get()).data().requestWindowCount, 20);
  await stamp(25 * 3_600_000, 20);
  assert.equal((await ask(busy, {}, { fresh: false, ...(await authorOf()) })).statusCode, 201, 'a day later the count starts again');
  assert.equal((await db.doc(`signalsRateLimits/${busy.uid}`).get()).data().requestWindowCount, 1);

  // A cap on how many of one member's requests can be waiting at once.
  const hoarder = await member();
  for (let i = 0; i < 30; i += 1) await db.collection('connection_requests').add({ senderId: hoarder.uid, recipientId: `someone-${i}-xxxxxxxx`, status: 'pending', lookingForPostId: 'x', createdAt: Timestamp.now() });
  const capped = await ask(hoarder);
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.body.error, 'too_many_pending');

  // Receiving is unlimited: thirty different members can all ask the same author at the same instant.
  const many = [];
  for (let i = 0; i < 30; i += 1) many.push(await member());
  const results = await Promise.all(many.map((m) => ask(m)));
  assert.ok(results.every((r) => r.statusCode === 201), 'every one of thirty reaches the author: ' + JSON.stringify(results.map((r) => [r.statusCode, r.body?.error]).filter((x) => x[0] !== 201)));
  assert.ok(Object.keys((await db.doc(`signalsInbox/${author.uid}`).get()).data().requests).length >= 30);
});

test('requests can only be read through the API, and only by the two people involved', { skip }, async () => {
  const { member, author, ask, list } = await setup();
  const sender = await member();
  const outsider = await member();
  const res = await ask(sender, { message: 'a private hello' });
  const mine = await list(sender);
  assert.equal(mine.sent.length, 1);
  assert.equal(mine.sent[0].message, 'a private hello');
  assert.equal(mine.incoming.length, 0);
  const theirs = await list(author);
  assert.equal(theirs.incoming.length, 1);
  assert.equal(theirs.incoming[0].id, res.body.requestId);
  assert.equal(theirs.incoming[0].partner.displayName.startsWith('Member'), true);
  assert.equal(theirs.incoming[0].partner.about, 'Hello there');
  assert.ok(!JSON.stringify(theirs).includes('birthDate'), 'no private data in the preview');
  const nothing = await list(outsider);
  assert.deepEqual([nothing.incoming.length, nothing.sent.length], [0, 0]);
});

test('only the recipient can accept or decline, only the sender can withdraw, and strangers learn nothing', { skip }, async () => {
  const { member, author, ask, act, getRequest, events } = await setup();
  const sender = await member();
  const stranger = await member();
  const { body: { requestId } } = await ask(sender);
  assert.equal((await act(sender, 'request-accept', requestId)).statusCode, 403, 'the sender cannot accept their own request');
  assert.equal((await act(sender, 'request-decline', requestId)).statusCode, 403);
  assert.equal((await act(author, 'request-withdraw', requestId)).statusCode, 403, 'the recipient cannot withdraw');
  for (const action of ['request-accept', 'request-decline', 'request-withdraw']) {
    assert.equal((await act(stranger, action, requestId)).statusCode, 404, `${action} by a stranger`);
  }
  assert.equal((await act(author, 'request-accept', 'no-such-request-id')).statusCode, 404);
  assert.equal((await act(author, 'request-accept', 'bad id')).statusCode, 400);
  assert.equal((await getRequest(requestId)).status, 'pending', 'nothing changed');
  assert.deepEqual(await events(requestId), ['create']);
});

test('accepting opens one private conversation, notifies the sender, and the two can message', { skip }, async () => {
  const { db, member, author, ask, act, call, getRequest, events, inbox } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  const res = await act(author, 'request-accept', requestId);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'accepted');
  const request = await getRequest(requestId);
  assert.equal(request.status, 'accepted');
  assert.equal(request.conversationId, requestId);
  assert.ok(request.respondedAt);
  const pair = (await db.doc(`signalsPairs/${requestId}`).get()).data();
  assert.deepEqual(pair.participants, [sender.uid, author.uid].sort());
  assert.equal(pair.status, 'active');
  assert.equal((await db.collection('signalsPairs').get()).size, 1);
  assert.ok((await inbox(sender)).notifications[requestId], 'the sender gets the "request accepted" notification');
  assert.equal((await inbox(author)).requests?.[requestId], undefined, 'it leaves the author\'s waiting list');
  assert.equal((await db.doc(`connection_request_locks/${sender.uid}_${author.uid}`).get()).exists, false);
  assert.deepEqual(await events(requestId), ['accept', 'create']);
  // The conversation is the existing Signals one: both can message in it, and others cannot.
  const sent = await call(sender, 'POST', { action: 'send-message', pairId: requestId, text: 'Hello!', messageId: 'request-message-0001' });
  assert.equal(sent.statusCode, 201);
  assert.equal((await call(author, 'GET', undefined, { view: 'messages', pairId: requestId })).body.messages.length, 1);
});

test('accepting twice, or at the same moment, never makes a second conversation', { skip }, async () => {
  const { db, member, author, ask, act, events } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  const both = await Promise.all([act(author, 'request-accept', requestId), act(author, 'request-accept', requestId)]);
  assert.deepEqual(both.map((r) => r.statusCode), [200, 200]);
  assert.equal(both[0].body.conversationId, both[1].body.conversationId);
  const later = await act(author, 'request-accept', requestId);
  assert.equal(later.statusCode, 200);
  assert.equal(later.body.replayed, true);
  assert.equal((await db.collection('signalsPairs').get()).size, 1);
  assert.deepEqual(await events(requestId), ['accept', 'create'], 'one acceptance in the audit trail');
});

test('an existing conversation between the two is reused instead of opening another', { skip }, async () => {
  const { db, member, author, ask, act, getRequest, Timestamp } = await setup();
  const sender = await member();
  await db.doc('signalsPairs/existing-pair-0001').set({ participants: [sender.uid, author.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  // The usual check refuses a new request while a conversation is open, so make the request before it existed.
  await db.doc('signalsPairs/existing-pair-0001').delete();
  const { body: { requestId } } = await ask(sender);
  await db.doc('signalsPairs/existing-pair-0001').set({ participants: [sender.uid, author.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  const res = await act(author, 'request-accept', requestId);
  assert.equal(res.body.conversationId, 'existing-pair-0001');
  assert.equal((await getRequest(requestId)).conversationId, 'existing-pair-0001');
  assert.equal((await db.collection('signalsPairs').get()).size, 1, 'no duplicate conversation');
});

test('declining opens nothing and tells the sender nothing directly; it only shows in their Sent list', { skip }, async () => {
  const { db, member, author, ask, act, list, events, inbox, getRequest } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  const res = await act(author, 'request-decline', requestId);
  assert.equal(res.statusCode, 200);
  assert.equal((await getRequest(requestId)).status, 'declined');
  assert.ok((await getRequest(requestId)).respondedAt);
  assert.equal((await db.collection('signalsPairs').get()).size, 0, 'no conversation');
  assert.deepEqual((await inbox(sender)).notifications ?? {}, {}, 'no notification to the sender');
  assert.equal((await list(sender)).sent[0].status, 'declined');
  assert.equal((await act(author, 'request-decline', requestId)).body.replayed, true, 'declining again is harmless');
  assert.equal((await act(author, 'request-accept', requestId)).statusCode, 409, 'a declined request cannot be accepted');
  const again = await ask(sender);
  assert.equal(again.statusCode, 429);
  assert.equal(again.body.error, 'recently_declined', 'a short cool-down before asking the same person again');
  assert.deepEqual(await events(requestId), ['create', 'decline']);
});

test('withdrawing stops a request, frees the pair to ask again, and is safe to repeat', { skip }, async () => {
  const { db, member, author, ask, act, getRequest, inbox, events } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  const res = await act(sender, 'request-withdraw', requestId);
  assert.equal(res.statusCode, 200);
  assert.equal((await getRequest(requestId)).status, 'withdrawn');
  assert.equal((await inbox(author)).requests?.[requestId], undefined, 'it leaves the author\'s list at once');
  assert.equal((await act(sender, 'request-withdraw', requestId)).body.replayed, true);
  assert.equal((await act(author, 'request-accept', requestId)).statusCode, 409, 'a withdrawn request cannot be accepted');
  assert.equal((await db.collection('signalsPairs').get()).size, 0);
  assert.equal((await ask(sender)).statusCode, 201, 'the sender may ask again');
  assert.deepEqual(await events(requestId), ['create', 'withdraw']);
});

test('everything is checked again at the moment of accepting', { skip }, async () => {
  const { db, member, author, ask, act, getRequest, adult, Timestamp } = await setup();
  const blocked = await member();
  const a = (await ask(blocked)).body.requestId;
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [blocked.uid] });
  assert.equal((await act(author, 'request-accept', a)).statusCode, 403, 'blocked after asking');
  await db.doc(`users/${author.uid}/private/settings`).set({ birthDate: adult() });
  const suspended = await member();
  const b = (await ask(suspended)).body.requestId;
  await db.doc(`suspensions/${suspended.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await act(author, 'request-accept', b)).statusCode, 403, 'suspended after asking');
  assert.equal((await db.collection('signalsPairs').get()).size, 0);
  assert.equal((await getRequest(a)).status, 'pending');
  await db.doc(`suspensions/${suspended.uid}`).delete();
  assert.equal((await act(author, 'request-accept', b)).statusCode, 200, 'and works once the problem is gone');
});

test('requests expire, are shown as expired, and cannot be accepted', { skip }, async () => {
  const { db, member, author, ask, act, list, getRequest, Timestamp } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  await db.doc(`connection_requests/${requestId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await list(author)).incoming[0].status, 'expired', 'shown as expired');
  const res = await act(author, 'request-accept', requestId);
  assert.equal(res.body.status, 'expired');
  assert.equal((await getRequest(requestId)).status, 'expired');
  assert.equal((await db.collection('signalsPairs').get()).size, 0);
  assert.equal((await ask(sender)).statusCode, 201, 'an expired request no longer blocks a new one');
});

test('pausing or deleting a post keeps its requests: they stay visible, with the post state, and can still be answered', { skip }, async () => {
  const { db, member, author, postId, post, ask, act, list } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  await post({ requestsPaused: true });
  assert.equal((await list(author)).incoming[0].post.status, 'paused');
  assert.equal((await list(sender)).sent[0].post.status, 'paused');
  await db.doc(`looking_for_posts/${postId}`).delete();
  const afterDelete = (await list(author)).incoming[0];
  assert.equal(afterDelete.post.status, 'removed');
  assert.equal(afterDelete.intention, 'dating', 'the request still says what it was about');
  assert.equal(afterDelete.status, 'pending', 'nothing was deleted or changed');
  assert.equal((await act(author, 'request-accept', requestId)).body.status, 'accepted');
});

test('a sensitive post\'s title is never repeated in a request', { skip }, async () => {
  const { member, post, ask, list, author } = await setup();
  await post({ isNsfw: true, title: 'SPICY-TITLE-SECRET', contentWarning: 'Mature themes' });
  const sender = await member();
  await ask(sender);
  const incoming = (await list(author)).incoming[0];
  assert.equal(incoming.post.title, null);
  assert.equal(incoming.post.sensitive, true);
  assert.ok(!JSON.stringify(await list(sender)).includes('SPICY-TITLE-SECRET'));
});

test('the old Looking For shortcut is gone: Signals still needs a match', { skip }, async () => {
  const { member, author, postId, call } = await setup();
  const sender = await member();
  const res = await call(sender, 'POST', { action: 'create', recipientId: author.uid, lookingForPostId: postId, idempotencyKey: 'idem-old-path-0001', message: 'hi' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'not_matched');
});

// ------------------------------------------------------------------------------- concurrency: no duplicates, no 500s
const summary = (results) => results.map((r) => [r.statusCode, r.body?.error]).filter((x) => x[0] !== 200 && x[0] !== 201);

test('five accepts at the same instant all succeed with one conversation, one audit entry and one notification', { skip }, async () => {
  for (let round = 0; round < 5; round += 1) {
    const { db, member, author, ask, act, events, inbox } = await setup();
    const sender = await member();
    const { body: { requestId } } = await ask(sender);
    const all = await Promise.all(Array.from({ length: 5 }, () => act(author, 'request-accept', requestId)));
    assert.deepEqual(summary(all), [], `round ${round}: every accept succeeds`);
    assert.equal(new Set(all.map((r) => r.body.conversationId)).size, 1, 'they all name the same conversation');
    assert.equal((await db.collection('signalsPairs').get()).size, 1, 'exactly one conversation');
    assert.deepEqual(await events(requestId), ['accept', 'create'], 'one acceptance in the audit trail');
    assert.deepEqual(Object.keys((await inbox(sender)).notifications ?? {}), [requestId], 'one notification for the sender');
  }
});

test('thirty members asking one author at the same instant all get through, and the author sees thirty requests', { skip }, async () => {
  for (let round = 0; round < 3; round += 1) {
    const { db, member, author, ask } = await setup();
    const many = [];
    for (let i = 0; i < 30; i += 1) many.push(await member());
    const results = await Promise.all(many.map((m) => ask(m)));
    assert.deepEqual(summary(results), [], `round ${round}: nothing refused or failed`);
    assert.equal(new Set(results.map((r) => r.body.requestId)).size, 30, 'thirty different requests');
    assert.equal((await db.collection('connection_requests').where('recipientId', '==', author.uid).get()).size, 30);
    assert.equal(Object.keys((await db.doc(`signalsInbox/${author.uid}`).get()).data().requests).length, 30);
  }
});

test('the same send arriving several times at once is one request; different keys for one pair are one request and refusals', { skip }, async () => {
  const { db, member, author, postId, call } = await setup();
  const sender = await member();
  const body = { action: 'request-create', recipientId: author.uid, lookingForPostId: postId, idempotencyKey: 'idem-same-key-0001', message: 'hi' };
  const same = await Promise.all(Array.from({ length: 5 }, () => call(sender, 'POST', body)));
  assert.deepEqual(summary(same), [], 'a repeat of the same send is answered, not refused');
  assert.equal(new Set(same.map((r) => r.body.requestId)).size, 1);
  assert.equal(same.filter((r) => r.statusCode === 201).length, 1, 'exactly one of them created it');
  assert.equal((await db.collection('connection_requests').where('senderId', '==', sender.uid).get()).size, 1);

  const other = await member();
  const bodies = Array.from({ length: 5 }, (_, i) => ({ ...body, idempotencyKey: `idem-different-${i}-0001` }));
  const different = await Promise.all(bodies.map((b) => call(other, 'POST', b)));
  assert.equal(different.filter((r) => r.statusCode === 201).length, 1, 'one request is created');
  assert.ok(different.filter((r) => r.statusCode !== 201).every((r) => r.statusCode === 409 && r.body.error === 'already_pending'), JSON.stringify(summary(different)));
  assert.equal((await db.collection('connection_requests').where('senderId', '==', other.uid).get()).size, 1);
});

test('accepting and withdrawing at the same instant leave one consistent outcome', { skip }, async () => {
  for (let round = 0; round < 5; round += 1) {
    const { db, member, author, ask, act, getRequest, events } = await setup();
    const sender = await member();
    const { body: { requestId } } = await ask(sender);
    const [accepted, withdrawn] = await Promise.all([act(author, 'request-accept', requestId), act(sender, 'request-withdraw', requestId)]);
    assert.ok(accepted.statusCode < 500 && withdrawn.statusCode < 500, `round ${round}: ${accepted.statusCode}/${withdrawn.statusCode}`);
    const final = (await getRequest(requestId)).status;
    const pairs = (await db.collection('signalsPairs').get()).size;
    if (final === 'accepted') {
      assert.equal(pairs, 1);
      assert.equal(accepted.statusCode, 200);
      assert.equal(withdrawn.statusCode, 409);
      assert.deepEqual(await events(requestId), ['accept', 'create']);
    } else {
      assert.equal(final, 'withdrawn');
      assert.equal(pairs, 0, 'a withdrawn request never opens a conversation');
      assert.equal(withdrawn.statusCode, 200);
      assert.equal(accepted.statusCode, 409);
      assert.deepEqual(await events(requestId), ['create', 'withdraw']);
    }
  }
});

// Two instances do not share the in-process queue, so these two tests cover what the transaction and the retry alone give.
// Contention between instances can still outlast the retry budget, so what is guaranteed is safety and recovery, not success:
// no duplicate or half-written data, only "retry-able" refusals, and a plain retry afterwards works.
const calm = (results) => results.every((r) => [200, 201, 409, 503].includes(r.statusCode));

test('two serverless instances answering the same request at once never duplicate anything, and a retry settles it', { skip }, async () => {
  const { db, member, author, ask, act, actSecond, events, inbox } = await setup();
  const sender = await member();
  const { body: { requestId } } = await ask(sender);
  const all = await Promise.all([act(author, 'request-accept', requestId), actSecond(author, 'request-accept', requestId), act(author, 'request-accept', requestId), actSecond(author, 'request-accept', requestId)]);
  console.log('cross-instance accepts:', JSON.stringify(all.map((r) => [r.statusCode, r.body?.error])));
  assert.ok(calm(all), `only success or "busy": ${JSON.stringify(summary(all))}`);
  assert.ok((await db.collection('signalsPairs').get()).size <= 1, 'never a second conversation');
  const retry = await act(author, 'request-accept', requestId);
  assert.equal(retry.statusCode, 200, 'asking again once the contention has passed works');
  assert.equal((await db.collection('signalsPairs').get()).size, 1);
  assert.deepEqual(await events(requestId), ['accept', 'create'], 'one acceptance in the audit trail');
  assert.deepEqual(Object.keys((await inbox(sender)).notifications ?? {}), [requestId], 'one notification');
});

test('thirty creates split across two instances never duplicate or half-write a request', { skip }, async () => {
  const { db, member, author, postId, call, callSecond } = await setup();
  const many = [];
  for (let i = 0; i < 30; i += 1) many.push(await member());
  const results = await Promise.all(many.map((m, i) => (i % 2 ? callSecond : call)(m, 'POST', { action: 'request-create', recipientId: author.uid, lookingForPostId: postId, idempotencyKey: `idem-cross-${i}-00001`, message: 'hi' })));
  const counts = results.reduce((all, r) => ({ ...all, [r.statusCode]: (all[r.statusCode] ?? 0) + 1 }), {});
  console.log('cross-instance creates:', JSON.stringify(counts));
  assert.ok(calm(results), `only success or "busy": ${JSON.stringify(summary(results))}`);
  const stored = (await db.collection('connection_requests').where('recipientId', '==', author.uid).get()).size;
  assert.equal(stored, results.filter((r) => r.statusCode === 201).length, 'every request reported as created exists, and no others');
  const waiting = Object.keys((await db.doc(`signalsInbox/${author.uid}`).get()).data()?.requests ?? {}).length;
  assert.equal(waiting, stored, 'the author\'s list matches the stored requests');
  assert.equal((await db.collection('connection_request_locks').get()).size, stored, 'one lock per request, none stray');
});
