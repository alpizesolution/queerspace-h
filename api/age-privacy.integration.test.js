// Emulator tests for trusted matching, the partner-age endpoint, birthday corrections and the migration.
// Run with SIGNALS_INTEGRATION_TESTS=true against the Auth + Firestore emulators (never against production).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

/** Every test starts from an empty Firestore emulator so leftover queue entries never leak between tests. */
async function clearFirestore() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function load() {
  await clearFirestore();
  const { default: match } = await import('./match.js');
  const { default: age } = await import('./age.js');
  const { getAdminApp, ageFromDate, parseBirthDate } = await import('./_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { migrateAgePrivacy } = await import('../scripts/migrate-age-privacy.mjs');
  return { match, age, db: getFirestore(getAdminApp()), ageFromDate, parseBirthDate, migrateAgePrivacy };
}

function response() {
  return { statusCode: 200, headers: {}, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(n, v) { this.headers[n] = v; } };
}

async function call(handler, { method = 'POST', body, query, token } = {}) {
  const res = response();
  await handler({ method, body, query, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const data = await r.json();
  return { uid: data.localId, token: data.idToken };
}

async function newGoogleAdmin(db) {
  const idp = { sub: `g${Date.now()}${Math.floor(Math.random() * 1e6)}`, email: 'admin@example.com', email_verified: true };
  const r = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(JSON.stringify(idp))}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }),
  });
  const data = await r.json();
  await db.doc(`admins/${data.localId}`).set({ createdAt: new Date() });
  return { uid: data.localId, token: data.idToken };
}

