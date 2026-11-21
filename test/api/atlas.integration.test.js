// ATLAS against the real emulators, with an in-memory stand-in for R2: who may create, see, change and delete a memory, that the stored
// and returned location is always the rounded ~1 km point (never the exact one), and that private/friends/public, blocks, suspensions and
// anonymous authors are enforced by the SERVER.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GPS_MARKER, fakeStore, makeJpeg, toBase64 } from './media-fixtures.js';

const enabled = process.env.SIGNALS_INTEGRATION_TESTS === 'true';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'demo-queerspace-test';
const skip = !enabled ? 'Set SIGNALS_INTEGRATION_TESTS=true to run against Firebase emulators.' : false;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function newUser() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json();
  return { uid: d.localId, token: d.idToken };
}

async function setup() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const { default: atlas } = await import('../../api/atlas.js');
  const media = await import('../../api/_media.js');
  const { getAdminApp } = await import('../../api/_lib.js');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const db = getFirestore(getAdminApp());
  const store = fakeStore();
  media.setMediaStoreForTests(store);
  const member = async (name, { adult = true, blocked = [], complete = true } = {}) => {
    const user = await newUser();
    await db.doc(`users/${user.uid}/private/settings`).set({
      ...(adult ? { birthDate: Timestamp.fromDate(new Date('1990-05-05T00:00:00Z')) } : {}),
      ...(blocked.length ? { blockedPartnerIds: blocked } : {}),
    });
    await db.doc(`users/${user.uid}/public/profile`).set({ displayName: name, avatar: 'cat.1.2', pronouns: 'she/her', profileComplete: complete });
    return { ...user, name };
  };
  const googleAdmin = async (dbRef) => {
    const sub = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idToken = JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true });
    const r = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
    const d = await r.json();
    await dbRef.doc(`admins/${d.localId}`).set({ createdAt: new Date() });
    return { uid: d.localId, token: d.idToken };
  };
  const connect = (a, b) => db.collection('signalsPairs').add({ participants: [a.uid, b.uid], status: 'active', createdAt: new Date() });
  const call = async (user, method, body, query) => {
    const res = { statusCode: 200, body: undefined, headers: {}, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
    await atlas({ method, headers: user ? { authorization: `Bearer ${user.token}` } : {}, body, query: query ?? {}, url: '/' }, res);
    return res;
  };
  const memory = (extra = {}) => ({ action: 'create', title: 'Our first sunrise', text: 'We watched it from the pier.', date: '2024-06-01', lat: 14.5995123, lng: 120.9842199, placeLabel: 'Manila Bay', ...extra });
  /** A record saved by an EARLIER version (they could be private or connections-only). The API can no longer make these. */
  const legacy = async (owner, visibility, extra = {}) => {
    const id = `legacy-${visibility}-${Math.random().toString(36).slice(2, 10)}`;
    await db.doc(`atlasMemories/${id}`).set({ ownerId: owner.uid, title: `Old ${visibility}`, text: 'x', date: '2024-06-01', lat: 14.6, lng: 120.98, placeLabel: 'P', visibility, displayIdentity: { mode: 'profile' }, createdAt: new Date(), updatedAt: new Date(), ...extra });
    return id;
  };
  const create = (user, extra) => call(user, 'POST', memory(extra));
  const list = (user, scope = 'community', bounds) => call(user, 'POST', { action: 'list', scope, ...(bounds ? { bounds } : {}) });
  const ids = (res) => res.body.memories.map((m) => m.id);
  return { db, store, member, connect, call, create, list, ids, memory, legacy, Timestamp, googleAdmin };
}

test('creating a memory stores and returns only the rounded point, never the exact coordinates', { skip }, async () => {
  const { member, create, db, list } = await setup();
  const alice = await member('Alice');
  const res = await create(alice);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.memory.lat, 14.6);
  assert.equal(res.body.memory.lng, 120.98);
  const stored = (await db.doc(`atlasMemories/${res.body.memory.id}`).get()).data();
  assert.equal(stored.lat, 14.6);
  assert.equal(stored.lng, 120.98);
  assert.equal(stored.ownerId, alice.uid);
  const everything = JSON.stringify([stored, res.body, (await list(alice, 'mine')).body]);
  for (const exact of ['14.5995', '120.9842', '14.5995123', '120.9842199']) assert.equal(everything.includes(exact), false, `${exact} must never appear`);
  assert.equal(JSON.stringify(Object.keys(res.body.memory).sort()), JSON.stringify(['author', 'createdAt', 'date', 'displayIdentity', 'displayName', 'hasPhoto', 'hearts', 'hugs', 'id', 'identity', 'lat', 'lng', 'mine', 'placeLabel', 'text', 'title', 'views', 'visibility']));
});

test('only adult members who are not suspended can use ATLAS', { skip }, async () => {
  const { member, create, list, db, call } = await setup();
  const minor = await member('Minor', { adult: false });
  assert.equal((await create(minor)).statusCode, 403);
  assert.equal((await list(minor)).statusCode, 403);
  const alice = await member('Alice');
  await db.doc(`suspensions/${alice.uid}`).set({ source: 'admin', reason: 'test', createdAt: new Date() });
  assert.equal((await create(alice)).statusCode, 403);
  assert.equal((await call(null, 'POST', { action: 'list', scope: 'community' })).statusCode, 401);
});

test('every new memory is public to adult members; records saved by an earlier version as private or connections-only keep their narrower audience, and nothing widens them', { skip }, async () => {
  const { member, connect, create, list, ids, legacy, db, call } = await setup();
  const alice = await member('Alice');
  const friend = await member('Friend');
  const stranger = await member('Stranger');
  await connect(alice, friend);
  const priv = await legacy(alice, 'private');
  const fr = await legacy(alice, 'friends');
  const pub = (await create(alice, { title: 'Public one' })).body.memory.id;
  assert.equal((await db.doc(`atlasMemories/${pub}`).get()).data().visibility, 'public', 'the server stored public');
  assert.deepEqual(new Set(ids(await list(alice, 'mine'))), new Set([priv, fr, pub]), 'the author sees all of their own under "mine"');
  assert.deepEqual(ids(await list(alice, 'community')), [pub], 'Community shows the member\'s own PUBLIC memory too, and not their older private or connections-only ones');
  assert.deepEqual(new Set(ids(await list(friend))), new Set([fr, pub]), 'a connection still sees the older connections-only one');
  assert.deepEqual(ids(await list(stranger)), [pub], 'a stranger sees only the public one');
  const asStranger = JSON.stringify((await list(stranger)).body);
  assert.equal(asStranger.includes('Old private') || asStranger.includes('Old friends'), false);
  // Editing an older record never widens it: the edit path has no visibility to change, and asking for one is refused.
  assert.equal((await call(alice, 'POST', { action: 'update', id: fr, title: 'Edited legacy' })).statusCode, 200);
  assert.equal((await db.doc(`atlasMemories/${fr}`).get()).data().visibility, 'friends', 'an edit does not widen it');
  assert.deepEqual(ids(await list(stranger)), [pub], 'a stranger still cannot see it');
  assert.equal((await call(alice, 'POST', { action: 'update', id: fr, visibility: 'private' })).statusCode, 400);
});

