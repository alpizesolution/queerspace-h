// Emulator tests for the age review improvements: under-18 attempts, legacy members, correction limits and history,
// admin decisions, member notices and privacy. Run with SIGNALS_INTEGRATION_TESTS=true against the emulators only.
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
  const { default: age } = await import('../../api/age.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const review = await import('../../api/_ageReview.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  return { age, db: getFirestore(getAdminApp()), review };
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
const DATE = /\d{4}-\d{2}-\d{2}/;

async function seedAdult(db, uid, years = 30) {
  await db.doc(`users/${uid}/private/settings`).set({ birthDate: Timestamp.fromDate(birth(years)), blockedPartnerIds: [], createdAt: new Date(), updatedAt: new Date() });
}
const settingsOf = async (db, uid) => (await db.doc(`users/${uid}/private/settings`).get()).data();

test('under-18 attempt: stored privately, never becomes the birthday, validated, limited', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const member = await newUser();
  const attempt = (u, birthDate) => call(age, { token: u.token, body: { action: 'submit-underage-attempt', birthDate } });

  assert.equal((await call(age, { body: { action: 'submit-underage-attempt', birthDate: iso(birth(15)) } })).statusCode, 401);
  assert.equal((await attempt(member, 'nope')).statusCode, 400);
  assert.equal((await attempt(member, iso(new Date(Date.now() + 86400000 * 30)))).statusCode, 400, 'future date');
  assert.equal((await attempt(member, '2010-02-30')).statusCode, 400, 'impossible date');
  assert.equal((await attempt(member, iso(birth(30)))).statusCode, 400, 'adults use the normal birthday save');

  const typed = iso(birth(15));
  assert.equal((await attempt(member, typed)).statusCode, 201);
  assert.equal((await db.doc(`ageAttempts/${member.uid}`).get()).data().attemptedBirthDate, typed);
  assert.equal((await db.doc(`users/${member.uid}/private/settings`).get()).exists, false, 'never written as the birthday');

  // Admin sees it; a member does not.
  const state = await call(age, { method: 'GET', token: admin.token, query: { view: 'review-state', ids: member.uid } });
  assert.equal(state.body.members[member.uid].state, 'under18-attempt');
  assert.equal(state.body.members[member.uid].attempt.birthDate, typed);
  assert.equal(state.body.members[member.uid].approvedBirthDate, null);
  assert.equal((await call(age, { method: 'GET', token: member.token, query: { view: 'review-state', ids: member.uid } })).statusCode, 403);

  // The member's notice and the audit trail carry no date.
  const thread = (await db.doc(`support_threads/${member.uid}`).get()).data();
  assert.equal(thread.lastFrom, 'team');
  const messages = await db.collection(`support_threads/${member.uid}/messages`).get();
  assert.equal(messages.size, 1);
  assert.equal(DATE.test(messages.docs[0].data().text) || DATE.test(thread.lastMessage), false);
  for (const entry of (await db.collection('ageAudit').get()).docs) assert.equal(DATE.test(JSON.stringify({ ...entry.data(), at: undefined })), false);

  // A member who already has a birthday on file is not sent here.
  const adult = await newUser();
  await seedAdult(db, adult.uid);
  assert.equal((await attempt(adult, typed)).statusCode, 409);

  // Excessive attempts are rate limited.
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = (await attempt(member, typed)).statusCode === 429;
  assert.equal(limited, true);
});

