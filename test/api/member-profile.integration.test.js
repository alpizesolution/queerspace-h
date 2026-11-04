// What a member can see of another member's profile, against the real emulators: only what was shared, nothing when blocked
// or ineligible, the right connection state, and an age only for connected members who chose to show it.
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
  const { default: signals } = await import('../../api/signals.js');
  const { default: ageApi } = await import('../../api/age.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const adult = (years = 30) => Timestamp.fromMillis(Date.now() - years * YEAR);
  const member = async ({ profile = {}, settings = {} } = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: adult(), exactLocation: 'Secret Street 12', ...settings });
    await db.doc(`users/${user.uid}/public/profile`).set({
      displayName: `Member ${user.uid.slice(0, 4)}`, pronouns: 'she/her', avatar: 'cat.1.2', aboutMe: 'Tea and books', myVibe: 'Cozy', personalStyle: 'Vintage',
      intention: 'friends', topics: ['Books', 'Tea'], region: 'Quezon City', profileComplete: true, ...profile,
    });
    return user;
  };
  const run = async (handler, user, query) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await handler({ method: 'GET', headers: { authorization: user ? `Bearer ${user.token}` : '' }, query, url: '/' }, res);
    return res;
  };
  const view = (user, memberId) => run(signals, user, { view: 'profile', memberId });
  const age = (user, memberId) => run(ageApi, user, { view: 'profile-age', memberId });
  const connect = (a, b, status = 'active') => db.doc(`signalsPairs/pair-${a.uid.slice(0, 6)}-${b.uid.slice(0, 6)}`).set({ participants: [a.uid, b.uid].sort(), status, createdAt: Timestamp.now() });
  return { db, Timestamp, adult, member, view, age, connect, run };
}

test('another member\'s profile shows only what they shared, and never a birthday, an age or an exact place', { skip }, async () => {
  const { member, view } = await setup();
  const viewer = await member();
  const other = await member({ profile: { sexualOrientation: 'Lesbian', genderIdentity: 'Woman', genderExpression: ['Femme'], showAgeOnProfile: true } });
  const res = await view(viewer, other.uid);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.self, false);
  const m = res.body.member;
  assert.deepEqual([m.pronouns, m.avatar, m.about, m.vibe, m.style, m.intention, m.location], ['she/her', 'cat.1.2', 'Tea and books', 'Cozy', 'Vintage', 'friends', 'Quezon City']);
  assert.deepEqual(m.interests, ['Books', 'Tea']);
  assert.equal(m.showsAge, true, 'it says an age may be asked for, but does not contain it');
  const json = JSON.stringify(res.body);
  for (const secret of ['birthDate', 'Secret Street', 'exactLocation', 'blockedPartnerIds', '"age"']) assert.equal(json.includes(secret), false, secret);
  assert.deepEqual(Object.keys(m).sort(), ['about', 'avatar', 'displayName', 'expression', 'id', 'identity', 'intention', 'interests', 'location', 'memberSince', 'orientation', 'pronouns', 'showsAge', 'style', 'vibe']);
});

test('location and each identity field follow the member\'s own switches, including older profiles with one switch', { skip }, async () => {
  const { member, view } = await setup();
  const viewer = await member();
  const hidden = await member({ profile: { showLocationOnProfile: false, sexualOrientation: 'Lesbian', genderIdentity: 'Woman', genderExpression: ['Femme'], showSexualOrientationOnProfile: false, showGenderIdentityOnProfile: false, showGenderExpressionOnProfile: false } });
  const m1 = (await view(viewer, hidden.uid)).body.member;
  assert.deepEqual([m1.location, m1.orientation, m1.identity, m1.expression], [null, null, null, []]);
  const some = await member({ profile: { showLocationOnProfile: true, sexualOrientation: 'Lesbian', genderIdentity: 'Woman', showSexualOrientationOnProfile: true, showGenderIdentityOnProfile: false } });
  const m2 = (await view(viewer, some.uid)).body.member;
  assert.deepEqual([m2.location, m2.orientation, m2.identity], ['Quezon City', 'Lesbian', null], 'only the opted-in field');
  const legacy = await member({ profile: { sexualOrientation: 'Bisexual', genderIdentity: 'Nonbinary', showSogieOnProfile: true } });
  const m3 = (await view(viewer, legacy.uid)).body.member;
  assert.deepEqual([m3.orientation, m3.identity], ['Bisexual', 'Nonbinary']);
  const legacyOff = await member({ profile: { sexualOrientation: 'Bisexual', showSogieOnProfile: false } });
  assert.equal((await view(viewer, legacyOff.uid)).body.member.orientation, null);
});