test('every new memory is public and nobody can choose otherwise: asking for private or connections-only is refused when creating AND when editing, and stores or changes nothing', { skip }, async () => {
  const { member, call, memory, db, ids, list } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const made = await call(alice, 'POST', memory());
  assert.equal(made.statusCode, 201);
  assert.equal(made.body.memory.visibility, 'public', 'nothing asked: public');
  assert.equal((await db.doc(`atlasMemories/${made.body.memory.id}`).get()).data().visibility, 'public');
  for (const asked of ['private', 'friends', 'connections', 'only me', 'PUBLIC', '', null, 0, false]) {
    assert.equal((await call(alice, 'POST', memory({ visibility: asked }))).statusCode, 400, `create asking for ${JSON.stringify(asked)}`);
  }
  assert.equal((await db.collection('atlasMemories').get()).size, 1, 'the refused requests stored nothing');
  assert.equal((await call(alice, 'POST', memory({ visibility: 'public', title: 'Said public' }))).statusCode, 201, 'saying "public" is harmless');
  const id = made.body.memory.id;
  for (const asked of ['private', 'friends', 'connections', '', null]) {
    const res = await call(alice, 'POST', { action: 'update', id, visibility: asked });
    assert.equal(res.statusCode, 400, `edit asking for ${JSON.stringify(asked)}`);
  }
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).data().visibility, 'public', 'still public');
  assert.ok(ids(await list(viewer)).includes(id), 'and still visible to other members');
  assert.equal((await call(alice, 'POST', { action: 'update', id, visibility: 'public', title: 'Edited' })).statusCode, 200);
});

test('blocks (either way) and suspended authors hide memories; an ended connection no longer counts as a friend', { skip }, async () => {
  const { member, connect, create, list, ids, db, legacy } = await setup();
  const alice = await member('Alice');
  const viewerBlocksAlice = await member('Viewer1');
  const aliceBlockedViewer = await member('Viewer2');
  const friend = await member('Friend');
  const pub = (await create(alice)).body.memory.id;
  const fr = await legacy(alice, 'friends');
  await db.doc(`users/${viewerBlocksAlice.uid}/private/settings`).update({ blockedPartnerIds: [alice.uid] });
  assert.deepEqual(ids(await list(viewerBlocksAlice)), [], 'the viewer blocked the author');
  await db.doc(`users/${alice.uid}/private/settings`).update({ blockedPartnerIds: [aliceBlockedViewer.uid] });
  assert.deepEqual(ids(await list(aliceBlockedViewer)), [], 'the author blocked the viewer');
  const pair = await connect(alice, friend);
  assert.deepEqual(new Set(ids(await list(friend))), new Set([pub, fr]));
  await pair.update({ status: 'ended' });
  assert.deepEqual(ids(await list(friend)), [pub], 'an ended connection is no longer a friend');
  await db.doc(`suspensions/${alice.uid}`).set({ source: 'admin', reason: 'test', createdAt: new Date() });
  assert.deepEqual(ids(await list(friend)), [], 'a suspended author is hidden from others');
});

const identity = (mode, extra = {}) => ({ displayIdentity: { mode, ...extra } });

test('a memory shows its author by their own pseudonym (the default) or under a cosmic name, and an anonymous one never leaks the real account', { skip }, async () => {
  const { member, create, list, db } = await setup();
  const { COSMIC_NAMES } = await import('../../api/_atlas.js');
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  await create(alice, { title: 'Default' });
  await create(alice, { title: 'Named', ...identity('profile') });
  await create(alice, { title: 'Hidden', ...identity('anonymous') });
  const seen = (await list(viewer)).body.memories;
  const by = (title) => seen.find((m) => m.title === title);
  for (const title of ['Default', 'Named']) {
    assert.equal(by(title).displayName, 'Alice', `${title}: the member's own pseudonym, read from their profile`);
    assert.equal(by(title).author.displayName, 'Alice');
    assert.equal(by(title).author.id, alice.uid, 'a pseudonym memory may link to the profile (the profile page applies its own visibility rules)');
  }
  const hidden = by('Hidden');
  assert.ok(COSMIC_NAMES.includes(hidden.displayName), `a cosmic name (${hidden.displayName})`);
  assert.equal(hidden.displayIdentity, 'anonymous');
  assert.equal(hidden.author, null, 'no author object, so no profile link');
  assert.equal(hidden.identity, null, 'other members never see the author\'s choice');
  const raw = JSON.stringify(hidden);
  for (const secret of [alice.uid, 'Alice', 'ownerId', 'she/her', 'cat.1.2']) assert.equal(raw.includes(secret), false, `an anonymous memory must not contain ${secret}`);
  // Ownership is untouched: the real owner is stored, and is how the author edits, deletes and how moderation finds them.
  const stored = (await db.collection('atlasMemories').where('title', '==', 'Hidden').get()).docs[0].data();
  assert.equal(stored.ownerId, alice.uid);
  assert.deepEqual(stored.displayIdentity, { mode: 'anonymous' });
  assert.equal(stored.anonymousAlias, hidden.displayName, 'the cosmic name is stored on the memory itself');
  const mine = (await list(alice, 'mine')).body.memories.find((m) => m.title === 'Hidden');
  assert.equal(mine.mine, true);
  assert.deepEqual(mine.identity, { mode: 'anonymous' });
  assert.equal(mine.displayName, hidden.displayName, 'the author sees the same name everyone else does');
});

test('Anonymous is a random cosmic name picked by the server for each memory: from the agreed list, stored on that memory, a different one for each of a member\'s memories while the list allows, and not tied to the member', { skip }, async () => {
  const { member, create, list, db } = await setup();
  const { COSMIC_NAMES } = await import('../../api/_atlas.js');
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  assert.equal(COSMIC_NAMES.length, 16);
  const names = [];
  for (let i = 0; i < 16; i++) {
    const made = await create(alice, { title: `Hidden ${i}`, lat: 10 + i * 2, ...identity('anonymous') });
    assert.equal(made.statusCode, 201);
    names.push(made.body.memory.displayName);
    const stored = (await db.doc(`atlasMemories/${made.body.memory.id}`).get()).data();
    assert.equal(stored.anonymousAlias, made.body.memory.displayName, `${i}: stored on that memory`);
  }
  for (const name of names) assert.ok(COSMIC_NAMES.includes(name), `${name} is on the list`);
  assert.equal(new Set(names).size, 16, 'sixteen anonymous memories by one member: sixteen different names, so nothing links them');
  const seventeenth = await create(alice, { title: 'Hidden 16', lat: 60, ...identity('anonymous') });
  assert.ok(COSMIC_NAMES.includes(seventeenth.body.memory.displayName), 'with every name used, the list starts again (never an error)');
  // The name belongs to the memory, not to the member: nothing about the member's profile or account carries one.
  const profile = (await db.doc(`users/${alice.uid}/public/profile`).get()).data();
  assert.equal(JSON.stringify(profile).includes('anonymousAlias'), false);
  assert.equal((await db.collection('atlasMemories').where('ownerId', '==', alice.uid).get()).docs.filter((d) => d.data().anonymousAlias).length, 17);
  // Random across members: several members' first anonymous memories are not all the same name.
  const firsts = new Set();
  for (let i = 0; i < 7; i++) { const other = await member(`Other${i}`); firsts.add((await create(other, { title: `O${i}`, lat: -10 - i, ...identity('anonymous') })).body.memory.displayName); }
  assert.ok(firsts.size > 1, `different members get different draws (${[...firsts].join(', ')})`);
  assert.equal((await list(viewer)).statusCode, 200);
});

