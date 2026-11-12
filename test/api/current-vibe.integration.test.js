// Current Vibe (the custom status) against the real emulators: saving and the 24-hour expiry decided on the server, one record per
// member, who can see it (everyone, approved connections, nobody), blocks and suspensions, and that no client can read or change it
// directly. A status is one emoji and up to 60 characters of the member's own words.
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
  const save = (user, body) => call(user, 'POST', { action: 'vibe-set', ...body });
  const clear = (user) => call(user, 'POST', { action: 'vibe-clear' });
  const see = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'vibe', memberId });
  const profile = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'profile', memberId });
  const stored = async (user) => (await db.doc(`currentVibes/${user.uid}`).get()).data();
  const connect = (a, b) => db.doc(`signalsPairs/pair-${a.uid.slice(0, 6)}-${b.uid.slice(0, 6)}`).set({ participants: [a.uid, b.uid].sort(), status: 'active', createdAt: Timestamp.now() });
  const expire = (user, ms = -1000) => db.doc(`currentVibes/${user.uid}`).update({ expiresAt: Timestamp.fromMillis(Date.now() + ms) });
  return { db, Timestamp, vibes, member, call, save, clear, see, profile, stored, connect, expire };
}

test('saving keeps one record with server-made times, and the answer is the status as written', { skip }, async () => {
  const { member, save, stored } = await setup();
  const me = await member();
  const before = Date.now();
  const res = await save(me, { emoji: '🌙', message: 'taking it slow', visibility: 'everyone' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.vibe.emoji, res.body.vibe.message, res.body.vibe.visibility], ['🌙', 'taking it slow', 'everyone']);
  const doc = await stored(me);
  assert.equal(doc.expiresAt.toMillis() - doc.updatedAt.toMillis(), DAY, 'expires exactly 24 hours after saving');
  assert.ok(doc.updatedAt.toMillis() >= before && doc.updatedAt.toMillis() <= Date.now(), 'the time is the server clock, now');
  assert.equal(doc.createdAt.toMillis(), doc.updatedAt.toMillis());
  assert.deepEqual(Object.keys(doc).sort(), ['createdAt', 'emoji', 'expiresAt', 'message', 'updatedAt', 'visibility'], 'no mood fields, nothing else');
});

test('any single emoji works, including ones with a variation mark, a flag, a joined sequence or a keycap', { skip }, async () => {
  const { member, save, see } = await setup();
  const me = await member(); const other = await member();
  for (const emoji of ['☕', '🦋', '☁️', '😵‍💫', '🇵🇭', '1️⃣', '🏳️‍🌈', '🫠', '❤️', '👩🏽‍❤️‍👩🏻']) {
    const res = await save(me, { emoji, message: 'hi' });
    assert.equal(res.statusCode, 200, emoji);
    assert.equal((await see(other, me.uid)).body.vibe.emoji, emoji, emoji);
  }
});

test('anything that is not exactly one emoji is refused: words, two emoji, an emoji with text, controls, numbers, lists', { skip }, async () => {
  const { member, save, stored } = await setup();
  const me = await member();
  for (const emoji of ['a', 'ab', '😊😊', '😊 ', 'hi😊', '1', '12', '<b>', '😊\n', '‍', 7, ['😊'], { e: '😊' }, true]) {
    assert.equal((await save(me, { emoji, message: 'hi' })).statusCode, 400, JSON.stringify(emoji));
  }
  assert.equal(await stored(me), undefined, 'nothing was stored');
});

test('the message is the member\'s own words: optional when there is an emoji, tidied, at most 60 characters (an emoji counts as one), one line', { skip }, async () => {
  const { member, save } = await setup();
  const me = await member();
  assert.equal((await save(me, { emoji: '🌙' })).body.vibe.message, null, 'an emoji alone');
  assert.equal((await save(me, { emoji: '🌙', message: '' })).body.vibe.message, null);
  assert.equal((await save(me, { message: 'need coffee' })).body.vibe.emoji, '', 'words alone');
  assert.equal((await save(me, { emoji: '🌙', message: '  lots   of   space  ' })).body.vibe.message, 'lots of space');
  assert.equal((await save(me, { emoji: '🌙', message: 'x'.repeat(60) })).statusCode, 200);
  assert.equal((await save(me, { emoji: '🌙', message: '🌱'.repeat(60) })).statusCode, 200, '60 emoji are 60 characters');
  assert.equal((await save(me, { emoji: '🌙', message: 'x'.repeat(61) })).statusCode, 400);
  assert.equal((await save(me, { emoji: '🌙', message: '🌱'.repeat(61) })).statusCode, 400);
  for (const bad of ['two\nlines', 'tab\there', 'bell\u0007', 'sep\u2028arator', 42, ['a'], {}]) assert.equal((await save(me, { emoji: '🌙', message: bad })).statusCode, 400, JSON.stringify(bad));
});