test('missing pieces come back empty, not broken: no bio, no interests, no avatar, odd values trimmed', { skip }, async () => {
  const { member, view } = await setup();
  const viewer = await member();
  const bare = await member({ profile: { aboutMe: '', myVibe: '', personalStyle: '', topics: [], avatar: null } });
  const m = (await view(viewer, bare.uid)).body.member;
  assert.deepEqual([m.about, m.vibe, m.style, m.avatar], [null, null, null, null]);
  assert.deepEqual(m.interests, []);
  const odd = await member({ profile: { aboutMe: 'x'.repeat(400), avatar: 'x'.repeat(40), topics: ['a'.repeat(60), 7, '', '  ok  '] } });
  const o = (await view(viewer, odd.uid)).body.member;
  assert.equal(o.about.length, 160);
  assert.equal(o.avatar, null, 'a malformed avatar is dropped');
  assert.deepEqual(o.interests, ['a'.repeat(24), 'ok']);
});

test('your own profile comes back as yours, and nobody can look up a profile without being an adult member', { skip }, async () => {
  const { db, Timestamp, member, view } = await setup();
  const me = await member();
  const self = await view(me, me.uid);
  assert.equal(self.statusCode, 200);
  assert.equal(self.body.self, true);
  assert.equal(self.body.relation.state, 'self');
  const other = await member();
  const minor = await member({ settings: { birthDate: Timestamp.fromMillis(Date.now() - 16 * YEAR) } });
  assert.equal((await view(minor, other.uid)).statusCode, 403, 'an under-18 viewer');
  const noBirthday = await member();
  await db.doc(`users/${noBirthday.uid}/private/settings`).delete();
  assert.equal((await view(noBirthday, other.uid)).statusCode, 403, 'no birthday on file');
  assert.equal((await view(null, other.uid)).statusCode, 401, 'signed out');
  assert.equal((await view(me, 'bad id')).statusCode, 400);
  await db.doc(`suspensions/${me.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await view(me, other.uid)).statusCode, 403, 'a suspended viewer');
});

test('blocks work in both directions, and a hidden profile is simply not there', { skip }, async () => {
  const { db, Timestamp, member, view, adult } = await setup();
  const viewer = await member();
  const blocksViewer = await member();
  await db.doc(`users/${blocksViewer.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [viewer.uid] });
  const gone = await view(viewer, blocksViewer.uid);
  assert.equal(gone.statusCode, 404, 'a member who blocked you looks like they do not exist');
  assert.equal(gone.body.error, 'profile_unavailable');
  const other = await member();
  await db.doc(`users/${viewer.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [other.uid] });
  const mine = await view(viewer, other.uid);
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.body.blocked, 'by_me');
  assert.equal(mine.body.member, null, 'a member you blocked is not shown');
  await db.doc(`users/${viewer.uid}/private/settings`).set({ birthDate: adult() });
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ source: 'admin', reason: 'test', createdAt: Timestamp.now() });
  assert.equal((await view(viewer, suspended.uid)).statusCode, 404, 'a suspended member');
  const draft = await member({ profile: { profileComplete: false } });
  assert.equal((await view(viewer, draft.uid)).statusCode, 404, 'a profile that was never finished');
  const minor = await member({ settings: { birthDate: Timestamp.fromMillis(Date.now() - 16 * YEAR) } });
  assert.equal((await view(viewer, minor.uid)).statusCode, 404, 'a member who is not an adult');
  assert.equal((await view(viewer, 'nobody-with-this-id')).statusCode, 404);
});

test('the connection state is right for none, request sent, request received, declined and connected, and viewing creates nothing', { skip }, async () => {
  const { db, Timestamp, member, view, connect } = await setup();
  const viewer = await member();
  const other = await member();
  const counts = async () => [(await db.collection('connection_requests').get()).size, (await db.collection('signalsPairs').get()).size, (await db.collection('signalsInvitations').get()).size];
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'none');
  await db.doc(`connection_request_locks/${viewer.uid}_${other.uid}`).set({ state: 'pending', requestId: 'r1' });
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'request_sent');
  await db.doc(`connection_request_locks/${viewer.uid}_${other.uid}`).delete();
  await db.doc(`connection_request_locks/${other.uid}_${viewer.uid}`).set({ state: 'pending', requestId: 'r2' });
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'request_received');
  await db.doc(`connection_request_locks/${other.uid}_${viewer.uid}`).delete();
  await db.doc(`connection_request_locks/${viewer.uid}_${other.uid}`).set({ state: 'cooling', until: Timestamp.fromMillis(Date.now() + 86_400_000) });
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'declined');
  await db.doc(`connection_request_locks/${viewer.uid}_${other.uid}`).set({ state: 'cooling', until: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'none', 'an old decline no longer counts');
  const before = await counts();
  await connect(viewer, other, 'ended');
  assert.equal((await view(viewer, other.uid)).body.relation.state, 'none', 'an ended conversation does not count');
  await db.doc(`signalsPairs/pair-${viewer.uid.slice(0, 6)}-${other.uid.slice(0, 6)}`).update({ status: 'active' });
  const connected = (await view(viewer, other.uid)).body.relation;
  assert.equal(connected.state, 'connected');
  assert.equal(connected.conversationId, `pair-${viewer.uid.slice(0, 6)}-${other.uid.slice(0, 6)}`);
  assert.deepEqual(await counts(), [before[0], before[1] + 1, before[2]], 'looking never creates a request, conversation or invitation (only the pair this test made)');
});

test('an age appears only for a connected member who chose to show it, and never otherwise', { skip }, async () => {
  const { db, member, age, connect, adult } = await setup();
  const viewer = await member();
  const shows = await member({ profile: { showAgeOnProfile: true } });
  assert.deepEqual((await age(viewer, shows.uid)).body, { age: null }, 'a stranger gets no age');
  await connect(viewer, shows);
  const res = await age(viewer, shows.uid);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.age, 30);
  const hides = await member({ profile: { showAgeOnProfile: false } });
  await connect(viewer, hides);
  assert.deepEqual((await age(viewer, hides.uid)).body, { age: null }, 'they did not choose to show it');
  await db.doc(`users/${viewer.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [shows.uid] });
  assert.deepEqual((await age(viewer, shows.uid)).body, { age: null }, 'you blocked them');
  await db.doc(`users/${viewer.uid}/private/settings`).set({ birthDate: adult() });
  await db.doc(`users/${shows.uid}/private/settings`).set({ birthDate: adult(), blockedPartnerIds: [viewer.uid] });
  assert.deepEqual((await age(viewer, shows.uid)).body, { age: null }, 'they blocked you');
  assert.equal((await age(viewer, viewer.uid)).statusCode, 400, 'asking for your own is not a thing');
  assert.equal((await age(viewer, 'bad id')).statusCode, 400);
  assert.equal((await age(null, shows.uid)).statusCode, 401);
});