test('the cosmic name is the same in every response (community, recent, the author\'s own list) and stays the same when read again and when the memory is edited', { skip }, async () => {
  const { member, create, call, list, db } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const id = (await create(alice, { title: 'Steady', ...identity('anonymous') })).body.memory.id;
  const stored = (await db.doc(`atlasMemories/${id}`).get()).data().anonymousAlias;
  const seen = async () => ({
    community: (await list(viewer)).body.memories.find((m) => m.id === id).displayName,
    recent: (await list(viewer, 'recent')).body.memories.find((m) => m.id === id).displayName,
    mine: (await list(alice, 'mine')).body.memories.find((m) => m.id === id).displayName,
  });
  assert.deepEqual(await seen(), { community: stored, recent: stored, mine: stored });
  assert.deepEqual(await seen(), { community: stored, recent: stored, mine: stored }, 'reading again changes nothing');
  // Editing words, date, place and picture, and even re-sending "anonymous", never re-rolls it.
  for (const change of [{ title: 'Steady, renamed' }, { text: 'New words' }, { date: '2024-07-01' }, { lat: 11.11, lng: 22.22, placeLabel: 'Moved' }, { photo: toBase64(makeJpeg()) }, { displayIdentity: { mode: 'anonymous' } }]) {
    const res = await call(alice, 'POST', { action: 'update', id, ...change });
    assert.equal(res.statusCode, 200, JSON.stringify(Object.keys(change)));
    assert.equal(res.body.memory.displayName, stored, `${Object.keys(change)}: the same name`);
    assert.equal((await db.doc(`atlasMemories/${id}`).get()).data().anonymousAlias, stored);
  }
  assert.deepEqual(await seen(), { community: stored, recent: stored, mine: stored });
});

test('switching: pseudonym to Anonymous picks a new cosmic name; back to the pseudonym shows the real one and drops the cosmic name; Anonymous again picks another, avoiding the member\'s other memories', { skip }, async () => {
  const { member, create, call, list, db } = await setup();
  const { COSMIC_NAMES } = await import('../../api/_atlas.js');
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const other = await create(alice, { title: 'Another hidden one', lat: 40, ...identity('anonymous') });
  const otherName = other.body.memory.displayName;
  const id = (await create(alice, { title: 'Switch me' })).body.memory.id;
  const doc = async () => (await db.doc(`atlasMemories/${id}`).get()).data();
  const shown = async () => (await list(viewer)).body.memories.find((m) => m.id === id);
  assert.equal((await shown()).displayName, 'Alice');
  assert.equal((await doc()).anonymousAlias, undefined, 'a pseudonym memory has no cosmic name');
  const seen = new Set();
  for (let round = 0; round < 12; round++) {
    const toAnon = await call(alice, 'POST', { action: 'update', id, ...identity('anonymous') });
    assert.equal(toAnon.statusCode, 200);
    const name = toAnon.body.memory.displayName;
    assert.ok(COSMIC_NAMES.includes(name), `${name} is on the list`);
    assert.notEqual(name, otherName, 'not the name the member already has on another memory');
    assert.equal((await doc()).anonymousAlias, name, 'stored');
    assert.equal((await shown()).displayName, name);
    assert.equal((await shown()).author, null);
    seen.add(name);
    const back = await call(alice, 'POST', { action: 'update', id, ...identity('profile') });
    assert.equal(back.statusCode, 200);
    assert.equal(back.body.memory.displayName, 'You', 'the author sees their own memory as theirs');
    assert.equal((await shown()).displayName, 'Alice', 'back to the real pseudonym');
    assert.equal((await shown()).author.id, alice.uid, 'with the profile link again');
    assert.equal('anonymousAlias' in (await doc()), false, 'the cosmic name is dropped');
  }
  assert.ok(seen.size > 1, `each switch to Anonymous is a fresh draw (${[...seen].join(', ')})`);
  assert.equal((await doc()).ownerId, alice.uid, 'ownership never changed');
});

test('the author choice is validated on the server: only profile or anonymous, never a name, so nobody can pose as another member or the team', { skip }, async () => {
  const { member, call, memory, db } = await setup();
  const alice = await member('Alice');
  const tryIdentity = async (displayIdentity) => (await call(alice, 'POST', memory({ displayIdentity }))).statusCode;
  assert.equal(await tryIdentity({ mode: 'profile' }), 201);
  assert.equal(await tryIdentity({ mode: 'anonymous' }), 201);
  for (const bad of [{ mode: 'secret' }, { mode: 'alias', alias: 'Nova' }, { mode: 'custom', customName: 'Moonchild' }, { mode: 'custom', customName: 'QUEERSPACE Team' },
    { mode: 'anonymous', customName: 'Admin' }, { mode: 'profile', displayName: 'Someone Else' }, { mode: 'profile', authorId: 'victim-id-123456' }, { mode: 'ANONYMOUS' }, { mode: '' }, {}, 'Anonymous', null, [], 7]) {
    assert.equal(await tryIdentity(bad), 400, JSON.stringify(bad));
  }
  for (const extra of [{ displayName: 'Admin' }, { authorName: 'Willow' }, { author: { id: 'victim-id-123456' } }, { ownerId: 'victim-id-123456' }, { anonymous: true }]) {
    assert.equal((await call(alice, 'POST', memory(extra))).statusCode, 400, `a memory cannot carry ${Object.keys(extra)[0]}`);
  }
  assert.equal((await db.collection('atlasMemories').get()).size, 2, 'only the two valid ones were stored');
});

