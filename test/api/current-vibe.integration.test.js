// Current Vibe against the real emulators: publishing and the 24-hour expiry decided on the server, one record per member, who can
// see it (everyone, approved connections, nobody), blocks and suspensions, and that no client can read or change it directly.
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
const YEAR = 365.25 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: signals } = await import('../../api/signals.js');
  const vibes = await import('../../api/_vibe.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const member = async ({ profile = {}, settings = {} } = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 30 * YEAR), ...settings });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: `Member ${user.uid.slice(0, 4)}`, pronouns: 'she/her', intention: 'friends', topics: [], region: 'Manila', profileComplete: true, ...profile });
    return user;
  };
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await signals({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {}, url: '/' }, res);
    return res;
  };
  const publish = (user, body) => call(user, 'POST', { action: 'vibe-set', ...body });
  const clear = (user) => call(user, 'POST', { action: 'vibe-clear' });
  const see = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'vibe', memberId });
  const profile = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'profile', memberId });
  const stored = async (user) => (await db.doc(`currentVibes/${user.uid}`).get()).data();
  const connect = (a, b) => db.doc(`signalsPairs/pair-${a.uid.slice(0, 6)}-${b.uid.slice(0, 6)}`).set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  const expire = (user, ms = -1000) => db.doc(`currentVibes/${user.uid}`).update({ expiresAt: Timestamp.fromMillis(Date.now() + ms) });
  return { db, Timestamp, vibes, member, call, publish, clear, see, profile, stored, connect, expire };
}

test('publishing saves one record with server-made times, and the answer shows the mood from the list', { skip }, async () => {
  const { member, publish, stored } = await setup();
  const me = await member();
  const before = Date.now();
  const res = await publish(me, { moodId: 'healing', message: 'Taking life one day at a time.', visibility: 'everyone' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.vibe.moodId, res.body.vibe.emoji, res.body.vibe.label, res.body.vibe.message, res.body.vibe.visibility], ['healing', '🌱', 'Healing', 'Taking life one day at a time.', 'everyone']);
  const doc = await stored(me);
  assert.equal(doc.moodId, 'healing');
  assert.equal(doc.emoji, '🌱');
  assert.equal(doc.label, 'Healing');
  assert.equal(doc.expiresAt.toMillis() - doc.updatedAt.toMillis(), DAY, 'expires exactly 24 hours after publishing');
  assert.ok(doc.updatedAt.toMillis() >= before && doc.updatedAt.toMillis() <= Date.now(), 'the time is the server\'s, now');
  assert.equal(doc.createdAt.toMillis(), doc.updatedAt.toMillis());
  assert.deepEqual(Object.keys(doc).sort(), ['createdAt', 'emoji', 'expiresAt', 'label', 'message', 'moodId', 'updatedAt', 'visibility']);
});

test('every one of the fourteen moods can be published, with its own emoji and name', { skip }, async () => {
  const { member, publish, vibes } = await setup();
  const me = await member();
  assert.equal(vibes.VIBE_MOODS.length, 14);
  for (const mood of vibes.VIBE_MOODS) {
    const res = await publish(me, { moodId: mood.id });
    assert.equal(res.statusCode, 200, mood.id);
    assert.deepEqual([res.body.vibe.emoji, res.body.vibe.label, res.body.vibe.message], [mood.emoji, mood.label, null], 'no message is needed');
  }
});

