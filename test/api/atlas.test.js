// ATLAS rules that need no database: validation, rounding, who can see what, and what a viewer is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasOf, canView, COSMIC_NAMES, derivedAlias, displayNameFor, inBounds, isMemoryDate, parseBounds, parseDisplayIdentity, parseMemoryInput, pickAlias, shapeMemory, snapCoordinate, storedIdentity } from '../../api/_atlas.js';

const body = (extra = {}) => ({ title: 'Pier', text: 'We watched it.', date: '2024-06-01', lat: 14.5995123, lng: 120.9842199, placeLabel: 'Manila Bay', visibility: 'public', ...extra });
const code = (fn) => { try { fn(); return null; } catch (error) { return error.message; } };

test('every memory is public and nobody can choose otherwise: the server sets it, and refuses a request for anything else, new or edited', () => {
  const { visibility: _omit, ...withoutVisibility } = body();
  assert.equal(parseMemoryInput(withoutVisibility, { required: true }).visibility, 'public', 'nothing sent: stored as public');
  assert.equal(parseMemoryInput(body(), { required: true }).visibility, 'public');
  for (const asked of ['private', 'friends', 'connections', 'only me', 'PUBLIC', '', null, 0, false, {}]) {
    assert.equal(code(() => parseMemoryInput(body({ visibility: asked }), { required: true })), 'invalid_visibility', `new memory asking for ${JSON.stringify(asked)}`);
    assert.equal(code(() => parseMemoryInput({ visibility: asked }, { required: false })), 'invalid_visibility', `edit asking for ${JSON.stringify(asked)}`);
  }
  assert.deepEqual(Object.keys(parseMemoryInput({ title: 'T', visibility: 'public' }, { required: false })).sort(), ['title'], 'an edit that says "public" changes nothing');
  assert.equal('visibility' in parseMemoryInput({ title: 'Only the title' }, { required: false }), false, 'an edit never touches visibility');
});

test('the author choice is exactly profile or anonymous: no typed names, no aliases, nothing extra', () => {
  assert.deepEqual(parseDisplayIdentity({ mode: 'profile' }), { mode: 'profile' });
  assert.deepEqual(parseDisplayIdentity({ mode: 'anonymous' }), { mode: 'anonymous' });
  for (const bad of [{ mode: 'alias', alias: 'Nova' }, { mode: 'custom', customName: 'Moonchild' }, { mode: 'anonymous', customName: 'Admin' }, { mode: 'profile', displayName: 'Someone Else' },
    { mode: 'profile', authorId: 'victim' }, { mode: 'ANONYMOUS' }, { mode: '' }, {}, null, 'anonymous', [], 7]) {
    assert.equal(code(() => parseDisplayIdentity(bad)), 'invalid_identity', JSON.stringify(bad));
  }
  assert.deepEqual(parseMemoryInput(body(), { required: true }).displayIdentity, { mode: 'profile' }, 'the default is the member\'s own pseudonym');
  assert.deepEqual(parseMemoryInput(body({ displayIdentity: { mode: 'anonymous' } }), { required: true }).displayIdentity, { mode: 'anonymous' });
  assert.equal(code(() => parseMemoryInput(body({ displayIdentity: { mode: 'custom', customName: 'QUEERSPACE Team' } }), { required: true })), 'invalid_identity', 'nobody can write a name, so nobody can pose as the team or another member');
  assert.equal(code(() => parseMemoryInput(body({ authorName: 'Willow' }), { required: true })), 'invalid_memory');
  for (const extra of [{ anonymousAlias: 'Nova' }, { alias: 'Nova' }, { displayIdentity: { mode: 'anonymous', alias: 'Nova' } }, { displayIdentity: { mode: 'anonymous', anonymousAlias: 'Polaris' } }]) {
    assert.notEqual(code(() => parseMemoryInput(body(extra), { required: true })), null, `a cosmic name can never be sent: ${JSON.stringify(extra)}`);
    assert.notEqual(code(() => parseMemoryInput(extra, { required: false })), null, `nor in an edit: ${JSON.stringify(extra)}`);
  }
});