const birth = (yearsAgo, extraDays = 0) => {
  const d = new Date(Date.now() - (yearsAgo * 365.25 + extraDays) * 86400000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const iso = (d) => d.toISOString().slice(0, 10);

async function seedMember(db, uid, { years = 30, profileComplete = true, showAge, range, blocked, queue = 'waiting', queueAgeMs = 0, noBirthday = false } = {}) {
  await db.doc(`users/${uid}/private/settings`).set({
    ...(noBirthday ? {} : { birthDate: Timestamp.fromDate(birth(years)) }),
    ...(blocked ? { blockedPartnerIds: blocked } : {}), createdAt: new Date(), updatedAt: new Date(),
  });
  await db.doc(`users/${uid}/public/profile`).set({ displayName: `n${uid.slice(0, 5)}`, pronouns: 'she/her', intention: 'open', region: 'x', topics: [], profileComplete, ...(showAge !== undefined ? { showAgeOnProfile: showAge } : {}), updatedAt: new Date() });
  if (range) await db.doc(`matchPrefs/${uid}`).set(range);
  if (queue) await db.doc(`match_queue/${uid}`).set({ status: queue, partnerId: null, convId: null, createdAt: Timestamp.fromMillis(Date.now() - queueAgeMs), heartbeatAt: Timestamp.now(), updatedAt: Timestamp.now(), intent: 'open' });
}

test('API rejects unauthenticated requests and wrong methods', { skip }, async () => {
  const { match, age } = await load();
  assert.equal((await call(match, { body: { action: 'claim' } })).statusCode, 401);
  assert.equal((await call(age, { method: 'GET', query: { view: 'partner-age', convId: 'abcdefgh1' } })).statusCode, 401);
  assert.equal((await call(match, { method: 'GET' })).statusCode, 405);
});

test('private age range: validated, stored server-side only, rate limited', { skip }, async () => {
  const { match, db } = await load();
  const u = await newUser();
  assert.equal((await call(match, { token: u.token, body: { action: 'prefs', ageMin: 30, ageMax: 20 } })).statusCode, 400);
  assert.equal((await call(match, { token: u.token, body: { action: 'prefs', ageMin: 17, ageMax: 30 } })).statusCode, 400);
  const ok = await call(match, { token: u.token, body: { action: 'prefs', ageMin: 22, ageMax: 35 } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.equal((await db.doc(`matchPrefs/${u.uid}`).get()).data().ageMin, 22);
  assert.equal((await call(match, { token: u.token, body: { action: 'prefs', ageMin: null, ageMax: null } })).statusCode, 200);
  assert.equal((await db.doc(`matchPrefs/${u.uid}`).get()).exists, false);
  let limited = false;
  for (let i = 0; i < 35 && !limited; i++) limited = (await call(match, { token: u.token, body: { action: 'prefs', ageMin: 20, ageMax: 30 } })).statusCode === 429;
  assert.equal(limited, true, 'excessive requests are rate limited');
});

test('claim: ineligible accounts are refused; compatible partners are matched using private ages only', { skip }, async () => {
  const { match, db } = await load();
  const nobirthday = await newUser();
  await seedMember(db, nobirthday.uid, { noBirthday: true });
  assert.equal((await call(match, { token: nobirthday.token, body: { action: 'claim' } })).statusCode, 403);
  const incomplete = await newUser();
  await seedMember(db, incomplete.uid, { profileComplete: false });
  assert.equal((await call(match, { token: incomplete.token, body: { action: 'claim' } })).statusCode, 403);

  const me = await newUser(); const fits = await newUser(); const tooOld = await newUser();
  await seedMember(db, tooOld.uid, { years: 45, queueAgeMs: 30_000 });
  await seedMember(db, fits.uid, { years: 28, queueAgeMs: 20_000 });
  await seedMember(db, me.uid, { years: 25, range: { ageMin: 20, ageMax: 32 }, queueAgeMs: 10_000 });
  const res = await call(match, { token: me.token, body: { action: 'claim' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['convId', 'matched', 'partnerId'], 'only the minimum is returned');
  assert.equal(res.body.partnerId, fits.uid);
  assert.equal(JSON.stringify(res.body).match(/age/i), null);
  const conv = await db.doc(`conversations/${res.body.convId}`).get();
  assert.deepEqual(conv.data().participants, [me.uid, fits.uid].sort());
  assert.equal((await db.doc(`match_queue/${fits.uid}`).get()).data().status, 'matched');
  assert.equal((await db.doc(`match_queue/${tooOld.uid}`).get()).data().status, 'waiting', 'out-of-range member untouched');
});

test('claim: their private range must fit me too; blocks and suspensions are respected', { skip }, async () => {
  const { match, db } = await load();
  const me = await newUser(); const picky = await newUser(); const blocker = await newUser(); const suspended = await newUser();
  await seedMember(db, picky.uid, { years: 40, range: { ageMin: 18, ageMax: 30 }, queueAgeMs: 40_000 });
  await seedMember(db, blocker.uid, { years: 27, blocked: [me.uid], queueAgeMs: 30_000 });
  await seedMember(db, suspended.uid, { years: 27, queueAgeMs: 20_000 });
  await db.doc(`suspensions/${suspended.uid}`).set({ source: 'admin', reason: 'x', createdAt: new Date() });
  await seedMember(db, me.uid, { years: 38, queueAgeMs: 10_000 });
  const res = await call(match, { token: me.token, body: { action: 'claim' } });
  assert.equal(res.body.matched, false);
  for (const other of [picky, blocker, suspended]) assert.equal((await db.doc(`match_queue/${other.uid}`).get()).data().status, 'waiting');
});

test('claim: concurrent requests can never claim the same member twice', { skip }, async () => {
  const { match, db } = await load();
  const target = await newUser(); const a = await newUser(); const b = await newUser(); const c = await newUser();
  await seedMember(db, target.uid, { years: 30, queueAgeMs: 50_000 });
  for (const [i, u] of [a, b, c].entries()) await seedMember(db, u.uid, { years: 30, queueAgeMs: 40_000 - i * 5_000 });
  const results = await Promise.all([a, b, c].map((u) => call(match, { token: u.token, body: { action: 'claim' } })));
  for (const r of results) assert.equal(r.statusCode, 200);
  const convs = await db.collection('conversations').where('participants', 'array-contains', target.uid).get();
  assert.equal(convs.size, 1, 'the target is in exactly one conversation');
  // Nobody ends up in two conversations.
  for (const u of [a, b, c, target]) {
    const mine = await db.collection('conversations').where('participants', 'array-contains', u.uid).get();
    assert.ok(mine.size <= 1, `${u.uid} is in at most one conversation`);
  }
});

test('partner age: only for a participant, only when the partner opted in, always freshly calculated', { skip }, async () => {
  const { age, db, ageFromDate, parseBirthDate } = await load();
  const p = await newUser(); const q = await newUser(); const outsider = await newUser();
  await seedMember(db, p.uid, { years: 31, showAge: true, queue: null });
  await seedMember(db, q.uid, { years: 27, queue: null });
  await seedMember(db, outsider.uid, { queue: null });
  await db.doc('conversations/ageconv0001').set({ participants: [p.uid, q.uid].sort(), status: 'active', createdAt: new Date(), updatedAt: new Date() });
  const ask = (u, convId = 'ageconv0001') => call(age, { method: 'GET', token: u.token, query: { view: 'partner-age', convId } });

  const hidden = await ask(p); // p asks about q, who never turned it on
  assert.deepEqual(hidden.body, { age: null });
  const shown = await ask(q); // q asks about p, who opted in
  const stored = (await db.doc(`users/${p.uid}/private/settings`).get()).data().birthDate.toDate();
  assert.deepEqual(shown.body, { age: ageFromDate(stored) });
  assert.equal(JSON.stringify(shown.body).includes('-'), false, 'no birthday in the response');
  assert.equal((await ask(outsider)).statusCode, 403);
  assert.equal((await ask(q, 'bad id!')).statusCode, 400);
  // Turning the switch off removes the age immediately.
  await db.doc(`users/${p.uid}/public/profile`).update({ showAgeOnProfile: false });
  assert.deepEqual((await ask(q)).body, { age: null });
  assert.ok(parseBirthDate('2000-01-01'));
});

test('birthday corrections: request, under-18 restriction, admin review, audit without birthdays', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const member = await newUser(); const minor = await newUser(); const fresh = await newUser();
  await seedMember(db, member.uid, { years: 30, queue: null });
  await seedMember(db, minor.uid, { years: 30, queue: null });
  await seedMember(db, fresh.uid, { noBirthday: true, queue: null });
  const request = (u, requestedBirthDate, reason = 'typo') => call(age, { token: u.token, body: { action: 'request-correction', requestedBirthDate, reason } });
  const decide = (u, requestId, decision) => call(age, { token: u.token, body: { action: 'decide-correction', requestId, decision } });

  assert.equal((await request(fresh, iso(birth(30)))).statusCode, 409, 'no birthday yet: use the age gate');
  assert.equal((await request(member, 'not-a-date')).statusCode, 400);

  // Under 18: rejected, account restricted pending review, no birthday kept.
  const under = await request(minor, iso(birth(15)));
  assert.equal(under.body.status, 'restricted');
  assert.equal((await db.doc(`suspensions/${minor.uid}`).get()).exists, true);
  const minorRequest = (await db.doc(`birthdayCorrections/${minor.uid}`).get()).data();
  assert.equal(minorRequest.status, 'restricted');
  assert.equal('requestedBirthDate' in minorRequest, false);

  // Adult request: pending; a second one is refused.
  const requested = iso(birth(41));
  assert.equal((await request(member, requested)).body.status, 'pending');
  assert.equal((await request(member, requested)).statusCode, 409);
  assert.deepEqual((await call(age, { method: 'GET', token: member.token, query: { view: 'my-correction' } })).body, { status: 'pending' });

  // Only a Google admin with an admins/{uid} document can list or decide.
  assert.equal((await call(age, { method: 'GET', token: member.token, query: { view: 'corrections' } })).statusCode, 403);
  assert.equal((await decide(member, member.uid, 'approve')).statusCode, 403);
  const listed = await call(age, { method: 'GET', token: admin.token, query: { view: 'corrections' } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.requests.find((r) => r.id === member.uid).requestedBirthDate, requested);

  // Reject: birthday unchanged, requested date removed.
  const before = (await db.doc(`users/${member.uid}/private/settings`).get()).data().birthDate.toMillis();
  assert.equal((await decide(admin, member.uid, 'reject')).body.status, 'rejected');
  assert.equal((await db.doc(`users/${member.uid}/private/settings`).get()).data().birthDate.toMillis(), before);
  assert.equal('requestedBirthDate' in (await db.doc(`birthdayCorrections/${member.uid}`).get()).data(), false);
  assert.equal((await decide(admin, member.uid, 'approve')).statusCode, 409, 'already decided');

  assert.equal((await request(member, requested)).body.status, 'pending');
  const approved = await decide(admin, member.uid, 'approve');
  assert.equal(approved.body.status, 'approved', JSON.stringify(approved));
  assert.equal(iso((await db.doc(`users/${member.uid}/private/settings`).get()).data().birthDate.toDate()), requested);
  assert.equal('requestedBirthDate' in (await db.doc(`birthdayCorrections/${member.uid}`).get()).data(), false);

  // An approval can never make someone under 18, even if a pending request was tampered with.
  await db.doc(`birthdayCorrections/${fresh.uid}`).set({ uid: fresh.uid, status: 'pending', requestedBirthDate: iso(birth(12)), createdAt: new Date() });
  assert.equal((await decide(admin, fresh.uid, 'approve')).body.status, 'restricted');
  assert.equal((await db.doc(`suspensions/${fresh.uid}`).get()).exists, true);
  assert.equal((await db.doc(`users/${fresh.uid}/private/settings`).get()).data().birthDate, undefined);

  // The audit trail records decisions but never a birthday.
  const audit = await db.collection('ageAudit').get();
  assert.ok(audit.size >= 5);
  for (const entry of audit.docs) assert.equal(/\d{4}-\d{2}-\d{2}/.test(JSON.stringify({ ...entry.data(), at: undefined })), false);
  assert.ok(audit.docs.some((d) => d.data().decision === 'approved' && d.data().adminUid === admin.uid));
});

test('migration: removes only age fields, never documents, and is idempotent', { skip }, async () => {
  const { db, migrateAgePrivacy } = await load();
  const tag = `mig${Date.now()}`;
  await db.doc(`users/${tag}a/public/profile`).set({ displayName: 'A', age: 31, showAgeOnProfile: true, aboutMe: 'hello', topics: ['x'] });
  await db.doc(`users/${tag}b/public/profile`).set({ displayName: 'B', aboutMe: 'no age here' });
  await db.doc(`users/${tag}a/private/settings`).set({ birthDate: Timestamp.fromDate(birth(31)), age: 99 }); // private docs are out of scope
  await db.doc(`match_queue/${tag}q`).set({ status: 'waiting', intent: 'open', topics: ['books'], age: 27, ageMin: 20, ageMax: 30 });
  await db.doc(`match_queue/${tag}r`).set({ status: 'waiting', intent: 'dating' });

  const dry = await migrateAgePrivacy(db, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.profiles.changed >= 1 && dry.queue.changed >= 1);
  assert.equal((await db.doc(`users/${tag}a/public/profile`).get()).data().age, 31, 'dry run writes nothing');

  const first = await migrateAgePrivacy(db);
  assert.ok(first.profiles.changed >= 1 && first.queue.changed >= 1);
  const profile = (await db.doc(`users/${tag}a/public/profile`).get()).data();
  assert.deepEqual(profile, { displayName: 'A', showAgeOnProfile: true, aboutMe: 'hello', topics: ['x'] });
  assert.deepEqual((await db.doc(`match_queue/${tag}q`).get()).data(), { status: 'waiting', intent: 'open', topics: ['books'] });
  assert.deepEqual((await db.doc(`users/${tag}b/public/profile`).get()).data(), { displayName: 'B', aboutMe: 'no age here' });
  assert.equal((await db.doc(`match_queue/${tag}r`).get()).data().intent, 'dating');
  assert.equal((await db.doc(`users/${tag}a/private/settings`).get()).data().age, 99, 'private settings are not touched');

  const second = await migrateAgePrivacy(db);
  assert.equal(second.profiles.changed, 0);
  assert.equal(second.queue.changed, 0);
});