test('a mood alone is enough, and the message rules: optional, tidied, 100 characters (an emoji counts as one), no line breaks', { skip }, async () => {
  const { member, publish, stored } = await setup();
  const me = await member();
  assert.equal((await publish(me, { moodId: 'happy' })).statusCode, 200);
  assert.equal((await publish(me, { moodId: 'happy', message: '' })).body.vibe.message, null);
  assert.equal((await publish(me, { moodId: 'happy', message: '   ' })).body.vibe.message, null);
  assert.equal((await publish(me, { moodId: 'happy', message: '  lots   of   space  ' })).body.vibe.message, 'lots of space');
  assert.equal((await publish(me, { moodId: 'happy', message: 'x'.repeat(100) })).statusCode, 200);
  assert.equal((await publish(me, { moodId: 'happy', message: '🌱'.repeat(100) })).statusCode, 200, '100 emoji are 100 characters');
  assert.equal((await publish(me, { moodId: 'happy', message: 'x'.repeat(101) })).statusCode, 400);
  assert.equal((await publish(me, { moodId: 'happy', message: '🌱'.repeat(101) })).statusCode, 400);
  for (const bad of ['two\nlines', 'tab\there', 'bell\u0007', 'sep arator', 42, ['a'], {}]) assert.equal((await publish(me, { moodId: 'happy', message: bad })).statusCode, 400, JSON.stringify(bad));
  assert.equal((await stored(me)).message.length > 0, true, 'a refused publish never replaced the stored one');
});

test('a mood that is not on the list, extra fields and a made-up emoji or name are refused, and nothing is stored', { skip }, async () => {
  const { member, publish, stored } = await setup();
  const me = await member();
  for (const body of [{}, { moodId: 'angry' }, { moodId: 'HAPPY' }, { moodId: 7 }, { moodId: null }, { moodId: 'happy', emoji: '💀' }, { moodId: 'happy', label: 'Hacked' }, { moodId: 'happy', expiresAt: Date.now() + 99 * DAY },
    { moodId: 'happy', memberId: 'someone-else-1234' }, { moodId: 'happy', visibility: 'friends' }, { moodId: 'happy', visibility: 7 }]) {
    assert.equal((await publish(me, body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(await stored(me), undefined);
});

test('one record per member: publishing again replaces it and starts the 24 hours again; the first start time is kept while it is live', { skip }, async () => {
  const { member, publish, stored, db, Timestamp } = await setup();
  const me = await member();
  await publish(me, { moodId: 'sad', message: 'first' });
  const first = await stored(me);
  // Pretend it was published 20 hours ago.
  await db.doc(`currentVibes/${me.uid}`).update({ createdAt: Timestamp.fromMillis(first.createdAt.toMillis() - 20 * 3600_000), updatedAt: Timestamp.fromMillis(first.updatedAt.toMillis() - 20 * 3600_000), expiresAt: Timestamp.fromMillis(first.expiresAt.toMillis() - 20 * 3600_000) });
  const aged = await stored(me);
  const res = await publish(me, { moodId: 'grateful', message: 'second' });
  const second = await stored(me);
  assert.equal(res.body.vibe.label, 'Grateful');
  assert.equal(second.message, 'second');
  assert.equal(second.expiresAt.toMillis() - second.updatedAt.toMillis(), DAY);
  assert.ok(second.expiresAt.toMillis() > aged.expiresAt.toMillis() + 19 * 3600_000, 'the expiry moved out again');
  assert.equal(second.createdAt.toMillis(), aged.createdAt.toMillis(), 'still the same run, so the first start is kept');
  assert.equal((await db.collection('currentVibes').get()).docs.filter((d) => d.id === me.uid).length, 1, 'one record');
  // After it has expired, a new publish starts afresh.
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  const old = await stored(me);
  await publish(me, { moodId: 'happy' });
  assert.ok((await stored(me)).createdAt.toMillis() > old.createdAt.toMillis());
});

test('removing it deletes the record at once, and removing it again is harmless', { skip }, async () => {
  const { member, publish, clear, stored, see } = await setup();
  const me = await member(); const other = await member();
  await publish(me, { moodId: 'loved' });
  assert.equal((await see(other, me.uid)).body.vibe.label, 'Loved');
  assert.equal((await clear(me)).statusCode, 200);
  assert.equal(await stored(me), undefined);
  assert.equal((await see(other, me.uid)).body.vibe, null);
  assert.equal((await clear(me)).statusCode, 200);
});

test('an expired vibe is gone everywhere the moment its time passes, with no cleanup: profile, the indicator view and the owner too', { skip }, async () => {
  const { member, publish, expire, see, profile, stored } = await setup();
  const me = await member(); const other = await member();
  await publish(me, { moodId: 'dreamy', message: 'still here' });
  assert.equal((await profile(other, me.uid)).body.currentVibe.label, 'Dreamy');
  await expire(me, +60_000);
  assert.equal((await see(other, me.uid)).body.vibe.label, 'Dreamy', 'a minute left: still shown');
  await expire(me, -1);
  for (const res of [await profile(other, me.uid), await profile(me, me.uid)]) assert.equal(res.body.currentVibe, null, 'profile');
  for (const res of [await see(other, me.uid), await see(me, me.uid)]) assert.equal(res.body.vibe, null, 'indicator');
  assert.ok(await stored(me), 'the expired record is still there (cleanup is separate), yet is never returned');
});

test('a record with no usable expiry or an unknown mood is never shown', { skip }, async () => {
  const { member, publish, see, db } = await setup();
  const me = await member(); const other = await member();
  await publish(me, { moodId: 'happy' });
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: 'tomorrow' });
  assert.equal((await see(other, me.uid)).body.vibe, null);
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: null });
  assert.equal((await see(other, me.uid)).body.vibe, null);
  await publish(me, { moodId: 'happy' });
  await db.doc(`currentVibes/${me.uid}`).update({ moodId: 'invented' });
  assert.equal((await see(other, me.uid)).body.vibe, null);
});