test('nobody can choose a cosmic name or take someone else\'s: it is never accepted from a request, on create or on edit, and another member cannot touch the memory', { skip }, async () => {
  const { member, call, memory, create, db } = await setup();
  const alice = await member('Alice');
  const mallory = await member('Mallory');
  const id = (await create(alice, { title: 'Hers', ...identity('anonymous') })).body.memory.id;
  const before = (await db.doc(`atlasMemories/${id}`).get()).data();
  const attempts = [{ anonymousAlias: 'Nova' }, { alias: 'Nova' }, { displayName: 'Luna' }, { authorName: 'Willow' }, { displayIdentity: { mode: 'anonymous', alias: 'Nova' } }, { displayIdentity: { mode: 'anonymous', anonymousAlias: 'Polaris' } }, { displayIdentity: { mode: 'anonymous', customName: 'Luna' } }];
  for (const extra of attempts) {
    assert.equal((await call(alice, 'POST', memory({ title: 'x', ...extra }))).statusCode, 400, `create with ${JSON.stringify(extra)}`);
    assert.equal((await call(alice, 'POST', { action: 'update', id, ...extra })).statusCode, 400, `edit with ${JSON.stringify(extra)}`);
    assert.equal((await call(mallory, 'POST', { action: 'update', id, ...extra })).statusCode, 400, `another member's edit with ${JSON.stringify(extra)}`);
  }
  assert.equal((await call(mallory, 'POST', { action: 'update', id, ...identity('anonymous') })).statusCode, 404, 'another member cannot re-roll or change it');
  assert.equal((await call(mallory, 'POST', { action: 'update', id, ...identity('profile') })).statusCode, 404);
  const after = (await db.doc(`atlasMemories/${id}`).get()).data();
  assert.equal(after.anonymousAlias, before.anonymousAlias, 'untouched');
  assert.equal(after.ownerId, alice.uid);
  assert.equal((await db.collection('atlasMemories').get()).size, 1, 'the refused creates stored nothing');
});

test('records from earlier versions (the old anonymous flag, aliases, typed names) read under a cosmic name worked out from the memory itself, never as a typed name; an older named record still names its author', { skip }, async () => {
  const { member, list, db } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const old = { ownerId: alice.uid, text: 'x', date: '2024-06-01', lat: 14.6, lng: 120.98, placeLabel: 'P', visibility: 'public', createdAt: new Date(), updatedAt: new Date() };
  await db.doc('atlasMemories/old-named-0001').set({ ...old, title: 'Old named', anonymous: false });
  await db.doc('atlasMemories/old-hidden-001').set({ ...old, title: 'Old hidden', anonymous: true });
  await db.doc('atlasMemories/old-alias-0001').set({ ...old, title: 'Old alias', displayIdentity: { mode: 'alias', alias: 'Nova' } });
  await db.doc('atlasMemories/old-custom-001').set({ ...old, title: 'Old custom', displayIdentity: { mode: 'custom', customName: 'Moonchild' } });
  const seen = (await list(viewer)).body.memories;
  assert.equal(seen.find((m) => m.title === 'Old named').displayName, 'Alice');
  const { COSMIC_NAMES, derivedAlias } = await import('../../api/_atlas.js');
  for (const [title, docId] of [['Old hidden', 'old-hidden-001'], ['Old alias', 'old-alias-0001'], ['Old custom', 'old-custom-001']]) {
    const shown = seen.find((m) => m.title === title);
    assert.ok(COSMIC_NAMES.includes(shown.displayName), `${title}: a cosmic name (${shown.displayName})`);
    assert.equal(shown.displayName, derivedAlias(docId), `${title}: the name its own id gives, the same on every screen`);
    assert.equal(shown.author, null, title);
    assert.equal(JSON.stringify(shown).includes(alice.uid), false, title);
    for (const typed of ['Moonchild']) assert.equal(JSON.stringify(shown).includes(typed), false, `${title} never shows the name someone typed earlier (${typed})`);
  }
});

test('REGRESSION: a newly published memory appears in Community AND My memories for its author, and in Community for every other member; older private/connections-only records of the author stay out of Community', { skip }, async () => {
  const { member, connect, create, list, ids, legacy, db } = await setup();
  const { COSMIC_NAMES } = await import('../../api/_atlas.js');
  const alice = await member('Alice');
  const bob = await member('Bob');
  const friend = await member('Friend');
  await connect(alice, friend);
  const view = { south: 10, west: 115, north: 20, east: 125 };
  const named = await create(alice, { title: 'Published named' });
  const hidden = await create(alice, { title: 'Published anonymous', displayIdentity: { mode: 'anonymous' } });
  assert.equal(named.statusCode, 201);
  assert.equal(named.body.memory.visibility, 'public', 'the backend made it public (the request did not ask for anything)');
  assert.equal((await db.doc(`atlasMemories/${named.body.memory.id}`).get()).data().visibility, 'public');
  const olderPrivate = await legacy(alice, 'private', { title: 'Older private' });
  const olderFriends = await legacy(alice, 'friends', { title: 'Older connections-only' });
  const [namedId, hiddenId] = [named.body.memory.id, hidden.body.memory.id];

  // the author: My memories has everything of theirs; Community has every PUBLIC memory, including their own, and none of the narrower older ones
  const mine = await list(alice, 'mine');
  assert.deepEqual(new Set(ids(mine)), new Set([namedId, hiddenId, olderPrivate, olderFriends]), 'My memories: only the author\'s own, all of them');
  for (const scope of [undefined, view]) {
    const community = await list(alice, 'community', scope);
    assert.equal(community.statusCode, 200);
    assert.deepEqual(new Set(ids(community)), new Set([namedId, hiddenId]), `Community (${scope ? 'map view' : 'whole world'}) shows the author's own public memories`);
    assert.equal(ids(community).includes(olderPrivate) || ids(community).includes(olderFriends), false, 'older private / connections-only records are never in Community');
  }
  const asAuthor = (await list(alice, 'community', view)).body.memories;
  assert.equal(asAuthor.find((m) => m.id === namedId).mine, true, 'flagged as theirs, so they can edit it from Community too');
  assert.equal(asAuthor.find((m) => m.id === hiddenId).mine, true);
  assert.ok(COSMIC_NAMES.includes(asAuthor.find((m) => m.id === hiddenId).displayName), 'an anonymous memory shows its cosmic name there too');
  assert.equal((await list(alice, 'recent')).body.memories.map((m) => m.id).sort().join(), [namedId, hiddenId].sort().join(), 'Recent follows Community: the newest public memories, including the author\'s');

  // every other member sees them in Community (and Recent), the same cosmic name, nothing narrower
  for (const viewer of [bob, friend]) {
    const community = (await list(viewer, 'community', view)).body.memories;
    assert.equal(community.some((m) => m.id === namedId), true, 'another member sees the published memory');
    assert.equal(community.some((m) => m.id === hiddenId), true);
    assert.equal(community.find((m) => m.id === hiddenId).displayName, asAuthor.find((m) => m.id === hiddenId).displayName, 'the same cosmic name for everyone');
    assert.equal(community.find((m) => m.id === namedId).mine, false);
    assert.equal(community.some((m) => m.id === olderPrivate), false, 'no private memory leaks to others');
    const recentIds = ids(await list(viewer, 'recent'));
    assert.equal(recentIds.includes(namedId) && recentIds.includes(hiddenId), true, 'Recent shows both published memories to everyone');
    assert.equal(recentIds.includes(olderPrivate), false, 'and never the older private one');
  }
  assert.equal((await list(bob, 'community', view)).body.memories.some((m) => m.id === olderFriends), false, 'a stranger never sees an older connections-only record');
  assert.equal((await list(friend, 'community', view)).body.memories.some((m) => m.id === olderFriends), true, 'only the author\'s connection does (unchanged)');

  // nothing private is in what anyone receives: no owner id, no exact point, no real name on the anonymous one
  const everything = JSON.stringify([asAuthor, (await list(bob, 'community', view)).body]);
  for (const secret of ['ownerId', '14.5995123', '120.9842199']) assert.equal(everything.includes(secret), false, `${secret} is never in a response`);
  const bobSees = (await list(bob, 'community', view)).body.memories.find((m) => m.id === hiddenId);
  assert.equal(bobSees.author, null);
  assert.equal(JSON.stringify(bobSees).includes(alice.uid) || JSON.stringify(bobSees).includes('Alice'), false);
  // a view that does not contain the pin does not show it, for anyone
  assert.equal(ids(await list(alice, 'community', { south: 40, west: -10, north: 55, east: 10 })).includes(namedId), false);
});