test('legacy member without a birthday: submits for review, never approved automatically, approval keeps the original', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const legacy = await newUser();
  await db.collection('reports').doc('old-report').set({ reporterId: legacy.uid, targetId: legacy.uid, targetType: 'user', reason: 'Age eligibility review requested by member after birthday entry. Please review the member’s access eligibility.', timestamp: new Date() });

  const before = await call(age, { method: 'GET', token: admin.token, query: { view: 'review-state', ids: legacy.uid } });
  assert.equal(before.body.members[legacy.uid].state, 'legacy');
  assert.equal(before.body.members[legacy.uid].approvedBirthDate, null);

  const requested = iso(birth(27));
  const sent = await call(age, { token: legacy.token, body: { action: 'request-correction', requestedBirthDate: requested, reason: '' } });
  assert.equal(sent.statusCode, 201);
  assert.equal((await db.doc(`users/${legacy.uid}/private/settings`).get()).exists, false, 'not approved automatically');
  const pending = await call(age, { method: 'GET', token: admin.token, query: { view: 'review-state', ids: legacy.uid } });
  assert.equal(pending.body.members[legacy.uid].state, 'correction-pending');
  assert.equal(pending.body.members[legacy.uid].correction.kind, 'initial');

  const approved = await call(age, { token: admin.token, body: { action: 'decide-correction', requestId: legacy.uid, decision: 'approve' } });
  assert.equal(approved.body.status, 'approved');
  const settings = await settingsOf(db, legacy.uid);
  assert.equal(iso(settings.birthDate.toDate()), requested);
  assert.ok(settings.createdAt, 'the settings document is complete, so the member can keep editing it');
  const record = (await db.doc(`ageRecords/${legacy.uid}`).get()).data();
  assert.equal(record.originalBirthDate, requested);
  assert.equal(record.correctionCount, 0, 'the first recorded birthday is not a correction');
  assert.equal((await db.doc('reports/old-report').get()).exists, true, 'the existing report is untouched');
});

test('under-18 correction request from a legacy member is restricted, kept for review and never saved', { skip }, async () => {
  const { age, db } = await load();
  const legacy = await newUser();
  const res = await call(age, { token: legacy.token, body: { action: 'request-correction', requestedBirthDate: iso(birth(14)), reason: 'x' } });
  assert.equal(res.body.status, 'restricted');
  assert.equal((await db.doc(`ageAttempts/${legacy.uid}`).get()).data().attemptedBirthDate, iso(birth(14)));
  assert.equal((await db.doc(`users/${legacy.uid}/private/settings`).get()).exists, false);
});

test('limits: one open request, 2 approved corrections, rejections do not count, repeated rejections flag manual review', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const member = await newUser();
  await seedAdult(db, member.uid, 30);
  const original = iso((await settingsOf(db, member.uid)).birthDate.toDate());
  const clearRate = () => db.doc(`apiRateLimits/${member.uid}_age-correction`).delete();
  // The per-day request limit has its own test; here it is reset so the allowance and review rules are what is being tested.
  const request = async (date, reason = 'typo') => { await clearRate(); return call(age, { token: member.token, body: { action: 'request-correction', requestedBirthDate: date, reason } }); };
  const decide = (decision, reason) => call(age, { token: admin.token, body: { action: 'decide-correction', requestId: member.uid, decision, ...(reason ? { reason } : {}) } });

  assert.equal((await request(iso(birth(31)), '')).statusCode, 400, 'a reason is required when there is a birthday');
  assert.equal((await request(iso(birth(31)))).statusCode, 201);
  assert.equal((await request(iso(birth(32)))).statusCode, 409, 'one open request at a time');

  // Asking for information keeps it open (still one at a time), needs a reason.
  assert.equal((await decide('request-info')).statusCode, 400);
  assert.equal((await decide('request-info', 'Please tell us more')).body.status, 'info-requested');
  assert.equal((await request(iso(birth(32)))).statusCode, 409);

  // Two rejections do not use the allowance but flag the member.
  assert.equal((await decide('reject')).statusCode, 400, 'a reason is required to reject');
  assert.equal((await decide('reject', 'Cannot confirm')).body.status, 'rejected');
  assert.equal(iso((await settingsOf(db, member.uid)).birthDate.toDate()), original, 'rejection keeps the approved birthday');
  assert.equal((await request(iso(birth(31)))).statusCode, 201);
  await decide('reject', 'Still cannot confirm');
  const record = (await db.doc(`ageRecords/${member.uid}`).get()).data();
  assert.equal(record.rejectedCount, 2);
  assert.equal(record.manualReview, true);
  assert.equal(record.correctionCount ?? 0, 0, 'rejections do not consume the allowance');
  const flagged = await request(iso(birth(31)));
  assert.equal(flagged.statusCode, 201);
  const view = await call(age, { method: 'GET', token: admin.token, query: { view: 'review-state', ids: member.uid } });
  assert.ok(view.body.members[member.uid].correction.flags.includes('repeated-rejections'));

  // First approved correction preserves the original and the previous birthday.
  const first = iso(birth(31));
  assert.equal((await decide('approve')).body.status, 'approved');
  assert.equal(iso((await settingsOf(db, member.uid)).birthDate.toDate()), first);
  await clearRate();
  const second = iso(birth(33));
  assert.equal((await request(second)).statusCode, 201);
  assert.equal((await decide('approve')).body.status, 'approved');
  const afterTwo = (await db.doc(`ageRecords/${member.uid}`).get()).data();
  assert.equal(afterTwo.originalBirthDate, original);
  assert.deepEqual(afterTwo.previousBirthDates.map((p) => p.birthDate), [original, first]);
  assert.equal(afterTwo.correctionCount, 2);
  assert.ok(afterTwo.previousBirthDates.every((p) => p.decidedBy === admin.uid));

  // The lifetime allowance is used up.
  await clearRate();
  assert.equal((await request(iso(birth(34)))).statusCode, 403);
});