test('rounding: about 1 km, never the exact point, never -0', () => {
  assert.equal(snapCoordinate(14.5995123), 14.6);
  assert.equal(snapCoordinate(120.9842199), 120.98);
  assert.equal(snapCoordinate(-33.8688197), -33.87);
  assert.equal(Object.is(snapCoordinate(-0.004), 0), true);
  const parsed = parseMemoryInput(body(), { required: true });
  assert.equal(parsed.lat, 14.6);
  assert.equal(parsed.lng, 120.98);
});

test('dates: real calendar days, not in the future, not before 1900', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(isMemoryDate('2024-02-29', now), true);
  assert.equal(isMemoryDate('2023-02-29', now), false);
  assert.equal(isMemoryDate('2026-11-20', now), true, 'a day ahead is allowed for time zones');
  assert.equal(isMemoryDate('2026-11-22', now), false);
  assert.equal(isMemoryDate('1899-12-31', now), false);
  assert.equal(isMemoryDate('06/01/2024', now), false);
  assert.equal(isMemoryDate(20240601, now), false);
});

test('input: required fields, limits, and no fields the app is not meant to send', () => {
  assert.equal(code(() => parseMemoryInput(body({ title: '' }), { required: true })), 'invalid_title');
  assert.equal(code(() => parseMemoryInput(body({ title: 'x'.repeat(81) }), { required: true })), 'invalid_title');
  assert.equal(code(() => parseMemoryInput(body({ visibility: 'world' }), { required: true })), 'invalid_visibility');
  assert.equal(code(() => parseMemoryInput(body({ lat: NaN }), { required: true })), 'invalid_location');
  assert.equal(code(() => parseMemoryInput(body({ ownerId: 'x' }), { required: true })), 'invalid_memory');
  assert.equal(code(() => parseMemoryInput(body({ createdAt: 1 }), { required: true })), 'invalid_memory');
  assert.equal(code(() => parseMemoryInput(body({ anonymous: true }), { required: true })), 'invalid_memory', 'the old flag is gone');
  assert.equal(code(() => parseMemoryInput(body({ text: 'send nudes' }), { required: true })), 'content_not_allowed', 'every memory is read by members, so the community rules always apply');
  assert.deepEqual(Object.keys(parseMemoryInput({ title: 'New title' }, { required: false })), ['title'], 'an edit may send just one field');
  assert.equal(code(() => parseMemoryInput([], { required: true })), 'invalid_memory');
});

const ctx = (extra = {}) => ({ uid: 'viewer', blocked: new Set(), partners: new Set(), ...extra });
const mem = (extra = {}) => ({ ownerId: 'author', visibility: 'public', ...extra });

test('who can see a memory: the author always; public for adults; friends-only for connections; private for nobody else', () => {
  const author = { hidden: false };
  assert.equal(canView(mem({ ownerId: 'viewer', visibility: 'private' }), ctx(), undefined), true);
  assert.equal(canView(mem({ visibility: 'private' }), ctx(), author), false);
  assert.equal(canView(mem({ visibility: 'friends' }), ctx(), author), false);
  assert.equal(canView(mem({ visibility: 'friends' }), ctx({ partners: new Set(['author']) }), author), true);
  assert.equal(canView(mem({ visibility: 'public' }), ctx(), author), true);
  assert.equal(canView(mem({ visibility: 'bogus' }), ctx(), author), false, 'an unknown visibility is never shown');
});

test('blocks and hidden authors beat visibility', () => {
  assert.equal(canView(mem(), ctx({ blocked: new Set(['author']) }), { hidden: false }), false, 'the viewer blocked the author');
  assert.equal(canView(mem(), ctx(), { hidden: true }), false, 'the author blocked the viewer or is suspended');
  assert.equal(canView(mem(), ctx(), undefined), false, 'unknown author: not shown');
  assert.equal(canView(mem({ visibility: 'friends' }), ctx({ partners: new Set(['author']), blocked: new Set(['author']) }), { hidden: false }), false, 'a block beats a connection');
});

