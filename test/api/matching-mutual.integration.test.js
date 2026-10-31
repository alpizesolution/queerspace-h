// Mutual age compatibility through the real claim flow (Auth + Firestore emulators): a match exists only when each person's
// age is inside the other's range. Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function load() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: match } = await import('../../api/match.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  return { match, db: getFirestore(getAdminApp()) };
}

async function call(handler, token, body) {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await handler({ method: 'POST', body, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

/** A birthday that makes someone exactly `years` old, with a margin of days so a test never straddles midnight. */
const birthFor = (years) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate() - 3));
};

async function seed(db, user, { age, min, max, queueAgeMs = 0 }) {
  await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: Timestamp.fromDate(birthFor(age)), createdAt: new Date(), updatedAt: new Date() });
  await db.doc(`users/${user.uid}/public/profile`).set({ displayName: `n${user.uid.slice(0, 5)}`, pronouns: 'she/her', intention: 'open', region: 'x', topics: [], profileComplete: true, updatedAt: new Date() });
  if (min !== undefined) await db.doc(`matchPrefs/${user.uid}`).set({ ageMin: min, ageMax: max });
  await db.doc(`match_queue/${user.uid}`).set({ status: 'waiting', partnerId: null, convId: null, createdAt: Timestamp.fromMillis(Date.now() - queueAgeMs), heartbeatAt: Timestamp.now(), updatedAt: Timestamp.now(), intent: 'open' });
  user.age = age; user.range = min === undefined ? null : { min, max };
}

const fits = (age, range) => !range || (age >= range.min && age <= range.max);
const mutual = (a, b) => fits(b.age, a.range) && fits(a.age, b.range);

const scenarios = [
  // [A age, A range, B age, B range, expected]
  [30, [25, 35], 19, [18, 25], false],
  [30, [25, 35], 27, [25, 35], true],
  [30, [25, 35], 24, [18, 25], false],
  [28, [25, 35], 32, [25, 40], true],
  [22, [18, 25], 30, [25, 35], false],
  // one-sided fits, and the exact edges of each range
  [30, [25, 35], 27, [18, 25], false], // B is inside A's range but A (30) is outside B's
  [30, [18, 25], 32, [25, 40], false], // A is outside B's range... and B (32) is outside A's
  [30, [25, 35], 25, [30, 30], true], // B is exactly at A's lower edge, A is exactly B's only age
  [30, [25, 35], 35, [30, 40], true], // B at A's upper edge; A at B's lower edge
  [30, [25, 35], 36, [30, 40], false], // B one year over A's upper edge
  [30, [25, 35], 25, [31, 40], false], // A one year under B's lower edge
  [30, [25, 35], 24, [30, 30], false], // B one year under A's lower edge
];