test('profile lookups are limited per viewer on the server: the 61st in a minute is refused, others and your own page are not', { skip }, async () => {
  const { db, member, view } = await setup();
  const viewer = await member();
  const bystander = await member();
  const other = await member();
  const key = `apiRateLimits/${viewer.uid}_profile-view`;
  // Fill the window directly, as sixty lookups would, so the test does not need sixty round trips.
  await db.doc(key).set({ start: Date.now(), count: 60 });
  const refused = await view(viewer, other.uid);
  assert.equal(refused.statusCode, 429);
  assert.equal(refused.body.error, 'rate_limited');
  assert.equal(JSON.stringify(refused.body).includes('Member'), false, 'a refused lookup reveals nothing about the profile');
  assert.equal((await view(viewer, viewer.uid)).statusCode, 200, 'opening your own profile is never counted');
  assert.equal((await view(bystander, other.uid)).statusCode, 200, 'the limit is per viewer, not shared');
  // A new minute starts a new window.
  await db.doc(key).set({ start: Date.now() - 61_000, count: 60 });
  assert.equal((await view(viewer, other.uid)).statusCode, 200);
  assert.equal((await db.doc(key).get()).data().count, 1);
});

test('normal browsing is well under the limit, and the count only moves for other members\' profiles', { skip }, async () => {
  const { db, member, view } = await setup();
  const viewer = await member();
  const others = [await member(), await member(), await member()];
  for (const other of others) assert.equal((await view(viewer, other.uid)).statusCode, 200);
  await view(viewer, viewer.uid);
  assert.equal((await db.doc(`apiRateLimits/${viewer.uid}_profile-view`).get()).data().count, 3);
});