test('what a viewer receives: rounded coordinates, an author only when they chose to appear, no owner id', () => {
  const data = { ownerId: 'author', title: 'T', text: 'x', date: '2024-06-01', lat: 14.5995123, lng: 120.9842199, placeLabel: 'P', visibility: 'public', photo: { type: 'image/jpeg' } };
  const named = shapeMemory('id1', data, 'viewer', { displayName: 'Willow', avatar: 'a.b', pronouns: 'she/her' });
  assert.equal(named.lat, 14.6);
  assert.equal(named.lng, 120.98);
  assert.equal(named.hasPhoto, true);
  assert.equal(named.mine, false);
  assert.equal(named.author.displayName, 'Willow');
  assert.equal('ownerId' in named, false);
  assert.equal(JSON.stringify(named).includes('14.5995'), false);
  const author = { displayName: 'Willow', avatar: 'a.b', pronouns: 'she/her' };
  const anonymous = shapeMemory('id1', { ...data, displayIdentity: { mode: 'anonymous' } }, 'viewer', author);
  assert.ok(COSMIC_NAMES.includes(anonymous.displayName), `a cosmic name, not a profile name (${anonymous.displayName})`);
  assert.equal(anonymous.displayName, derivedAlias('id1'), 'with none stored, the memory\'s own id decides it');
  assert.equal(anonymous.displayIdentity, 'anonymous');
  assert.equal(anonymous.author, null, 'no author object, so no profile link');
  assert.equal(anonymous.identity, null, 'other members never get the author choice');
  for (const secret of ['Willow', 'ownerId', 'a.b', 'she/her']) assert.equal(JSON.stringify(anonymous).includes(secret), false, `an anonymous memory never carries ${secret}`);
  // Records from earlier versions (the old flag, cosmic aliases, chosen names) can only ever read as anonymous: never as a name.
  for (const legacy of [{ anonymous: true }, { displayIdentity: { mode: 'alias', alias: 'Nova' } }, { displayIdentity: { mode: 'custom', customName: 'Moonchild' } }, { displayIdentity: { mode: 'something-new' } }, { displayIdentity: {} }]) {
    const shown = shapeMemory('id1', { ...data, ...legacy }, 'viewer', author);
    assert.ok(COSMIC_NAMES.includes(shown.displayName), `${JSON.stringify(legacy)} reads as a cosmic name`);
    assert.equal(shown.displayName, derivedAlias('id1'), JSON.stringify(legacy));
    assert.notEqual(shown.displayName, 'Moonchild', 'a name someone typed earlier is never shown');
    assert.equal(shown.author, null, JSON.stringify(legacy));
    assert.equal(JSON.stringify(shown).includes('Willow'), false, JSON.stringify(legacy));
  }
  assert.deepEqual(storedIdentity({}), { mode: 'profile' }, 'a record with no choice recorded is the profile, as before');
  const profile = shapeMemory('id1', { ...data, displayIdentity: { mode: 'profile' } }, 'viewer', author);
  assert.equal(profile.displayName, 'Willow');
  assert.equal(profile.author.displayName, 'Willow');
  assert.equal('ownerId' in profile, false);
  const ownAnonymous = shapeMemory('id1', { ...data, displayIdentity: { mode: 'anonymous' } }, 'author', null);
  assert.equal(ownAnonymous.mine, true);
  assert.deepEqual(ownAnonymous.identity, { mode: 'anonymous' }, 'the author sees their own choice, to edit it');
  assert.equal(ownAnonymous.displayName, derivedAlias('id1'), 'the author sees the same name everyone else does');
  const stored = shapeMemory('id1', { ...data, displayIdentity: { mode: 'anonymous' }, anonymousAlias: 'Polaris' }, 'viewer', author);
  assert.equal(stored.displayName, 'Polaris', 'the stored name is what is shown');
  assert.equal(shapeMemory('id1', { ...data, displayIdentity: { mode: 'anonymous' }, anonymousAlias: 'Polaris' }, 'author', null).displayName, 'Polaris', 'and the author sees that same one');
  assert.equal(shapeMemory('id1', { ...data, displayIdentity: { mode: 'anonymous' }, anonymousAlias: 'Admin' }, 'viewer', author).displayName, derivedAlias('id1'), 'a stored value that is not on the list is never shown');
  const own = shapeMemory('id1', data, 'author', null);
  assert.equal(own.mine, true);
  assert.equal(own.author, null);
});