test('visibility: everyone who can view the profile, approved connections only, or nobody', { skip }, async () => {
  const { member, publish, see, profile, connect } = await setup();
  const me = await member(); const stranger = await member(); const friend = await member();
  await connect(me, friend);
  await publish(me, { moodId: 'peaceful', visibility: 'everyone' });
  assert.equal((await see(stranger, me.uid)).body.vibe.label, 'Peaceful');
  assert.equal((await profile(stranger, me.uid)).body.currentVibe.label, 'Peaceful');
  await publish(me, { moodId: 'peaceful', visibility: 'connections' });
  assert.equal((await see(stranger, me.uid)).body.vibe, null, 'a stranger does not see it');
  assert.equal((await profile(stranger, me.uid)).body.currentVibe, null);
  assert.equal((await see(friend, me.uid)).body.vibe.label, 'Peaceful', 'an approved connection does');
  assert.equal((await profile(friend, me.uid)).body.currentVibe.label, 'Peaceful');
  await publish(me, { moodId: 'peaceful', visibility: 'nobody' });
  for (const viewer of [stranger, friend]) {
    assert.equal((await see(viewer, me.uid)).body.vibe, null);
    assert.equal((await profile(viewer, me.uid)).body.currentVibe, null);
  }
  // The owner always sees their own, with the setting that governs it.
  assert.equal((await see(me, me.uid)).body.vibe.visibility, 'nobody');
  assert.equal((await profile(me, me.uid)).body.currentVibe.visibility, 'nobody');
});

test('an ended connection no longer counts as an approved connection', { skip }, async () => {
  const { member, publish, see, db } = await setup();
  const me = await member(); const friend = await member();
  const ref = db.doc(`signalsPairs/p-${me.uid.slice(0, 5)}-${friend.uid.slice(0, 5)}`);
  await ref.set({ participants: [me.uid, friend.uid].sort(), status: 'active' });
  await publish(me, { moodId: 'happy', visibility: 'connections' });
  assert.equal((await see(friend, me.uid)).body.vibe.label, 'Happy');
  await ref.update({ status: 'ended' });
  assert.equal((await see(friend, me.uid)).body.vibe, null);
});

test('what others get never includes the setting or any other private detail', { skip }, async () => {
  const { member, publish, see, profile } = await setup();
  const me = await member(); const other = await member();
  await publish(me, { moodId: 'excited', message: 'hi', visibility: 'everyone' });
  for (const res of [await see(other, me.uid), await profile(other, me.uid)]) {
    const vibe = res.body.vibe ?? res.body.currentVibe;
    assert.deepEqual(Object.keys(vibe).sort(), ['emoji', 'expiresAt', 'label', 'message', 'moodId', 'updatedAt']);
  }
});