test('a lookup that fails a check still counts, so probing for ids is limited too', { skip }, async () => {
  const { db, member, view } = await setup();
  const viewer = await member();
  const missing = await view(viewer, 'no-such-member-0001');
  assert.equal(missing.statusCode, 404);
  assert.equal((await db.doc(`apiRateLimits/${viewer.uid}_profile-view`).get()).data().count, 1);
});

test('one viewer opening several profiles at the same instant is answered, not stalled', { skip }, async () => {
  const { member, view } = await setup();
  const viewer = await member();
  const others = [];
  for (let i = 0; i < 10; i += 1) others.push(await member());
  const started = Date.now();
  const results = await Promise.all(others.map((other) => view(viewer, other.uid)));
  const took = Date.now() - started;
  console.log('parallel profile lookups:', JSON.stringify(results.map((r) => r.statusCode)), `${took} ms`);
  assert.deepEqual(results.map((r) => r.statusCode), others.map(() => 200));
  assert.ok(took < 3000, `ten at once took ${took} ms; they used to stall each other for seconds`);
});

test('only known GET views are accepted; an unknown one is refused, and the plain request still works', { skip }, async () => {
  const { member, run } = await setup();
  const viewer = await member();
  const { default: signals } = await import('../../api/signals.js');
  const unknown = await run(signals, viewer, { view: 'profil' });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.error, 'invalid_view');
  const plain = await run(signals, viewer, {});
  assert.equal(plain.statusCode, 200, 'no view still lists invitations, as before');
});

test("member since: the earlier trusted creation date, the same for your own page and a visitor's page, never the last update, and null when unknown", { skip }, async () => {
  const { db, Timestamp, member, view } = await setup();
  const viewer = await member();
  const day = (iso) => Timestamp.fromDate(new Date(iso));
  // A newer account: both records agree. The profile was edited recently, which must not matter.
  const fresh = await member({ settings: { createdAt: day('2026-09-10T08:00:00Z') }, profile: { createdAt: day('2026-09-10T08:00:05Z'), updatedAt: day('2026-11-01T00:00:00Z') } });
  assert.equal((await view(viewer, fresh.uid)).body.member.memberSince, '2026-09-10T08:00:00.000Z', 'the earlier of the two');
  assert.equal((await view(fresh, fresh.uid)).body.member.memberSince, '2026-09-10T08:00:00.000Z', 'your own page says the same');
  // An older account whose public profile was only stamped when it was first edited: the private record has the true start.
  const older = await member({ settings: { createdAt: day('2025-03-02T00:00:00Z') }, profile: { createdAt: day('2026-06-01T00:00:00Z') } });
  assert.equal((await view(viewer, older.uid)).body.member.memberSince, '2025-03-02T00:00:00.000Z');
  // One record missing: the other is used. Both missing, or unreadable or future values: nothing, and the page still loads.
  const onlyProfile = await member({ profile: { createdAt: day('2025-12-24T00:00:00Z') } });
  assert.equal((await view(viewer, onlyProfile.uid)).body.member.memberSince, '2025-12-24T00:00:00.000Z');
  const none = await member();
  assert.equal((await view(viewer, none.uid)).statusCode, 200);
  assert.equal((await view(viewer, none.uid)).body.member.memberSince, null);
  const junk = await member({ settings: { createdAt: 'yesterday' }, profile: { createdAt: Timestamp.fromMillis(Date.now() + 400 * 24 * 3600 * 1000) } });
  assert.equal((await view(viewer, junk.uid)).body.member.memberSince, null);
  assert.equal((await view(junk, junk.uid)).body.member.memberSince, null);
  // Only the date leaves the server: nothing else from the private record.
  const json = JSON.stringify((await view(viewer, older.uid)).body);
  for (const secret of ['birthDate', 'Secret Street', 'exactLocation']) assert.equal(json.includes(secret), false, secret);
});
