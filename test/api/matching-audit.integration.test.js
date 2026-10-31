// Every match leaves a server-only note of what the age check had to go on: whether each side had a range, never ages or
// birthdays. Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
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
const birthFor = (years) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate() - 3)); };
async function seed(db, user, { age, range, queueAgeMs = 0 }) {
  await db.doc(`users/${user.uid}/private/settings`).set({ birthDate: Timestamp.fromDate(birthFor(age)), createdAt: new Date(), updatedAt: new Date() });
  await db.doc(`users/${user.uid}/public/profile`).set({ displayName: 'n', pronouns: 'she/her', intention: 'open', region: 'x', topics: [], profileComplete: true, updatedAt: new Date() });
  if (range) await db.doc(`matchPrefs/${user.uid}`).set({ ageMin: range[0], ageMax: range[1] });
  await db.doc(`match_queue/${user.uid}`).set({ status: 'waiting', partnerId: null, convId: null, createdAt: Timestamp.fromMillis(Date.now() - queueAgeMs), heartbeatAt: Timestamp.now(), updatedAt: Timestamp.now(), intent: 'open' });
}

test('a match records whether each side had an age range, and nothing private', { skip }, async () => {
  const { match, db } = await load();
  const a = await newUser(); const b = await newUser();
  await seed(db, a, { age: 30, range: [25, 35], queueAgeMs: 20_000 });
  await seed(db, b, { age: 28 }); // no range of their own
  const res = await call(match, b.token, { action: 'claim' });
  assert.equal(res.body.matched, true);
  const audit = (await db.doc(`matchAudit/${res.body.convId}`).get()).data();
  assert.deepEqual(audit.ageRangeApplied, { [a.uid]: true, [b.uid]: false });
  assert.equal(audit.ageChecked, true);
  assert.deepEqual(audit.participants, [a.uid, b.uid].sort());
  assert.ok(audit.createdAt);
  // Only these fields: no ages, ranges, birthdays or anything about the members.
  assert.deepEqual(Object.keys(audit).sort(), ['ageChecked', 'ageRangeApplied', 'createdAt', 'participants']);
  assert.equal(JSON.stringify(audit).match(/birth|ageMin|ageMax/i), null);
});

test('no match, no audit record', { skip }, async () => {
  const { match, db } = await load();
  const a = await newUser(); const b = await newUser();
  await seed(db, a, { age: 30, range: [25, 35], queueAgeMs: 20_000 });
  await seed(db, b, { age: 19 });
  assert.equal((await call(match, b.token, { action: 'claim' })).body.matched, false);
  assert.equal((await db.collection('matchAudit').get()).size, 0);
});
