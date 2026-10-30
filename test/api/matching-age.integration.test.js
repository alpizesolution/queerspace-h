// The age range against the real claim flow (Auth + Firestore emulators): a member with a range is never paired outside it,
// whatever order things happen in. Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
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
  const { default: match, pairInTransaction } = await import('../../api/match.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  return { match, pairInTransaction, db: getFirestore(getAdminApp()) };
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

/** A birthday that makes someone exactly `years` old today, plus a few days of margin so the test never straddles midnight. */
const birthFor = (years) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate() - 3));
};

async function seed(db, uid, { years = 30, range, noBirthday = false, queueAgeMs = 0, queue = 'waiting' } = {}) {
  await db.doc(`users/${uid}/private/settings`).set({ ...(noBirthday ? {} : { birthDate: Timestamp.fromDate(birthFor(years)) }), createdAt: new Date(), updatedAt: new Date() });
  await db.doc(`users/${uid}/public/profile`).set({ displayName: `n${uid.slice(0, 5)}`, pronouns: 'she/her', intention: 'open', region: 'x', topics: [], profileComplete: true, updatedAt: new Date() });
  if (range) await db.doc(`matchPrefs/${uid}`).set(range);
  if (queue) await db.doc(`match_queue/${uid}`).set({ status: queue, partnerId: null, convId: null, createdAt: Timestamp.fromMillis(Date.now() - queueAgeMs), heartbeatAt: Timestamp.now(), updatedAt: Timestamp.now(), intent: 'open' });
}

const conversations = async (db) => (await db.collection('conversations').get()).size;