test('Recent Memories: only the newest three community memories from the last 24 hours; older ones stay on the map', { skip }, async () => {
  const { member, create, list, ids, db, Timestamp, legacy } = await setup();
  const alice = await member('Alice');
  const bob = await member('Bob');
  const viewer = await member('Viewer');
  const made = [];
  for (const title of ['one', 'two', 'three', 'four']) made.push((await create(alice, { title, lat: 14.6 + made.length })).body.memory.id);
  const day = 24 * 60 * 60 * 1000;
  const set = (id, ageMs) => db.doc(`atlasMemories/${id}`).update({ createdAt: Timestamp.fromMillis(Date.now() - ageMs) });
  await set(made[0], 1 * 60 * 60 * 1000);
  await set(made[1], 2 * 60 * 60 * 1000);
  await set(made[2], 3 * 60 * 60 * 1000);
  await set(made[3], 5 * 60 * 60 * 1000);
  const older = (await create(bob, { title: 'older', lat: 40 })).body.memory.id;
  await set(older, day + 60_000);
  const privateOne = await legacy(alice, 'private', { lat: 41 });
  await set(privateOne, 60_000);
  const recent = await list(viewer, 'recent');
  assert.equal(recent.statusCode, 200);
  assert.deepEqual(ids(recent), [made[0], made[1], made[2]], 'newest first, three at most, nothing older than 24 hours, nothing private');
  const all = await list(viewer, 'community', { south: -90, west: -180, north: 90, east: 180 });
  assert.equal(new Set(ids(all)).size, 5, 'the preview limit hides nothing from the map: all five public memories are there');
  assert.ok(ids(all).includes(older) && ids(all).includes(made[3]));
  assert.equal((await db.collection('atlasMemories').get()).size, 6, 'no records were created or removed');
  assert.deepEqual(ids(await list(alice, 'recent')), [made[0], made[1], made[2]], 'a member\'s own public memories are community memories too (never their older private one)');
  assert.equal((await list(viewer, 'recent', { south: 0, west: 0, north: 1, east: 1 })).statusCode, 400);
});

test('Recent Memories follows the same privacy: blocked authors and strangers never see older friends-only records', { skip }, async () => {
  const { member, create, list, ids, connect, db, legacy } = await setup();
  const alice = await member('Alice');
  const friend = await member('Friend');
  const blocker = await member('Blocker');
  await connect(alice, friend);
  const fr = await legacy(alice, 'friends');
  const pub = (await create(alice, { title: 'public', lat: 20 })).body.memory.id;
  assert.deepEqual(new Set(ids(await list(friend, 'recent'))), new Set([fr, pub]));
  assert.deepEqual(ids(await list(blocker, 'recent')), [pub]);
  await db.doc(`users/${blocker.uid}/private/settings`).update({ blockedPartnerIds: [alice.uid] });
  assert.deepEqual(ids(await list(blocker, 'recent')), []);
});

test('an administrator can remove any memory (and its photo); the removal is logged with the real owner; other members still cannot', { skip }, async () => {
  const { member, create, call, db, store, googleAdmin } = await setup();
  const alice = await member('Alice');
  const mallory = await member('Mallory');
  const admin = await googleAdmin(db);
  const made = await create(alice, { photo: toBase64(makeJpeg()), displayIdentity: { mode: 'anonymous' } });
  const id = made.body.memory.id;
  assert.ok(store.objects.has(`atlas/${id}`));
  assert.equal((await call(mallory, 'POST', { action: 'delete', id })).statusCode, 404);
  assert.equal((await call(admin, 'POST', { action: 'delete', id })).statusCode, 200);
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).exists, false);
  assert.equal(store.objects.has(`atlas/${id}`), false);
  const log = (await db.collection('atlasModerationLog').get()).docs.map((d) => d.data());
  assert.equal(log.length, 1);
  assert.equal(log[0].ownerId, alice.uid, 'the real owner is kept for moderation');
  assert.equal(log[0].adminId, admin.uid);
  assert.equal(log[0].memoryId, id);
  assert.equal((await call(admin, 'POST', { action: 'delete', id: 'doesnotexist123' })).statusCode, 404);
});

test('nobody else can edit or delete a member\'s memory, and an older private one does not even confirm it exists', { skip }, async () => {
  const { member, call, db, legacy } = await setup();
  const alice = await member('Alice');
  const mallory = await member('Mallory');
  const id = await legacy(alice, 'private', { title: 'Our first sunrise' });
  const edit = await call(mallory, 'POST', { action: 'update', id, title: 'Hijacked' });
  const remove = await call(mallory, 'POST', { action: 'delete', id });
  assert.equal(edit.statusCode, 404);
  assert.equal(remove.statusCode, 404);
  const missing = await call(mallory, 'POST', { action: 'update', id: 'doesnotexist123', title: 'x' });
  assert.equal(missing.statusCode, 404);
  assert.equal(JSON.stringify(edit.body), JSON.stringify(missing.body), 'the same answer whether it exists or not');
  const stored = (await db.doc(`atlasMemories/${id}`).get()).data();
  assert.equal(stored.title, 'Our first sunrise');
  assert.equal(stored.ownerId, alice.uid);
});