test('blocks in either direction hide it, and so does a suspended or not-set-up member; the answer is the same "nothing" every time', { skip }, async () => {
  const { member, publish, see, profile, db } = await setup();
  const me = await member(); const viewer = await member();
  await publish(me, { moodId: 'happy' });
  assert.equal((await see(viewer, me.uid)).body.vibe.label, 'Happy');
  await db.doc(`users/${me.uid}/private/settings`).update({ blockedPartnerIds: [viewer.uid] });
  const theyBlockedMe = await see(viewer, me.uid);
  assert.deepEqual(theyBlockedMe.body, { vibe: null });
  await db.doc(`users/${me.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`users/${viewer.uid}/private/settings`).update({ blockedPartnerIds: [me.uid] });
  assert.deepEqual((await see(viewer, me.uid)).body, { vibe: null });
  assert.equal((await profile(viewer, me.uid)).body.blocked, 'by_me');
  await db.doc(`users/${viewer.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${me.uid}`).set({ reason: 'test' });
  assert.deepEqual((await see(viewer, me.uid)).body, { vibe: null });
  await db.doc(`suspensions/${me.uid}`).delete();
  await db.doc(`users/${me.uid}/public/profile`).update({ profileComplete: false });
  assert.deepEqual((await see(viewer, me.uid)).body, { vibe: null });
  await db.doc(`users/${me.uid}/public/profile`).update({ profileComplete: true });
  assert.equal((await see(viewer, me.uid)).body.vibe.label, 'Happy', 'and it comes back when none of that applies');
});

test('who may use it: adults with a finished profile who are not suspended; signed-out and underage callers are refused', { skip }, async () => {
  const { member, publish, see, db, call, Timestamp } = await setup();
  const me = await member(); const minor = await member();
  await db.doc(`users/${minor.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 10 * YEAR) });
  assert.equal((await publish(minor, { moodId: 'happy' })).statusCode, 403);
  assert.equal((await see(minor, me.uid)).statusCode, 403, 'an underage viewer sees nothing');
  const unfinished = await member({ profile: { profileComplete: false } });
  assert.equal((await publish(unfinished, { moodId: 'happy' })).statusCode, 403);
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ reason: 'test' });
  assert.equal((await publish(suspended, { moodId: 'happy' })).statusCode, 403);
  assert.equal((await see(suspended, me.uid)).statusCode, 403);
  assert.equal((await publish(null, { moodId: 'happy' })).statusCode, 401);
  assert.equal((await see(null, me.uid)).statusCode, 401);
  assert.equal((await call({ token: 'nope' }, 'POST', { action: 'vibe-set', moodId: 'happy' })).statusCode, 401);
  assert.equal((await see(me, 'x')).statusCode, 400);
});

test('only the owner can publish or remove their own: the member is the one in the signed-in token, never a field in the request', { skip }, async () => {
  const { member, publish, clear, stored } = await setup();
  const a = await member(); const b = await member();
  await publish(a, { moodId: 'happy', message: 'a\'s' });
  assert.equal((await publish(b, { moodId: 'sad', memberId: a.uid })).statusCode, 400);
  assert.equal((await publish(b, { moodId: 'sad', uid: a.uid })).statusCode, 400);
  await publish(b, { moodId: 'sad', message: 'b\'s' });
  await clear(b);
  const mine = await stored(a);
  assert.equal(mine.message, 'a\'s', 'b changed and removed only their own');
});

test('publishing is rate limited', { skip }, async () => {
  const { member, publish, vibes } = await setup();
  const me = await member();
  let last;
  for (let i = 0; i <= vibes.VIBE_PUBLISHES_PER_HOUR; i++) last = await publish(me, { moodId: 'happy' });
  assert.equal(last.statusCode, 429);
});

test('a profile carries the vibe only in the shape the screen expects, and a member with none has null', { skip }, async () => {
  const { member, profile } = await setup();
  const me = await member(); const other = await member();
  const res = await profile(other, me.uid);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.currentVibe, null);
  assert.equal((await profile(me, me.uid)).body.currentVibe, null);
});