test('a member searching 25-35 is matched with 25, 30 and 35 and never with 19, 24, 36 or someone with no birthday', { skip }, async () => {
  const { match, db } = await load();
  const cases = [[19, false], [24, false], [25, true], [30, true], [35, true], [36, false], ['none', false]];
  for (const [age, shouldMatch] of cases) {
    await db.recursiveDelete(db.collection('match_queue')); await db.recursiveDelete(db.collection('conversations'));
    const me = await newUser(); const other = await newUser();
    await seed(db, other.uid, age === 'none' ? { noBirthday: true } : { years: age });
    await seed(db, me.uid, { years: 30, range: { ageMin: 25, ageMax: 35 } });
    const res = await call(match, me.token, { action: 'claim' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.matched, shouldMatch, `candidate ${age}`);
    assert.equal(await conversations(db), shouldMatch ? 1 : 0, `no conversation may exist for candidate ${age}`);
  }
});

test('the other member holding the range is protected too: a 19-year-old cannot claim a 25-35 member', { skip }, async () => {
  const { match, db } = await load();
  const protectedMember = await newUser(); const young = await newUser();
  await seed(db, protectedMember.uid, { years: 30, range: { ageMin: 25, ageMax: 35 }, queueAgeMs: 20_000 });
  await seed(db, young.uid, { years: 19 }); // no range of their own: Quick Match
  for (let i = 0; i < 3; i++) assert.equal((await call(match, young.token, { action: 'claim' })).body.matched, false);
  assert.equal(await conversations(db), 0);
  assert.equal((await db.doc(`match_queue/${protectedMember.uid}`).get()).data().status, 'waiting', 'the protected member is left waiting');
});

test('a range changed while already in the queue takes effect on the next claim', { skip }, async () => {
  const { match, db } = await load();
  const me = await newUser(); const young = await newUser();
  await seed(db, young.uid, { years: 19, queueAgeMs: 20_000 });
  await seed(db, me.uid, { years: 30 }); // joined with no age filter, nothing stored
  // The app now searches with 25-35 and says so on the claim: the 19-year-old is skipped and the range is stored.
  const res = await call(match, me.token, { action: 'claim', ageMin: 25, ageMax: 35 });
  assert.equal(res.body.matched, false);
  assert.deepEqual((await db.doc(`matchPrefs/${me.uid}`).get()).data().ageMin, 25);
  // A later claim from an app that does not send the range keeps the stored one.
  assert.equal((await call(match, me.token, { action: 'claim' })).body.matched, false);
  // Clearing the filter (null) removes it, and then the same candidate is allowed.
  const cleared = await call(match, me.token, { action: 'claim', ageMin: null, ageMax: null });
  assert.equal(cleared.body.matched, true);
  assert.equal(await conversations(db), 1);
});

test('a malformed range sent with a claim is refused and changes nothing', { skip }, async () => {
  const { match, db } = await load();
  const me = await newUser();
  await seed(db, me.uid, { years: 30, range: { ageMin: 25, ageMax: 35 } });
  for (const bad of [{ ageMin: 40, ageMax: 20 }, { ageMin: 17, ageMax: 30 }, { ageMin: '25', ageMax: 35 }, { ageMin: 25, ageMax: null }, { ageMin: 25.5, ageMax: 35 }]) {
    assert.equal((await call(match, me.token, { action: 'claim', ...bad })).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await db.doc(`matchPrefs/${me.uid}`).get()).data().ageMax, 35);
});

test('a damaged stored range makes a member unmatchable instead of unfiltered', { skip }, async () => {
  const { match, db } = await load();
  const me = await newUser(); const damaged = await newUser();
  await seed(db, damaged.uid, { years: 19, queueAgeMs: 20_000 });
  await db.doc(`matchPrefs/${damaged.uid}`).set({ updatedAt: new Date() }); // exists, but no usable range
  await seed(db, me.uid, { years: 30 });
  assert.equal((await call(match, me.token, { action: 'claim' })).body.matched, false);
  assert.equal((await call(match, damaged.token, { action: 'claim' })).statusCode, 403);
  assert.equal(await conversations(db), 0);
});

test('stale checks cannot create a match: the pairing re-reads ranges, birthdays and blocks at the last moment', { skip }, async () => {
  const { pairInTransaction, db } = await load();
  const a = await newUser(); const b = await newUser();
  await seed(db, a.uid, { years: 30 });
  await seed(db, b.uid, { years: 30 });
  const now = Date.now();
  // Compatible when first looked at...
  const first = await pairInTransaction(db, a.uid, b.uid, now);
  assert.ok(first);
  assert.equal(await conversations(db), 1);

  // ...but if the other side's range changed since (a stale candidate), the pairing is refused and nothing is written.
  for (const change of [
    async (x, y) => db.doc(`matchPrefs/${y.uid}`).set({ ageMin: 40, ageMax: 50 }),
    async (x) => db.doc(`matchPrefs/${x.uid}`).set({ ageMin: 40, ageMax: 50 }),
    // the other side's birthday changed to 19 while this member searches 25-35
    async (x, y) => { await db.doc(`matchPrefs/${x.uid}`).set({ ageMin: 25, ageMax: 35 }); await db.doc(`users/${y.uid}/private/settings`).set({ birthDate: Timestamp.fromDate(birthFor(19)), createdAt: new Date(), updatedAt: new Date() }); },
    async (_x, y) => db.doc(`users/${y.uid}/private/settings`).set({ createdAt: new Date(), updatedAt: new Date() }), // birthday gone
    async (x, y) => db.doc(`users/${y.uid}/private/settings`).set({ birthDate: Timestamp.fromDate(birthFor(30)), blockedPartnerIds: [x.uid], createdAt: new Date(), updatedAt: new Date() }),
    async (_x, y) => db.doc(`suspensions/${y.uid}`).set({ source: 'admin', reason: 'x', createdAt: new Date() }),
  ]) {
    await db.recursiveDelete(db.collection('conversations')); await db.recursiveDelete(db.collection('matchPrefs')); await db.recursiveDelete(db.collection('suspensions'));
    await seed(db, a.uid, { years: 30 });
    await seed(db, b.uid, { years: 30 });
    await change(a, b);
    await assert.rejects(() => pairInTransaction(db, a.uid, b.uid, now), /not_compatible/);
    assert.equal(await conversations(db), 0);
    assert.equal((await db.doc(`match_queue/${a.uid}`).get()).data().status, 'waiting');
    assert.equal((await db.doc(`match_queue/${b.uid}`).get()).data().status, 'waiting');
  }
});

test('concurrent claims: an out-of-range member never wins, and each member is paired at most once', { skip }, async () => {
  const { match, db } = await load();
  const target = await newUser();
  await seed(db, target.uid, { years: 30, range: { ageMin: 25, ageMax: 35 }, queueAgeMs: 30_000 });
  const eligible = []; const tooYoung = []; const tooOld = [];
  for (let i = 0; i < 3; i++) { const u = await newUser(); await seed(db, u.uid, { years: 28 + i }); eligible.push(u); }
  for (let i = 0; i < 3; i++) { const u = await newUser(); await seed(db, u.uid, { years: 19 }); tooYoung.push(u); }
  for (let i = 0; i < 2; i++) { const u = await newUser(); await seed(db, u.uid, { years: 45 }); tooOld.push(u); }
  const results = await Promise.all([...eligible, ...tooYoung, ...tooOld].map((u) => call(match, u.token, { action: 'claim' })));
  const matched = results.filter((r) => r.body?.matched);
  assert.ok(matched.length >= 1, `someone is paired: ${JSON.stringify(results.map((r) => [r.statusCode, r.body]))}`);
  const convs = await db.collection('conversations').get();
  const eligibleIds = new Set(eligible.map((u) => u.uid));
  // Members with no age range may legitimately be paired with each other; the rule is about the protected member.
  const seen = new Set();
  for (const conv of convs.docs) {
    for (const uid of conv.data().participants) {
      assert.ok(!seen.has(uid), 'nobody is paired twice');
      seen.add(uid);
    }
  }
  const targetConvs = convs.docs.filter((c) => c.data().participants.includes(target.uid));
  for (const conv of targetConvs) {
    const other = conv.data().participants.find((p) => p !== target.uid);
    assert.ok(eligibleIds.has(other), 'the protected member is only ever paired with someone aged 25-35');
  }
  assert.ok(targetConvs.length <= 1, 'the protected member is paired at most once');
});