test('the author can edit and delete; a moved pin is rounded too; the owner and the audience cannot be changed', { skip }, async () => {
  const { member, create, call, list, ids, db } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const id = (await create(alice)).body.memory.id;
  assert.deepEqual(ids(await list(viewer)), [id]);
  const edited = await call(alice, 'POST', { action: 'update', id, title: 'Renamed', lat: 10.123456, lng: 20.654321, placeLabel: 'Elsewhere' });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.body.memory.title, 'Renamed');
  assert.equal(edited.body.memory.lat, 10.12, 'a moved pin is rounded too');
  assert.equal(edited.body.memory.lng, 20.65);
  assert.equal(edited.body.memory.visibility, 'public', 'an edit leaves it public');
  assert.equal((await call(alice, 'POST', { action: 'update', id, visibility: 'private' })).statusCode, 400, 'it cannot be made private');
  assert.deepEqual(ids(await list(viewer)), [id], 'so it is still on the map for others');
  assert.equal((await call(alice, 'POST', { action: 'update', id, ownerId: viewer.uid })).statusCode, 400, 'the owner cannot be changed');
  assert.equal((await call(alice, 'POST', { action: 'update', id, lat: 10 })).statusCode, 400, 'lat and lng go together');
  assert.equal((await call(alice, 'POST', { action: 'delete', id })).statusCode, 200);
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).exists, false);
  assert.deepEqual(ids(await list(alice, 'mine')), []);
});

test('bad input is refused: dates, places, fields that are not allowed, long text, and community-rule words', { skip }, async () => {
  const { member, call, memory } = await setup();
  const alice = await member('Alice');
  const tryIt = async (extra) => (await call(alice, 'POST', memory(extra))).statusCode;
  assert.equal(await tryIt({ date: '2999-01-01' }), 400);
  assert.equal(await tryIt({ date: '2024-02-31' }), 400);
  assert.equal(await tryIt({ date: 'yesterday' }), 400);
  assert.equal(await tryIt({ lat: 91 }), 400);
  assert.equal(await tryIt({ lng: -181 }), 400);
  assert.equal(await tryIt({ lat: '14.5' }), 400);
  assert.equal(await tryIt({ title: '   ' }), 400);
  assert.equal(await tryIt({ title: 'x'.repeat(81) }), 400);
  assert.equal(await tryIt({ text: 'x'.repeat(1001) }), 400);
  assert.equal(await tryIt({ visibility: 'everyone' }), 400);
  assert.equal(await tryIt({ ownerId: 'someone-else' }), 400);
  assert.equal(await tryIt({ exactLat: 14.5995123 }), 400);
  assert.equal(await tryIt({ title: 'kys' }), 400, 'every memory is read by members, so the community rules apply');
  assert.equal(await tryIt({ visibility: 'private', title: 'fine words' }), 400, 'there is no private note any more');
  assert.equal((await call(alice, 'POST', { action: 'create' })).statusCode, 400);
  assert.equal((await call(alice, 'POST', { action: 'explode' })).statusCode, 400);
});

test('a memory needs no place name: its location is the chosen point, rounded to the ~1 km grid; creating and editing keep the position right, and an edit leaves any existing place name alone', { skip }, async () => {
  const { member, create, call, list, db, legacy } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const body = { title: 'No label', text: '', date: '2024-06-01', lat: 14.5995123, lng: 120.9842199 };
  const made = await call(alice, 'POST', { action: 'create', ...body });
  assert.equal(made.statusCode, 201, 'no place name needed');
  assert.equal(made.body.memory.placeLabel, '');
  assert.equal(made.body.memory.lat, 14.6);
  assert.equal(made.body.memory.lng, 120.98);
  const stored = (await db.doc(`atlasMemories/${made.body.memory.id}`).get()).data();
  assert.deepEqual([stored.lat, stored.lng, stored.placeLabel], [14.6, 120.98, '']);
  assert.equal(JSON.stringify([stored, made.body]).includes('14.5995'), false, 'the exact point is never stored or returned');
  // Moving the pin: the new point is rounded the same way, and the old place name (if any) is left as it was.
  const id = await legacy(alice, 'public', { title: 'Has a label', placeLabel: 'Manila Bay', lat: 14.6, lng: 120.98 });
  const moved = await call(alice, 'POST', { action: 'update', id, lat: 10.123456, lng: 20.654321 });
  assert.equal(moved.statusCode, 200);
  assert.deepEqual([moved.body.memory.lat, moved.body.memory.lng, moved.body.memory.placeLabel], [10.12, 20.65, 'Manila Bay']);
  // Sending the memory's own (already rounded) point back changes nothing, so a plain edit cannot make a star drift.
  for (let i = 0; i < 3; i++) {
    const again = await call(alice, 'POST', { action: 'update', id, title: `Renamed ${i}`, lat: moved.body.memory.lat, lng: moved.body.memory.lng });
    assert.deepEqual([again.body.memory.lat, again.body.memory.lng], [10.12, 20.65], `edit ${i}`);
  }
  const titleOnly = await call(alice, 'POST', { action: 'update', id, title: 'Only words' });
  assert.deepEqual([titleOnly.body.memory.lat, titleOnly.body.memory.lng], [10.12, 20.65], 'an edit that sends no point keeps the position');
  // What other members see is at the same rounded place.
  const seen = (await list(viewer, 'community', { south: 0, west: 0, north: 20, east: 40 })).body.memories.find((m) => m.id === id);
  assert.deepEqual([seen.lat, seen.lng], [10.12, 20.65]);
  // The place name is still validated if someone does send one (older apps), and a point is still required.
  assert.equal((await call(alice, 'POST', { action: 'create', ...body, placeLabel: 'x'.repeat(81) })).statusCode, 400);
  assert.equal((await call(alice, 'POST', { action: 'create', title: 'No point', text: '', date: '2024-06-01' })).statusCode, 400, 'a location is required');
  assert.equal((await call(alice, 'POST', { action: 'create', ...body, lat: 91 })).statusCode, 400);
});

test('creating twice with the same id is one memory, and another member cannot take over the id', { skip }, async () => {
  const { member, call, memory, db } = await setup();
  const alice = await member('Alice');
  const mallory = await member('Mallory');
  const id = 'memory-fixed-id-0001';
  const first = await call(alice, 'POST', memory({ id }));
  const again = await call(alice, 'POST', memory({ id, title: 'Different' }));
  assert.equal(first.statusCode, 201);
  assert.equal(again.body.replayed, true);
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).data().title, 'Our first sunrise');
  assert.equal((await call(mallory, 'POST', memory({ id }))).statusCode, 409);
});

test('the map view only returns memories inside the bounds, including a view that crosses the date line', { skip }, async () => {
  const { member, create, list, ids } = await setup();
  const alice = await member('Alice');
  const viewer = await member('Viewer');
  const manila = (await create(alice, { title: 'Manila', lat: 14.6, lng: 120.98 })).body.memory.id;
  const paris = (await create(alice, { title: 'Paris', lat: 48.85, lng: 2.35 })).body.memory.id;
  const fiji = (await create(alice, { title: 'Fiji', lat: -17.7, lng: 178.0 })).body.memory.id;
  const samoa = (await create(alice, { title: 'Samoa', lat: -13.8, lng: -172.0 })).body.memory.id;
  assert.deepEqual(ids(await list(viewer, 'community', { south: 10, west: 110, north: 20, east: 130 })), [manila]);
  assert.deepEqual(ids(await list(viewer, 'community', { south: 40, west: -10, north: 55, east: 10 })), [paris]);
  assert.deepEqual(new Set(ids(await list(viewer, 'community', { south: -30, west: 170, north: 0, east: -160 }))), new Set([fiji, samoa]), 'west > east means across the date line');
  assert.equal((await list(viewer, 'community', { south: 20, west: 0, north: 10, east: 5 })).statusCode, 400);
});