test('a status needs an emoji or some words: empty, blank and nothing are refused', { skip }, async () => {
  const { member, save, stored } = await setup();
  const me = await member();
  for (const body of [{}, { emoji: '' }, { message: '   ' }, { emoji: '', message: '' }, { emoji: null, message: null }]) {
    assert.equal((await save(me, body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(await stored(me), undefined);
});

test('extra fields are refused, so nobody can store another shape: the old mood field, a label, an expiry, another member', { skip }, async () => {
  const { member, save, stored } = await setup();
  const me = await member();
  for (const extra of [{ moodId: 'happy' }, { label: 'Hacked' }, { expiresAt: Date.now() + 99 * DAY }, { createdAt: 1 }, { memberId: 'someone-else-1234' }, { uid: 'x' }, { visibility: 'friends' }, { visibility: 7 }]) {
    assert.equal((await save(me, { emoji: '🌙', ...extra })).statusCode, 400, JSON.stringify(extra));
  }
  assert.equal(await stored(me), undefined);
});

test('one record per member: saving again replaces it and starts the 24 hours again; the first start time is kept while it is live', { skip }, async () => {
  const { member, save, stored, db, Timestamp } = await setup();
  const me = await member();
  await save(me, { emoji: '😔', message: 'first' });
  const first = await stored(me);
  const back = (ms) => Timestamp.fromMillis(ms - 20 * 3600_000);
  await db.doc(`currentVibes/${me.uid}`).update({ createdAt: back(first.createdAt.toMillis()), updatedAt: back(first.updatedAt.toMillis()), expiresAt: back(first.expiresAt.toMillis()) });
  const aged = await stored(me);
  const res = await save(me, { emoji: '💜', message: 'second' });
  const second = await stored(me);
  assert.equal(res.body.vibe.emoji, '💜');
  assert.equal(second.message, 'second');
  assert.equal(second.expiresAt.toMillis() - second.updatedAt.toMillis(), DAY);
  assert.ok(second.expiresAt.toMillis() > aged.expiresAt.toMillis() + 19 * 3600_000, 'the expiry moved out again');
  assert.equal(second.createdAt.toMillis(), aged.createdAt.toMillis(), 'still the same run, so the first start is kept');
  assert.equal((await db.collection('currentVibes').get()).docs.filter((d) => d.id === me.uid).length, 1, 'one record');
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  const old = await stored(me);
  await save(me, { emoji: '😊' });
  assert.ok((await stored(me)).createdAt.toMillis() > old.createdAt.toMillis(), 'after it expired, a new status starts afresh');
});

test('a record saved in the old mood shape still reads (as its emoji with its message or mood name) and is fully replaced by the next save', { skip }, async () => {
  const { member, save, see, stored, db, Timestamp } = await setup();
  const me = await member(); const other = await member();
  const now = Date.now();
  await db.doc(`currentVibes/${me.uid}`).set({ moodId: 'healing', emoji: '🌱', label: 'Healing', message: '', visibility: 'everyone', createdAt: Timestamp.fromMillis(now - 1000), updatedAt: Timestamp.fromMillis(now - 1000), expiresAt: Timestamp.fromMillis(now + 3600_000) });
  const seen = (await see(other, me.uid)).body.vibe;
  assert.deepEqual([seen.emoji, seen.message], ['🌱', 'Healing']);
  await db.doc(`currentVibes/${me.uid}`).update({ message: 'x'.repeat(100) });
  assert.equal((await see(other, me.uid)).body.vibe.message.length, 60, 'an old long message is cut to the new limit');
  await save(me, { emoji: '🌙', message: 'new' });
  assert.deepEqual(Object.keys(await stored(me)).sort(), ['createdAt', 'emoji', 'expiresAt', 'message', 'updatedAt', 'visibility'], 'no moodId or label left behind');
});

test('clearing deletes the record at once, and clearing again is harmless', { skip }, async () => {
  const { member, save, clear, stored, see } = await setup();
  const me = await member(); const other = await member();
  await save(me, { emoji: '🥰', message: 'feeling loved' });
  assert.equal((await see(other, me.uid)).body.vibe.message, 'feeling loved');
  assert.equal((await clear(me)).statusCode, 200);
  assert.equal(await stored(me), undefined);
  assert.equal((await see(other, me.uid)).body.vibe, null);
  assert.equal((await clear(me)).statusCode, 200);
});

test('clearing or expiring a status leaves the member\'s profile and everything else untouched', { skip }, async () => {
  const { member, save, clear, expire, profile, db } = await setup();
  const me = await member(); const other = await member();
  const before = (await db.doc(`users/${me.uid}/public/profile`).get()).data();
  await save(me, { emoji: '🌙', message: 'hi' });
  await expire(me);
  await clear(me);
  assert.deepEqual((await db.doc(`users/${me.uid}/public/profile`).get()).data(), before, 'the profile document is exactly as it was');
  const res = await profile(other, me.uid);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.member.displayName, before.displayName);
  assert.equal(res.body.currentVibe, null);
});

test('an expired status is gone everywhere the moment its time passes, with no cleanup: profile, the indicator view and the owner too', { skip }, async () => {
  const { member, save, expire, see, profile, stored } = await setup();
  const me = await member(); const other = await member();
  await save(me, { emoji: '🌙', message: 'still here' });
  assert.equal((await profile(other, me.uid)).body.currentVibe.message, 'still here');
  await expire(me, +60_000);
  assert.equal((await see(other, me.uid)).body.vibe.message, 'still here', 'a minute left: still shown');
  await expire(me, -1);
  for (const res of [await profile(other, me.uid), await profile(me, me.uid)]) assert.equal(res.body.currentVibe, null, 'profile');
  for (const res of [await see(other, me.uid), await see(me, me.uid)]) assert.equal(res.body.vibe, null, 'indicator');
  assert.ok(await stored(me), 'the expired record is still there (cleanup is separate), yet is never returned');
});

test('a record with no usable expiry, no emoji and no words, or a bad emoji is never shown as a full status', { skip }, async () => {
  const { member, save, see, db } = await setup();
  const me = await member(); const other = await member();
  await save(me, { emoji: '🌙', message: 'hi' });
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: 'tomorrow' });
  assert.equal((await see(other, me.uid)).body.vibe, null);
  await db.doc(`currentVibes/${me.uid}`).update({ expiresAt: null });
  assert.equal((await see(other, me.uid)).body.vibe, null);
  await save(me, { emoji: '🌙', message: 'hi' });
  await db.doc(`currentVibes/${me.uid}`).update({ emoji: '', message: '' });
  assert.equal((await see(other, me.uid)).body.vibe, null);
  await db.doc(`currentVibes/${me.uid}`).update({ emoji: 'not an emoji', message: 'words stay' });
  const shown = (await see(other, me.uid)).body.vibe;
  assert.deepEqual([shown.emoji, shown.message], ['', 'words stay'], 'a bad emoji is dropped, never shown');
});

test('visibility: everyone who can view the profile, approved connections only, or nobody', { skip }, async () => {
  const { member, save, see, profile, connect } = await setup();
  const me = await member(); const stranger = await member(); const friend = await member();
  await connect(me, friend);
  await save(me, { emoji: '😌', message: 'peaceful', visibility: 'everyone' });
  assert.equal((await see(stranger, me.uid)).body.vibe.message, 'peaceful');
  assert.equal((await profile(stranger, me.uid)).body.currentVibe.message, 'peaceful');
  await save(me, { emoji: '😌', message: 'peaceful', visibility: 'connections' });
  assert.equal((await see(stranger, me.uid)).body.vibe, null, 'a stranger does not see it');
  assert.equal((await profile(stranger, me.uid)).body.currentVibe, null);
  assert.equal((await see(friend, me.uid)).body.vibe.message, 'peaceful', 'an approved connection does');
  assert.equal((await profile(friend, me.uid)).body.currentVibe.message, 'peaceful');
  await save(me, { emoji: '😌', message: 'peaceful', visibility: 'nobody' });
  for (const viewer of [stranger, friend]) {
    assert.equal((await see(viewer, me.uid)).body.vibe, null);
    assert.equal((await profile(viewer, me.uid)).body.currentVibe, null);
  }
  assert.equal((await see(me, me.uid)).body.vibe.visibility, 'nobody', 'the owner always sees their own, with the setting that governs it');
  assert.equal((await profile(me, me.uid)).body.currentVibe.visibility, 'nobody');
});

test('an ended connection no longer counts as an approved connection', { skip }, async () => {
  const { member, save, see, db } = await setup();
  const me = await member(); const friend = await member();
  const ref = db.doc(`signalsPairs/p-${me.uid.slice(0, 5)}-${friend.uid.slice(0, 5)}`);
  await ref.set({ participants: [me.uid, friend.uid].sort(), status: 'active' });
  await save(me, { emoji: '😊', message: 'hi', visibility: 'connections' });
  assert.equal((await see(friend, me.uid)).body.vibe.message, 'hi');
  await ref.update({ status: 'ended' });
  assert.equal((await see(friend, me.uid)).body.vibe, null);
});

test('what others get is only the emoji, the words and the two times: never the setting, the start time or anything private', { skip }, async () => {
  const { member, save, see, profile } = await setup();
  const me = await member(); const other = await member();
  await save(me, { emoji: '🦋', message: 'hi', visibility: 'everyone' });
  for (const res of [await see(other, me.uid), await profile(other, me.uid)]) {
    const vibe = res.body.vibe ?? res.body.currentVibe;
    assert.deepEqual(Object.keys(vibe).sort(), ['emoji', 'expiresAt', 'message', 'updatedAt']);
  }
});

test('blocks in either direction hide it, and so does a suspended or not-set-up member; the answer is the same "nothing" every time', { skip }, async () => {
  const { member, save, see, profile, db } = await setup();
  const me = await member(); const viewer = await member();
  await save(me, { emoji: '😊', message: 'hi' });
  assert.equal((await see(viewer, me.uid)).body.vibe.message, 'hi');
  await db.doc(`users/${me.uid}/private/settings`).update({ blockedPartnerIds: [viewer.uid] });
  assert.deepEqual((await see(viewer, me.uid)).body, { vibe: null });
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
  assert.equal((await see(viewer, me.uid)).body.vibe.message, 'hi', 'and it comes back when none of that applies');
});

test('who may use it: adults with a finished profile who are not suspended; signed-out and underage callers are refused', { skip }, async () => {
  const { member, save, see, db, call, Timestamp } = await setup();
  const me = await member(); const minor = await member();
  await db.doc(`users/${minor.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 10 * YEAR) });
  assert.equal((await save(minor, { emoji: '😊' })).statusCode, 403);
  assert.equal((await see(minor, me.uid)).statusCode, 403, 'an underage viewer sees nothing');
  const unfinished = await member({ profile: { profileComplete: false } });
  assert.equal((await save(unfinished, { emoji: '😊' })).statusCode, 403);
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ reason: 'test' });
  assert.equal((await save(suspended, { emoji: '😊' })).statusCode, 403);
  assert.equal((await see(suspended, me.uid)).statusCode, 403);
  assert.equal((await save(null, { emoji: '😊' })).statusCode, 401);
  assert.equal((await see(null, me.uid)).statusCode, 401);
  assert.equal((await call({ token: 'nope' }, 'POST', { action: 'vibe-set', emoji: '😊' })).statusCode, 401);
  assert.equal((await see(me, 'x')).statusCode, 400);
});

test('only the owner can save or clear their own: the member is the one in the signed-in token, never a field in the request', { skip }, async () => {
  const { member, save, clear, stored } = await setup();
  const a = await member(); const b = await member();
  await save(a, { emoji: '😊', message: 'a-status' });
  assert.equal((await save(b, { emoji: '😔', memberId: a.uid })).statusCode, 400);
  assert.equal((await save(b, { emoji: '😔', uid: a.uid })).statusCode, 400);
  await save(b, { emoji: '😔', message: 'b-status' });
  await clear(b);
  assert.equal((await stored(a)).message, 'a-status', 'b changed and removed only their own');
});

test('saving is rate limited', { skip }, async () => {
  const { member, save, vibes } = await setup();
  const me = await member();
  let last;
  for (let i = 0; i <= vibes.VIBE_PUBLISHES_PER_HOUR; i++) last = await save(me, { emoji: '😊' });
  assert.equal(last.statusCode, 429);
});

test('a profile carries the status only in the shape the screen expects, and a member with none has null', { skip }, async () => {
  const { member, profile } = await setup();
  const me = await member(); const other = await member();
  const res = await profile(other, me.uid);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.currentVibe, null);
  assert.equal((await profile(me, me.uid)).body.currentVibe, null);
});
