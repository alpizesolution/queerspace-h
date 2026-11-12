// Profile backgrounds against the real emulators, with an in-memory stand-in for R2: what a profile sends of a member's background, how
// an uploaded picture is checked and stored, who may see a saved picture, and that unused pictures are cleaned up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXE, GIF, GPS_MARKER, HTML, SVG, fakeStore, makeJpeg, makePng, makeWebp, toBase64 } from './media-fixtures.js';

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
  const media = await import('../../api/_media.js');
  const bg = await import('../../api/_background.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const store = fakeStore();
  media.setMediaStoreForTests(store);
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
  const upload = (user, buffer, extra = {}) => call(user, 'POST', { action: 'bg-image-set', image: toBase64(buffer), ...extra });
  const prune = (user) => call(user, 'POST', { action: 'bg-image-prune' });
  const profile = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'profile', memberId });
  const image = (viewer, memberId) => call(viewer, 'GET', undefined, { view: 'background-image', memberId });
  const setBackground = (user, background) => db.doc(`users/${user.uid}/public/profile`).update({ background });
  const keys = () => [...store.objects.keys()].sort();
  return { db, store, media, bg, member, call, upload, prune, profile, image, setBackground, keys, Timestamp };
}

const PRESET = { kind: 'preset', preset: 'aurora-galaxy', x: 30, y: 70, dim: 25, animate: true };

test('a profile sends the member\'s background to a visitor, cleaned: the same on their own page, and different members can differ', { skip }, async () => {
  const { member, setBackground, profile } = await setup();
  const a = await member(); const b = await member(); const visitor = await member();
  await setBackground(a, PRESET);
  await setBackground(b, { kind: 'preset', preset: 'solar-eclipse', x: 50, y: 50, dim: 0, animate: false });
  assert.deepEqual((await profile(visitor, a.uid)).body.member.background, PRESET);
  assert.deepEqual((await profile(visitor, b.uid)).body.member.background, { kind: 'preset', preset: 'solar-eclipse', x: 50, y: 50, dim: 0, animate: false });
  assert.deepEqual((await profile(a, a.uid)).body.member.background, PRESET, 'their own page is the same');
});

test('a member with no background, or a damaged record, gets the default look (null), and numbers are kept inside their limits', { skip }, async () => {
  const { member, setBackground, profile, db } = await setup();
  const a = await member(); const visitor = await member();
  assert.equal((await profile(visitor, a.uid)).body.member.background, null, 'nothing set');
  for (const bad of [
    { kind: 'preset', preset: 'not-a-preset', x: 50, y: 50, dim: 10, animate: true },
    { kind: 'preset', preset: 'moonlight', image: 'a'.repeat(16), x: 50, y: 50, dim: 10, animate: true },
    { kind: 'image', image: 'not-hex-id-123456', x: 50, y: 50, dim: 10, animate: true },
    { kind: 'image', image: 'A'.repeat(16), x: 50, y: 50, dim: 10, animate: true },
    { kind: 'preset', preset: 'moonlight', x: 50, y: 50, dim: 10, animate: true, extra: '<script>' },
    { kind: 'video', preset: 'moonlight' }, 'moonlight', 7, [],
  ]) {
    await db.doc(`users/${a.uid}/public/profile`).update({ background: bad });
    assert.equal((await profile(visitor, a.uid)).body.member.background, null, JSON.stringify(bad));
  }
  await setBackground(a, { kind: 'preset', preset: 'moonlight', x: 900, y: -50, dim: 999, animate: 'yes' });
  assert.deepEqual((await profile(visitor, a.uid)).body.member.background, { kind: 'preset', preset: 'moonlight', x: 100, y: 0, dim: 80, animate: true });
});