test('photos: stored privately with the camera details removed, shown only to members who may see the memory, removed with it', { skip }, async () => {
  const { member, connect, call, create, memory, store, db } = await setup();
  const alice = await member('Alice');
  const friend = await member('Friend');
  const stranger = await member('Stranger');
  await connect(alice, friend);
  const made = await create(alice, { photo: toBase64(makeJpeg({ withMetadata: true })) });
  assert.equal(made.statusCode, 201);
  const id = made.body.memory.id;
  assert.equal(made.body.memory.hasPhoto, true);
  assert.ok(store.objects.has(`atlas/${id}`), 'in the private bucket under the atlas prefix');
  assert.equal(store.objects.get(`atlas/${id}`).body.includes(Buffer.from(GPS_MARKER)), false, 'camera details removed');
  const view = (user) => call(user, 'GET', undefined, { view: 'photo', id });
  assert.equal((await view(alice)).statusCode, 200);
  assert.equal((await view(friend)).body.contentType, 'image/jpeg');
  assert.equal((await view(stranger)).statusCode, 200, 'every memory is public, so is its photo (for adult members, through the permission-checked request)');
  // An older record with a narrower audience keeps it for its photo too.
  await db.doc(`atlasMemories/${id}`).update({ visibility: 'friends' });
  assert.equal((await view(stranger)).statusCode, 404, 'a stranger cannot see an older connections-only photo');
  assert.equal((await view(friend)).statusCode, 200);
  await db.doc(`atlasMemories/${id}`).update({ visibility: 'private' });
  assert.equal((await view(friend)).statusCode, 404, 'private');
  await db.doc(`atlasMemories/${id}`).update({ visibility: 'public' });
  assert.equal((await call(alice, 'POST', memory({ photo: 'not-base64!!' }))).statusCode, 400);
  assert.equal((await call(alice, 'POST', memory({ photo: toBase64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) }))).statusCode, 400, 'only real JPEG, PNG or WebP');
  const removed = await call(alice, 'POST', { action: 'update', id, removePhoto: true });
  assert.equal(removed.body.memory.hasPhoto, false);
  assert.equal(store.objects.has(`atlas/${id}`), false, 'the object is deleted when the photo is removed');
  assert.equal((await view(alice)).statusCode, 404);
  // Many pictures asked for at once (the Recent strip, a crowded star) must all be served: their rate-limit counters share one document.
  const burstId = (await create(alice, { photo: toBase64(makeJpeg()) })).body.memory.id;
  const burst = await Promise.all(Array.from({ length: 12 }, () => call(stranger, 'GET', undefined, { view: 'photo', id: burstId })));
  assert.deepEqual(burst.map((r) => r.statusCode), Array(12).fill(200), 'every parallel picture request succeeds');
  const second = (await create(alice, { photo: toBase64(makeJpeg()) })).body.memory.id;
  assert.ok(store.objects.has(`atlas/${second}`));
  await call(alice, 'POST', { action: 'delete', id: second });
  assert.equal(store.objects.has(`atlas/${second}`), false, 'deleting a memory deletes its photo');
});

test('a photo without storage set up fails cleanly and creates nothing', { skip }, async () => {
  const { member, call, memory, db } = await setup();
  const media = await import('../../api/_media.js');
  media.setMediaStoreForTests(null);
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^R2_/.test(key)) delete process.env[key];
  const alice = await member('Alice');
  const res = await call(alice, 'POST', memory({ photo: toBase64(makeJpeg()) }));
  Object.assign(process.env, saved);
  assert.equal(res.statusCode, 503);
  assert.equal((await db.collection('atlasMemories').get()).size, 0);
});

// ------------------------------------------------------------------------------------------------ views and reactions

const engage = (call) => ({
  view: (user, id) => call(user, 'POST', { action: 'view', id }),
  react: (user, id, kind) => call(user, 'POST', { action: 'react', id, kind }),
});

test("views: a member's first open counts once, however often they open it; the author's own opens are not counted; nobody is named", { skip }, async () => {
  const { member, create, call, db, list } = await setup();
  const { view } = engage(call);
  const alice = await member('Alice');
  const bob = await member('Bob');
  const cy = await member('Cy');
  const id = (await create(alice)).body.memory.id;
  assert.deepEqual((await view(bob, id)).body.engagement, { views: 1, hugs: 0, hearts: 0, mine: null });
  for (let i = 0; i < 5; i++) assert.equal((await view(bob, id)).body.engagement.views, 1, 'opening it again is not another view');
  assert.equal((await view(cy, id)).body.engagement.views, 2, 'another member is another view');
  assert.equal((await view(alice, id)).body.engagement.views, 2, 'the author opening their own memory adds nothing');
  // opened at the same moment by one member (two devices, a double tap): still one view
  const dave = await member('Dave');
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => view(dave, id)));
  assert.ok(results.every((r) => r.statusCode === 200));
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).data().viewCount, 3, 'stored total: Bob, Cy, Dave');
  assert.equal((await db.collection(`atlasMemories/${id}/views`).get()).size, 3, 'one record per viewing member');
  // the total shows up in the list, and nothing says who
  const listed = (await list(bob)).body.memories.find((m) => m.id === id);
  assert.equal(listed.views, 3);
  const everything = JSON.stringify([listed, results[0].body]);
  for (const secret of [bob.uid, cy.uid, dave.uid, 'ownerId', 'Bob', 'Cy', 'Dave']) assert.equal(everything.includes(secret), false, `${secret} is never in a response`);
});

test('reactions: one hug OR heart per member; choosing the other switches, the same one again changes nothing, null takes it back; totals follow', { skip }, async () => {
  const { member, create, call, db, list } = await setup();
  const { view, react } = engage(call);
  const alice = await member('Alice');
  const bob = await member('Bob');
  const cy = await member('Cy');
  const id = (await create(alice)).body.memory.id;
  assert.deepEqual((await react(bob, id, 'hug')).body.engagement, { views: 0, hugs: 1, hearts: 0, mine: 'hug' });
  assert.deepEqual((await react(bob, id, 'hug')).body.engagement, { views: 0, hugs: 1, hearts: 0, mine: 'hug' }, 'the same reaction twice is still one');
  assert.deepEqual((await react(bob, id, 'heart')).body.engagement, { views: 0, hugs: 0, hearts: 1, mine: 'heart' }, 'choosing the other switches it');
  assert.deepEqual((await react(cy, id, 'heart')).body.engagement, { views: 0, hugs: 0, hearts: 2, mine: 'heart' });
  assert.deepEqual((await react(cy, id, null)).body.engagement, { views: 0, hugs: 0, hearts: 1, mine: null }, 'taking it back');
  assert.deepEqual((await react(cy, id, null)).body.engagement, { views: 0, hugs: 0, hearts: 1, mine: null }, 'taking back nothing is fine');
  // each member sees their own reaction when they open the card, and everyone sees the totals in the list
  assert.equal((await view(bob, id)).body.engagement.mine, 'heart');
  assert.equal((await view(cy, id)).body.engagement.mine, null);
  const listed = (await list(cy)).body.memories.find((m) => m.id === id);
  assert.deepEqual([listed.hugs, listed.hearts], [0, 1]);
  assert.equal(JSON.stringify(listed).includes('"mine":"'), false, 'the list carries no reaction of anyone');
  // storage: exactly one record per reacting member, and the totals equal the records
  const records = await db.collection(`atlasMemories/${id}/reactions`).get();
  assert.deepEqual(records.docs.map((d) => [d.id, d.data().kind]), [[bob.uid, 'heart']]);
  const stored = (await db.doc(`atlasMemories/${id}`).get()).data();
  assert.deepEqual([stored.hugCount, stored.heartCount], [0, 1]);
});

