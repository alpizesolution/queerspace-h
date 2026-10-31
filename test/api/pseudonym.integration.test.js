// Reservations against the real Firestore emulator: uniqueness, simultaneous claims, retries, renames, returning members.
// Run with SIGNALS_INTEGRATION_TESTS=true (never against production).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function load() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: pseudonym } = await import('../../api/pseudonym.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  return { pseudonym, db: getFirestore(getAdminApp()) };
}
async function call(handler, token, body) {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await handler({ method: 'POST', body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}
async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}
const reserve = (h, u, names, extra = {}) => call(h, u.token, { action: 'reserve', names, ...extra });

test('a name is held by one account; the same name in any case or spacing is taken for everyone else', { skip }, async () => {
  const { pseudonym } = await load();
  const a = await newUser(); const b = await newUser();
  assert.deepEqual((await reserve(pseudonym, a, ['VelvetMuse'])).body, { name: 'VelvetMuse', replaced: false });
  for (const clash of ['velvetmuse', 'VELVETMUSE', 'Velvet Muse', 'Velvet_Muse']) {
    const res = await reserve(pseudonym, b, [clash]);
    assert.equal(res.statusCode, 409, clash);
    assert.equal(res.body.error, 'name_taken');
  }
});

test('asking again for a name the account already holds changes nothing (returning member keeps their name)', { skip }, async () => {
  const { pseudonym, db } = await load();
  const a = await newUser();
  await reserve(pseudonym, a, ['SmittenSiren']);
  const before = (await db.doc(`pseudonymOwners/${a.uid}`).get()).data();
  for (let i = 0; i < 3; i++) assert.deepEqual((await reserve(pseudonym, a, ['SmittenSiren'])).body, { name: 'SmittenSiren', replaced: false });
  assert.equal((await db.collection('pseudonyms').get()).size, 1);
  assert.deepEqual((await db.doc(`pseudonymOwners/${a.uid}`).get()).data().updatedAt, before.updatedAt);
});

test('several accounts reserving the same name at the same moment: exactly one wins', { skip }, async () => {
  const { pseudonym, db } = await load();
  const users = await Promise.all(Array.from({ length: 8 }, newUser));
  const results = await Promise.all(users.map((u) => reserve(pseudonym, u, ['ChasingVenus'])));
  const winners = results.filter((r) => r.statusCode === 200);
  assert.equal(winners.length, 1);
  assert.ok(results.filter((r) => r.statusCode !== 200).every((r) => r.statusCode === 409 && r.body.error === 'name_taken'));
  const claim = (await db.doc('pseudonyms/chasingvenus').get()).data();
  assert.equal(claim.uid, users[results.indexOf(winners[0])].uid);
  assert.equal((await db.collection('pseudonyms').get()).size, 1);
});

test('simultaneous generated names all end up different, falling back past taken candidates', { skip }, async () => {
  const { pseudonym, db } = await load();
  const users = await Promise.all(Array.from({ length: 10 }, newUser));
  // Everyone is handed the same three candidates; with only three names, the rest must use the numbered fallback.
  const results = await Promise.all(users.map((u) => reserve(pseudonym, u, ['DreamyFox', 'ChaoticCupid', 'MoonlitBunny'], { allowSuffix: true })));
  assert.ok(results.every((r) => r.statusCode === 200), JSON.stringify(results.map((r) => r.body)));
  const names = results.map((r) => r.body.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 10);
  assert.equal((await db.collection('pseudonyms').get()).size, 10);
  assert.equal(names.filter((n) => ['DreamyFox', 'ChaoticCupid', 'MoonlitBunny'].includes(n)).length, 3);
  assert.ok(names.every((n) => n.length <= 25));
});

test('a typed name that is taken is refused, not renamed; a generated one is retried', { skip }, async () => {
  const { pseudonym } = await load();
  const a = await newUser(); const b = await newUser(); const c = await newUser();
  await reserve(pseudonym, a, ['FlirtyFirefly']);
  assert.equal((await reserve(pseudonym, b, ['FlirtyFirefly'])).statusCode, 409);
  const retried = await reserve(pseudonym, c, ['FlirtyFirefly', 'WanderingWitch'], { allowSuffix: true });
  assert.deepEqual(retried.body, { name: 'WanderingWitch', replaced: true });
});

test('renaming releases the old name for someone else and removes only the caller\'s own claim', { skip }, async () => {
  const { pseudonym, db } = await load();
  const a = await newUser(); const b = await newUser();
  await reserve(pseudonym, a, ['VelvetMuse']);
  await reserve(pseudonym, a, ['BlushingOrchid']);
  assert.equal((await db.doc('pseudonyms/velvetmuse').get()).exists, false);
  assert.equal((await db.doc(`pseudonymOwners/${a.uid}`).get()).data().key, 'blushingorchid');
  assert.equal((await reserve(pseudonym, b, ['VelvetMuse'])).statusCode, 200);
  // a's next rename must not delete b's claim on the name a used to have.
  await reserve(pseudonym, a, ['StealingKiss']);
  assert.equal((await db.doc('pseudonyms/velvetmuse').get()).data().uid, b.uid);
});

test('changing only the capitalisation keeps the account\'s claim and updates the spelling', { skip }, async () => {
  const { pseudonym, db } = await load();
  const a = await newUser();
  await reserve(pseudonym, a, ['velvetmuse']);
  assert.equal((await reserve(pseudonym, a, ['VelvetMuse'])).body.name, 'VelvetMuse');
  assert.equal((await db.doc('pseudonyms/velvetmuse').get()).data().name, 'VelvetMuse');
  assert.equal((await db.collection('pseudonyms').get()).size, 1);
});

test('suggest returns the first free name and reserves nothing', { skip }, async () => {
  const { pseudonym, db } = await load();
  const a = await newUser(); const b = await newUser();
  await reserve(pseudonym, a, ['DreamyFox']);
  const res = await call(pseudonym, b.token, { action: 'suggest', names: ['dreamyfox', 'ChaoticCupid'] });
  assert.deepEqual(res.body, { name: 'ChaoticCupid' });
  assert.equal((await db.collection('pseudonyms').get()).size, 1);
  assert.deepEqual((await call(pseudonym, b.token, { action: 'suggest', names: ['DreamyFox'] })).body, { name: null });
  assert.deepEqual((await call(pseudonym, a.token, { action: 'suggest', names: ['DreamyFox'] })).body, { name: 'DreamyFox' });
});

test('bad requests and missing sign-in are refused', { skip }, async () => {
  const { pseudonym } = await load();
  const a = await newUser();
  assert.equal((await call(pseudonym, null, { action: 'reserve', names: ['VelvetMuse'] })).statusCode, 401);
  assert.equal((await reserve(pseudonym, a, [])).statusCode, 400);
  assert.equal((await reserve(pseudonym, a, ['x'])).statusCode, 400);
  assert.equal((await reserve(pseudonym, a, [42, null])).statusCode, 400);
  assert.equal((await call(pseudonym, a.token, { action: 'nope' })).statusCode, 400);
});

test('the claim documents are server-only: no client rule mentions them', { skip }, async () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.equal(/match \/pseudonyms/.test(rules) || /match \/pseudonymOwners/.test(rules), false);
});