test('decisions notify the member without birthdays, and only admins can decide, list, view or purge', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const member = await newUser(); const other = await newUser();
  await seedAdult(db, member.uid);
  const requested = iso(birth(36));
  await call(age, { token: member.token, body: { action: 'request-correction', requestedBirthDate: requested, reason: 'typo' } });

  const post = (u, body) => call(age, { token: u.token, body });
  for (const u of [member, other]) {
    assert.equal((await post(u, { action: 'decide-correction', requestId: member.uid, decision: 'approve' })).statusCode, 403);
    assert.equal((await post(u, { action: 'purge-age-records' })).statusCode, 403);
    assert.equal((await call(age, { method: 'GET', token: u.token, query: { view: 'corrections' } })).statusCode, 403);
  }
  assert.equal((await db.doc(`birthdayCorrections/${member.uid}`).get()).data().status, 'pending');

  await post(admin, { action: 'decide-correction', requestId: member.uid, decision: 'reject', reason: `Not convincing, ${requested}` });
  const texts = (await db.collection(`support_threads/${member.uid}/messages`).orderBy('timestamp').get()).docs.map((d) => d.data().text);
  assert.equal(texts.length, 2, 'submitted, then rejected');
  for (const t of texts) assert.equal(DATE.test(t), false, 'dates are removed from notices');
  assert.match(texts[1], /not approved/i);
  assert.equal(DATE.test((await db.doc(`support_threads/${member.uid}`).get()).data().lastMessage), false);
  const decided = (await db.doc(`birthdayCorrections/${member.uid}`).get()).data();
  assert.equal(decided.decidedBy, admin.uid);
  assert.ok(decided.decidedAt);
  assert.equal('requestedBirthDate' in decided, false);
});

test('retention: a dry run only counts; the purge removes old attempts and decided requests but never open ones', { skip }, async () => {
  const { age, db } = await load();
  const admin = await newGoogleAdmin(db);
  const old = Timestamp.fromMillis(Date.now() - 200 * 86400000);
  await db.doc('ageAttempts/oldmember1').set({ uid: 'oldmember1', attemptedBirthDate: '2012-01-01', updatedAt: old });
  await db.doc('ageAttempts/newmember1').set({ uid: 'newmember1', attemptedBirthDate: '2012-01-01', updatedAt: Timestamp.now() });
  await db.doc('birthdayCorrections/oldrejected').set({ uid: 'oldrejected', status: 'rejected', decidedAt: old });
  await db.doc('birthdayCorrections/oldopen1111').set({ uid: 'oldopen1111', status: 'pending', createdAt: old });

  const dry = await call(age, { token: admin.token, body: { action: 'purge-age-records' } });
  assert.deepEqual([dry.body.dryRun, dry.body.attempts, dry.body.requests], [true, 1, 1]);
  assert.equal((await db.doc('ageAttempts/oldmember1').get()).exists, true);
  const done = await call(age, { token: admin.token, body: { action: 'purge-age-records', dryRun: false } });
  assert.equal(done.body.attempts, 1);
  assert.equal((await db.doc('ageAttempts/oldmember1').get()).exists, false);
  assert.equal((await db.doc('ageAttempts/newmember1').get()).exists, true);
  assert.equal((await db.doc('birthdayCorrections/oldrejected').get()).exists, false);
  assert.equal((await db.doc('birthdayCorrections/oldopen1111').get()).exists, true);
});