test('reactions: a burst of taps by one member (double taps, two devices) never leaves two reactions or a wrong total', { skip }, async () => {
  const { member, create, call, db } = await setup();
  const { react } = engage(call);
  const alice = await member('Alice');
  const bob = await member('Bob');
  const id = (await create(alice)).body.memory.id;
  const burst = await Promise.all(['hug', 'heart', 'hug', 'heart', 'hug', 'heart', 'hug', 'heart'].map((kind) => react(bob, id, kind)));
  assert.ok(burst.every((r) => r.statusCode === 200), JSON.stringify(burst.map((r) => r.statusCode)));
  const records = await db.collection(`atlasMemories/${id}/reactions`).get();
  assert.equal(records.size, 1, 'one record for the member');
  const stored = (await db.doc(`atlasMemories/${id}`).get()).data();
  const kind = records.docs[0].data().kind;
  assert.equal(stored.hugCount + stored.heartCount, 1, 'the totals add up to that one reaction');
  assert.equal(stored[kind === 'hug' ? 'hugCount' : 'heartCount'], 1);
  // many members at once: the total is exact
  const crowd = await Promise.all(Array.from({ length: 8 }, (_, i) => member(`Fan${i}`)));
  await Promise.all(crowd.map((m, i) => react(m, id, i % 2 ? 'hug' : 'heart')));
  const after = (await db.doc(`atlasMemories/${id}`).get()).data();
  assert.equal(after.hugCount + after.heartCount, 9);
  assert.equal((await db.collection(`atlasMemories/${id}/reactions`).get()).size, 9);
});

test('engagement permissions: only who may see a memory can view or react; not on your own; bad requests are refused; nothing changes without sign-in', { skip }, async () => {
  const { member, create, call, db, connect, legacy } = await setup();
  const { view, react } = engage(call);
  const alice = await member('Alice');
  const bob = await member('Bob');
  const friend = await member('Friend');
  const blocker = await member('Blocker', { blocked: [alice.uid] });
  const minor = await member('Minor', { adult: false });
  await connect(alice, friend);
  const id = (await create(alice)).body.memory.id;
  const own = await react(alice, id, 'heart');
  assert.equal(own.statusCode, 403, 'not on your own memory');
  assert.equal(own.body.error, 'own_memory');
  for (const kind of ['love', 'HUG', '', undefined, 1, ['hug']]) assert.equal((await react(bob, id, kind)).statusCode, 400, `kind ${JSON.stringify(kind)}`);
  for (const body of [{ action: 'react', id, kind: 'hug', extra: 1 }, { action: 'view', id, extra: 1 }, { action: 'react', kind: 'hug' }, { action: 'view', id: '../x' }, { action: 'view', id: 7 }]) {
    assert.equal((await call(bob, 'POST', body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal((await view(bob, 'no-such-memory')).statusCode, 404);
  assert.equal((await react(bob, 'no-such-memory', 'hug')).statusCode, 404);
  assert.equal((await view(null, id)).statusCode, 401, 'sign in required');
  assert.equal((await view(minor, id)).statusCode, 403, 'adults only, like everything in ATLAS');
  assert.equal((await react(blocker, id, 'hug')).statusCode, 404, 'a member who blocked the author gets the same "not found"');
  // older private / connections-only records keep their narrower audience for views and reactions too
  const priv = await legacy(alice, 'private');
  const friends = await legacy(alice, 'friends');
  for (const target of [priv, friends]) {
    assert.equal((await view(bob, target)).statusCode, 404);
    assert.equal((await react(bob, target, 'hug')).statusCode, 404);
  }
  assert.equal((await view(friend, friends)).statusCode, 200, 'a connection of the author can');
  assert.equal((await react(friend, friends, 'heart')).statusCode, 200);
  assert.equal((await db.collection(`atlasMemories/${priv}/views`).get()).size, 0, 'nothing was recorded for a memory they may not see');
  assert.equal((await db.collection(`atlasMemories/${priv}/reactions`).get()).size, 0);
});

test('engagement: totals survive an edit, the response carries no ids, and deleting the memory deletes its reactions and views', { skip }, async () => {
  const { member, create, call, db } = await setup();
  const { view, react } = engage(call);
  const alice = await member('Alice');
  const bob = await member('Bob');
  const id = (await create(alice)).body.memory.id;
  await view(bob, id); await react(bob, id, 'hug');
  const edited = await call(alice, 'POST', { action: 'update', id, title: 'A better title' });
  assert.equal(edited.statusCode, 200);
  assert.deepEqual([edited.body.memory.views, edited.body.memory.hugs, edited.body.memory.hearts], [1, 1, 0], 'an edit leaves the totals alone');
  assert.equal(JSON.stringify(edited.body).includes(bob.uid), false);
  assert.equal((await call(alice, 'POST', { action: 'delete', id })).statusCode, 200);
  assert.equal((await db.doc(`atlasMemories/${id}`).get()).exists, false);
  assert.equal((await db.collection(`atlasMemories/${id}/views`).get()).size, 0, 'no orphaned view records');
  assert.equal((await db.collection(`atlasMemories/${id}/reactions`).get()).size, 0, 'no orphaned reactions');
  assert.equal((await view(bob, id)).statusCode, 404);
});

test('engagement is rate limited per member', { skip }, async () => {
  const { member, create, call } = await setup();
  const { view } = engage(call);
  const { ENGAGEMENT_PER_MINUTE } = await import('../../api/_atlas.js');
  const alice = await member('Alice');
  const bob = await member('Bob');
  const id = (await create(alice)).body.memory.id;
  let limited = 0;
  for (let i = 0; i < ENGAGEMENT_PER_MINUTE + 5; i++) if ((await view(bob, id)).statusCode === 429) limited++;
  assert.ok(limited >= 5, `the ${ENGAGEMENT_PER_MINUTE + 1}th request in a minute is refused (${limited} refused)`);
});