test('uploading a picture stores the checked picture under the member\'s own prefix and gives back its id; the camera data is removed', { skip }, async () => {
  const { member, upload, store, keys, bg } = await setup();
  const me = await member();
  for (const [name, buffer, type] of [['png', makePng({ width: 64, height: 40 }), 'image/png'], ['jpeg', makeJpeg({ width: 64, height: 40 }), 'image/jpeg'], ['webp', makeWebp({ width: 64, height: 40 }), 'image/webp']]) {
    const res = await upload(me, buffer);
    assert.equal(res.statusCode, 200, name);
    assert.match(res.body.image, /^[a-f0-9]{16}$/);
    const stored = store.objects.get(`bg/${me.uid}/${res.body.image}`);
    assert.ok(stored, `${name} is in the member's own prefix`);
    assert.equal(stored.contentType, type);
    assert.equal(stored.body.includes(Buffer.from(GPS_MARKER)), false, `${name}: no location data kept`);
  }
  assert.ok(keys().every((k) => k.startsWith(`bg/${me.uid}/`)));
  assert.equal(bg.MAX_BACKGROUND_BYTES, 1_800_000);
});

test('only real still pictures are accepted: SVG, GIF, programs, web pages, animated or damaged files are refused and nothing is stored', { skip }, async () => {
  const { member, upload, keys, call } = await setup();
  const me = await member();
  const png = makePng({ width: 32, height: 32 });
  for (const [name, buffer] of [['svg', SVG], ['gif', GIF], ['exe', EXE], ['html', HTML], ['animated webp', makeWebp({ animated: true })], ['truncated png', png.subarray(0, 40)], ['empty', Buffer.alloc(0)], ['text', Buffer.from('hello world, not an image at all'.padEnd(64, '.'))]]) {
    assert.equal((await upload(me, buffer)).statusCode, 400, name);
  }
  for (const image of ['not base64!', 123, null, ['x'], '']) assert.equal((await call(me, 'POST', { action: 'bg-image-set', image })).statusCode, 400, JSON.stringify(image));
  assert.equal((await upload(me, png, { extra: 1 })).statusCode, 400, 'extra fields are refused');
  assert.equal((await upload(me, png, { memberId: 'someone-else-1234' })).statusCode, 400, 'there is no way to name another member');
  assert.deepEqual(keys(), []);
});

test('size limits: a picture over 1.8 MB, or with a side over 3000 pixels, is refused', { skip }, async () => {
  const { member, upload, keys } = await setup();
  const me = await member();
  assert.equal((await upload(me, makeJpeg({ width: 16, height: 16, pad: 1_900_000 }))).statusCode, 413);
  assert.equal((await upload(me, makePng({ width: 3200, height: 8 }))).statusCode, 413);
  assert.equal((await upload(me, makePng({ width: 3000, height: 8 }))).statusCode, 200);
  assert.equal(keys().length, 1);
});

test('who may upload: adults with a finished profile who are not suspended; signed-out callers are refused; with no storage set up the answer says so', { skip }, async () => {
  const { member, upload, db, Timestamp, media, call } = await setup();
  const png = makePng({ width: 32, height: 32 });
  const minor = await member({ settings: { birthDate: Timestamp.fromMillis(Date.now() - 10 * YEAR) } });
  assert.equal((await upload(minor, png)).statusCode, 403);
  const unfinished = await member({ profile: { profileComplete: false } });
  assert.equal((await upload(unfinished, png)).statusCode, 403);
  const suspended = await member();
  await db.doc(`suspensions/${suspended.uid}`).set({ reason: 'test' });
  assert.equal((await upload(suspended, png)).statusCode, 403);
  assert.equal((await upload(null, png)).statusCode, 401);
  assert.equal((await call({ token: 'nope' }, 'POST', { action: 'bg-image-set', image: toBase64(png) })).statusCode, 401);
  const fine = await member();
  media.setMediaStoreForTests(null);
  const saved = process.env.R2_ENDPOINT; delete process.env.R2_ENDPOINT;
  assert.equal((await upload(fine, png)).statusCode, 503, 'no storage configured');
  if (saved !== undefined) process.env.R2_ENDPOINT = saved;
});

test('uploading is rate limited', { skip }, async () => {
  const { member, upload, bg } = await setup();
  const me = await member();
  const png = makePng({ width: 16, height: 16 });
  let last;
  for (let i = 0; i <= bg.BACKGROUND_UPLOADS_PER_HOUR; i++) last = await upload(me, png);
  assert.equal(last.statusCode, 429);
});