for (const [ageA, ra, ageB, rb, expected] of scenarios) {
  test(`A ${ageA} (${ra.join('-')}) with B ${ageB} (${rb.join('-')}) is ${expected ? 'allowed' : 'rejected'}, whoever claims`, { skip }, async () => {
    for (const claimer of ['A', 'B']) {
      const { match, db } = await load();
      const a = await newUser(); const b = await newUser();
      await seed(db, a, { age: ageA, min: ra[0], max: ra[1], queueAgeMs: claimer === 'B' ? 20_000 : 0 });
      await seed(db, b, { age: ageB, min: rb[0], max: rb[1], queueAgeMs: claimer === 'A' ? 20_000 : 0 });
      const res = await call(match, (claimer === 'A' ? a : b).token, { action: 'claim' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.matched, expected, `${claimer} claiming`);
      const convs = await db.collection('conversations').get();
      assert.equal(convs.size, expected ? 1 : 0, `${claimer} claiming: a rejected pair must never have a conversation`);
      if (!expected) {
        assert.equal((await db.doc(`match_queue/${a.uid}`).get()).data().status, 'waiting');
        assert.equal((await db.doc(`match_queue/${b.uid}`).get()).data().status, 'waiting');
      }
    }
  });
}

test('stale queue entries do not bypass a range: the range in force at the moment of pairing is the one that counts', { skip }, async () => {
  const { match, db } = await load();
  const a = await newUser(); const b = await newUser();
  await seed(db, a, { age: 30, min: 18, max: 99, queueAgeMs: 20_000 });
  await seed(db, b, { age: 19, min: 18, max: 99 });
  // A's queue entry was made when A accepted anyone; A now only wants 25-35 and the app says so on the claim.
  const res = await call(match, b.token, { action: 'claim' });
  assert.equal(res.body.matched, true, 'with both ranges open they can match');
  await db.recursiveDelete(db.collection('conversations'));
  await seed(db, a, { age: 30, min: 18, max: 99, queueAgeMs: 20_000 });
  await seed(db, b, { age: 19, min: 18, max: 99 });
  await db.doc(`matchPrefs/${a.uid}`).set({ ageMin: 25, ageMax: 35 }); // A narrows the range after joining
  assert.equal((await call(match, b.token, { action: 'claim' })).body.matched, false);
  assert.equal((await db.collection('conversations').get()).size, 0);
});

test('client manipulation cannot widen the other person\'s range: only your own preference is yours to set', { skip }, async () => {
  const { match, db } = await load();
  const protectedMember = await newUser(); const young = await newUser();
  await seed(db, protectedMember, { age: 30, min: 25, max: 35, queueAgeMs: 20_000 });
  await seed(db, young, { age: 19 });
  // The 19-year-old claims claiming any range they like for themselves, even a lie about everything else.
  for (const body of [{ ageMin: 18, ageMax: 99 }, { ageMin: null, ageMax: null }, { ageMin: 18, ageMax: 99, age: 30, birthDate: '1996-01-01', partnerRange: [18, 99] }, { excludeIds: [], uid: protectedMember.uid }]) {
    assert.equal((await call(match, young.token, { action: 'claim', ...body })).body.matched, false, JSON.stringify(body));
  }
  assert.equal((await db.collection('conversations').get()).size, 0);
  assert.equal((await db.doc(`matchPrefs/${protectedMember.uid}`).get()).data().ageMin, 25, "their range was never touched");
});

test('concurrent claims: every conversation created is mutually compatible, and nobody is paired twice', { skip }, async () => {
  const { match, db } = await load();
  const target = await newUser();
  await seed(db, target, { age: 30, min: 25, max: 35, queueAgeMs: 60_000 });
  const crowd = [
    [27, [25, 35]], [32, [25, 40]], [29, [26, 34]], // fit both ways
    [24, [18, 25]], // inside neither
    [19, [18, 25]], // far outside
    [36, [25, 40]], // over the target's upper edge
    [31, [35, 40]], // inside the target's range but the target is outside theirs
    [33, [18, 29]], // same, the other way round
    [28, undefined], [40, undefined], [19, undefined], // no range of their own
  ];
  const users = [target];
  for (const [age, range] of crowd) {
    const u = await newUser();
    await seed(db, u, { age, min: range?.[0], max: range?.[1] });
    users.push(u);
  }
  const claimers = users.slice(1);
  await Promise.all([...claimers, ...claimers].map((u) => call(match, u.token, { action: 'claim' })));

  const byId = new Map(users.map((u) => [u.uid, u]));
  const seen = new Set();
  const convs = await db.collection('conversations').get();
  for (const conv of convs.docs) {
    const [x, y] = conv.data().participants.map((id) => byId.get(id));
    assert.ok(x && y, 'only known members');
    assert.ok(mutual(x, y), `${x.age} (${JSON.stringify(x.range)}) with ${y.age} (${JSON.stringify(y.range)}) must be mutually compatible`);
    for (const m of [x, y]) {
      assert.ok(!seen.has(m.uid), 'nobody is paired twice');
      seen.add(m.uid);
    }
  }
  assert.ok(convs.size >= 1, 'some compatible pairs were made');
});