test('map bounds, including a view across the date line', () => {
  assert.equal(code(() => parseBounds({ south: 20, west: 0, north: 10, east: 5 })), 'invalid_bounds');
  assert.equal(code(() => parseBounds({ south: 0, west: 0, north: 10, east: 500 })), 'invalid_bounds');
  assert.equal(parseBounds(undefined), null);
  const normal = { south: 10, west: 110, north: 20, east: 130 };
  assert.equal(inBounds({ lat: 14.6, lng: 120.98 }, normal), true);
  assert.equal(inBounds({ lat: 48.85, lng: 2.35 }, normal), false);
  const across = { south: -30, west: 170, north: 0, east: -160 };
  assert.equal(inBounds({ lat: -17.7, lng: 178 }, across), true);
  assert.equal(inBounds({ lat: -13.8, lng: -172 }, across), true);
  assert.equal(inBounds({ lat: -13.8, lng: 0 }, across), false);
  assert.equal(inBounds({ lat: 1, lng: 1 }, null), true);
});

test('cosmic names: exactly the agreed list, picked at random, never the same name twice for a member while the pool allows, and never from the request', () => {
  assert.deepEqual(COSMIC_NAMES, ['Stardust', 'Star', 'Little Comet', 'Moonbeam', 'Nebula', 'Shooting Star', 'Supernova', 'Cosmic Dust', 'Galaxy', 'Aurora', 'Meteor', 'Luna', 'Celestial', 'Polaris', 'Eclipse', 'Nova']);
  // random: every name can come up, and a spread of draws is not one name
  const seen = new Set();
  for (let i = 0; i < 600; i++) seen.add(pickAlias());
  assert.equal(seen.size, COSMIC_NAMES.length, 'over many draws every name appears');
  for (const name of seen) assert.ok(COSMIC_NAMES.includes(name));
  // it uses whatever random source it is given, so it is testable
  assert.equal(pickAlias(new Set(), () => 0), 'Stardust');
  assert.equal(pickAlias(new Set(), (n) => n - 1), 'Nova');
  // a member's other anonymous memories are avoided
  const used = new Set(COSMIC_NAMES.slice(0, 15));
  for (let i = 0; i < 50; i++) assert.equal(pickAlias(used), 'Nova', 'the only free name');
  for (let i = 0; i < 100; i++) assert.ok(!['Stardust', 'Star'].includes(pickAlias(new Set(['Stardust', 'Star']))), 'a used name is not drawn again');
  // when every name is taken, the pool is the whole list again (never an error, never a blank)
  assert.ok(COSMIC_NAMES.includes(pickAlias(new Set(COSMIC_NAMES))));
  // an older record gets a stable name from its own id, independent of who wrote it
  assert.equal(derivedAlias('abc'), derivedAlias('abc'));
  assert.ok(COSMIC_NAMES.includes(derivedAlias('abc')));
  assert.ok(new Set(Array.from({ length: 200 }, (_, i) => derivedAlias(`memory-${i}`))).size > 8, 'spread across the list');
  assert.equal(aliasOf('abc', { anonymousAlias: 'Luna' }), 'Luna');
  for (const bad of ['Admin', 'QUEERSPACE Team', 'luna', '', null, 42, undefined]) assert.equal(aliasOf('abc', { anonymousAlias: bad }), derivedAlias('abc'), String(bad));
  assert.equal(displayNameFor('abc', { ownerId: 'o', displayIdentity: { mode: 'anonymous' }, anonymousAlias: 'Luna' }, { displayName: 'Willow' }, 'viewer'), 'Luna');
  assert.equal(displayNameFor('abc', { ownerId: 'o', displayIdentity: { mode: 'profile' }, anonymousAlias: 'Luna' }, { displayName: 'Willow' }, 'viewer'), 'Willow', 'a stray stored name is ignored when the choice is the profile');
});