test('a picture that has not been saved on the profile cannot be seen by anyone, and a saved one is served to those who may see the profile', { skip }, async () => {
  const { member, upload, setBackground, image } = await setup();
  const me = await member(); const visitor = await member();
  const { body: { image: id } } = await upload(me, makePng({ width: 48, height: 30 }));
  assert.equal((await image(visitor, me.uid)).statusCode, 404, 'uploaded but not saved: nothing to see');
  assert.equal((await image(me, me.uid)).statusCode, 404, 'not even for the owner through this route (they preview their own copy)');
  await setBackground(me, { kind: 'image', image: id, x: 50, y: 50, dim: 40, animate: true });
  const seen = await image(visitor, me.uid);
  assert.equal(seen.statusCode, 200);
  assert.equal(seen.body.contentType, 'image/png');
  assert.equal(seen.body.id, id);
  assert.ok(Buffer.from(seen.body.image, 'base64').subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'real PNG bytes');
  assert.equal(seen.headers['Cache-Control'], 'no-store, max-age=0', 'never cached by a proxy');
  assert.equal((await image(me, me.uid)).statusCode, 200, 'and the owner sees the saved one');
});

test('blocks in either direction, a suspended or not-set-up member, an underage viewer and a signed-out caller all get nothing', { skip }, async () => {
  const { member, upload, setBackground, image, db, Timestamp } = await setup();
  const me = await member(); const viewer = await member();
  const { body: { image: id } } = await upload(me, makePng({ width: 48, height: 30 }));
  await setBackground(me, { kind: 'image', image: id, x: 50, y: 50, dim: 40, animate: true });
  assert.equal((await image(viewer, me.uid)).statusCode, 200);
  await db.doc(`users/${me.uid}/private/settings`).update({ blockedPartnerIds: [viewer.uid] });
  assert.equal((await image(viewer, me.uid)).statusCode, 404, 'they blocked me');
  await db.doc(`users/${me.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`users/${viewer.uid}/private/settings`).update({ blockedPartnerIds: [me.uid] });
  assert.equal((await image(viewer, me.uid)).statusCode, 404, 'I blocked them');
  await db.doc(`users/${viewer.uid}/private/settings`).update({ blockedPartnerIds: [] });
  await db.doc(`suspensions/${me.uid}`).set({ reason: 'test' });
  assert.equal((await image(viewer, me.uid)).statusCode, 404);
  await db.doc(`suspensions/${me.uid}`).delete();
  await db.doc(`users/${me.uid}/public/profile`).update({ profileComplete: false });
  assert.equal((await image(viewer, me.uid)).statusCode, 404);
  await db.doc(`users/${me.uid}/public/profile`).update({ profileComplete: true });
  const minor = await member();
  await db.doc(`users/${minor.uid}/private/settings`).set({ birthDate: Timestamp.fromMillis(Date.now() - 10 * YEAR) });
  assert.equal((await image(minor, me.uid)).statusCode, 403);
  assert.equal((await image(null, me.uid)).statusCode, 401);
  assert.equal((await image(viewer, 'x')).statusCode, 400);
  assert.equal((await image(viewer, me.uid)).statusCode, 200, 'and it comes back when none of that applies');
});

test('a profile can only ever point at the member\'s own prefix: naming someone else\'s picture id shows nothing', { skip }, async () => {
  const { member, upload, setBackground, image } = await setup();
  const a = await member(); const b = await member(); const visitor = await member();
  const { body: { image: idA } } = await upload(a, makePng({ width: 48, height: 30 }));
  await setBackground(a, { kind: 'image', image: idA, x: 50, y: 50, dim: 40, animate: true });
  await setBackground(b, { kind: 'image', image: idA, x: 50, y: 50, dim: 40, animate: true });
  assert.equal((await image(visitor, a.uid)).statusCode, 200);
  assert.equal((await image(visitor, b.uid)).statusCode, 404, 'b copied a\'s id but the picture is looked up under b\'s own prefix');
});

test('unused pictures are cleaned up: an upload keeps only the saved picture and the new one, and pruning keeps only the saved one', { skip }, async () => {
  const { member, upload, prune, setBackground, keys, db } = await setup();
  const me = await member();
  const a = (await upload(me, makePng({ width: 20, height: 20 }))).body.image;
  await setBackground(me, { kind: 'image', image: a, x: 50, y: 50, dim: 40, animate: true });
  const b = (await upload(me, makePng({ width: 21, height: 20 }))).body.image;
  assert.deepEqual(keys(), [`bg/${me.uid}/${a}`, `bg/${me.uid}/${b}`].sort(), 'the saved one and the new one');
  const c = (await upload(me, makePng({ width: 22, height: 20 }))).body.image;
  assert.deepEqual(keys(), [`bg/${me.uid}/${a}`, `bg/${me.uid}/${c}`].sort(), 'the earlier unsaved one is gone, the saved one is not');
  await prune(me);
  assert.deepEqual(keys(), [`bg/${me.uid}/${a}`], 'after a save, only the picture on the profile stays');
  await setBackground(me, { kind: 'preset', preset: 'moonlight', x: 50, y: 50, dim: 10, animate: true });
  await prune(me);
  assert.deepEqual(keys(), [], 'switching to a preset (or resetting) removes the picture');
  assert.equal((await db.doc(`profileBackgroundImages/${me.uid}`).get()).exists, false, 'and the tracking record');
  assert.equal((await prune(me)).statusCode, 200, 'pruning again is harmless');
});

test('pruning only ever touches the caller\'s own pictures', { skip }, async () => {
  const { member, upload, prune, keys } = await setup();
  const a = await member(); const b = await member();
  const mine = (await upload(a, makePng({ width: 20, height: 20 }))).body.image;
  const theirs = (await upload(b, makePng({ width: 20, height: 20 }))).body.image;
  await prune(b);
  assert.ok(keys().includes(`bg/${a.uid}/${mine}`), 'a\'s upload is untouched by b pruning');
  assert.ok(!keys().includes(`bg/${b.uid}/${theirs}`), 'b\'s own unsaved upload is removed');
});

test('storage trouble is handled: a failed write stores and tracks nothing, and a failed read looks like "no picture"', { skip }, async () => {
  const { member, upload, setBackground, image, store, db, keys } = await setup();
  const me = await member(); const visitor = await member();
  store.failPut = true;
  assert.equal((await upload(me, makePng({ width: 20, height: 20 }))).statusCode, 500);
  store.failPut = false;
  assert.deepEqual(keys(), []);
  assert.equal((await db.doc(`profileBackgroundImages/${me.uid}`).get()).exists, false);
  const id = (await upload(me, makePng({ width: 20, height: 20 }))).body.image;
  await setBackground(me, { kind: 'image', image: id, x: 50, y: 50, dim: 40, animate: true });
  store.failGet = true;
  assert.equal((await image(visitor, me.uid)).statusCode, 404);
});

test('the presets and limits are the same on the server, in the app and in the rules', { skip: false }, async () => {
  const fs = await import('node:fs');
  const bg = await import('../../api/_background.js');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  const fromRules = [...(rules.match(/function backgroundPresetIds\(\) \{\s*return \[([^\]]+)\]/)?.[1].matchAll(/'([a-z-]+)'/g) ?? [])].map((m) => m[1]);
  assert.deepEqual(fromRules, bg.BACKGROUND_PRESETS);
  const app = fs.readFileSync('src/utils/profileBackground.ts', 'utf8');
  const fromApp = [...app.matchAll(/\{ id: '([a-z-]+)', name:/g)].map((m) => m[1]);
  assert.deepEqual(fromApp, bg.BACKGROUND_PRESETS);
  assert.match(app, new RegExp(`DIM_MAX = ${bg.DIM_MAX}`));
  assert.match(app, new RegExp(`DEFAULT_DIM_PRESET = ${bg.DEFAULT_DIM_PRESET}`));
  assert.match(app, new RegExp(`DEFAULT_DIM_IMAGE = ${bg.DEFAULT_DIM_IMAGE}`));
  assert.match(rules, /b\.dim <= 80/);
});
