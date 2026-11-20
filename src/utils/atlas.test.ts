import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANONYMOUS_NAME, atlasProblemText, AUDIENCE_TEXT, formatMemoryDate, groupByPlace, normalizeBounds, snapCoordinate, todayInputValue, GRID_DEGREES, TITLE_MAX, TEXT_MAX, PLACE_MAX, type AtlasMemory } from './atlas.ts';
import { isTileTemplate, OSM_ATTRIBUTION, resolveTileConfig } from './atlasConfig.ts';
import { isValidPick, wrapLongitude } from './atlasPick.ts';
import { COSMIC_NAMES, GRID_DEGREES as SERVER_GRID, IDENTITY_MODES, MEMORY_VISIBILITY, BLOCKED_PATTERNS, snapCoordinate as serverSnap, VISIBILITIES as SERVER_VIS, TITLE_MAX as S_TITLE, TEXT_MAX as S_TEXT, PLACE_MAX as S_PLACE } from '../../api/_atlas.js';

const m = (id: string, lat: number, lng: number, createdAt: number): AtlasMemory => ({ id, mine: false, title: id, text: '', date: null, lat, lng, placeLabel: '', visibility: 'public', displayIdentity: 'profile', displayName: null, identity: null, hasPhoto: false, createdAt, author: null });

test('the app and the server round locations the same way, to a ~1 km grid', () => {
  assert.equal(GRID_DEGREES, SERVER_GRID);
  for (const v of [14.5995123, -33.8688197, 0.004, -0.004, 179.999, -179.999, 90, -90]) assert.equal(snapCoordinate(v), serverSnap(v), String(v));
  assert.equal(snapCoordinate(14.5995123), 14.6);
  assert.equal(snapCoordinate(120.9842199), 120.98);
  assert.equal(Object.is(snapCoordinate(-0.004), -0), false, 'never -0');
  assert.ok(Math.abs(snapCoordinate(14.5995123) - 14.5995123) <= GRID_DEGREES / 2 + 1e-9);
});

test('limits match the server, and the only audience a member can ever choose is public (the others only describe older records)', () => {
  assert.deepEqual([TITLE_MAX, TEXT_MAX, PLACE_MAX], [S_TITLE, S_TEXT, S_PLACE]);
  assert.equal(MEMORY_VISIBILITY, 'public');
  assert.deepEqual(Object.keys(AUDIENCE_TEXT).sort(), [...SERVER_VIS].sort(), 'the app can describe exactly the audiences the server knows');
  assert.match(AUDIENCE_TEXT.public, /all QUEERSPACE members/);
});

test('the author choice is two things only; the cosmic names are the server\'s alone (the app never sends or lists a name)', () => {
  assert.deepEqual(IDENTITY_MODES, ['profile', 'anonymous']);
  assert.equal(ANONYMOUS_NAME, 'Anonymous', 'the label of the choice in the form');
  assert.deepEqual(COSMIC_NAMES, ['Stardust', 'Star', 'Little Comet', 'Moonbeam', 'Nebula', 'Shooting Star', 'Supernova', 'Cosmic Dust', 'Galaxy', 'Aurora', 'Meteor', 'Luna', 'Celestial', 'Polaris', 'Eclipse', 'Nova']);
  assert.equal(new Set(COSMIC_NAMES).size, COSMIC_NAMES.length, 'no duplicates');
  const source = fs.readFileSync('src/utils/atlas.ts', 'utf8');
  assert.match(source, /export type IdentityMode = 'profile' \| 'anonymous';/);
  assert.doesNotMatch(source, /COSMIC_NAMES|COSMIC_ALIASES|pseudonymProblem|randomAlias/, 'the app has no list of names to pick from or send: the server picks');
});

test('the community word filter on the server mirrors the one in the app', () => {
  const source = fs.readFileSync('src/utils/matching-logic.ts', 'utf8');
  for (const pattern of BLOCKED_PATTERNS) assert.ok(source.includes(`/${pattern.source}/i`), `${pattern} is also in matching-logic.ts`);
  const block = source.slice(source.indexOf('const BLOCKED_PATTERNS'), source.indexOf('export function sanitizeMessageText'));
  assert.equal((block.match(/\/i,/g) ?? []).length, BLOCKED_PATTERNS.length, 'same number of patterns');
});

test('dates show as written, with no time-zone shift', () => {
  assert.match(formatMemoryDate('2024-06-01'), /2024/);
  assert.match(formatMemoryDate('2024-06-01'), /\b1\b/);
  assert.equal(formatMemoryDate(null), '');
  assert.equal(formatMemoryDate('nonsense'), '');
  assert.equal(todayInputValue(new Date(2026, 0, 5)), '2026-01-05');
});

test('map bounds: padded, wrapped, and the whole world stays the whole world', () => {
  const b = normalizeBounds({ south: 10, west: 100, north: 20, east: 120 });
  assert.ok(b.south < 10 && b.north > 20 && b.west < 100 && b.east > 120);
  assert.deepEqual(normalizeBounds({ south: -80, west: -400, north: 80, east: 400 }), { south: -90, west: -180, north: 90, east: 180 });
  const across = normalizeBounds({ south: -20, west: 170, north: 0, east: 190 });
  assert.ok(across.west > across.east, 'a view across the date line is sent as west > east');
  assert.ok(across.west <= 180 && across.east >= -180);
  assert.ok(normalizeBounds({ south: 80, west: 0, north: 95, east: 10 }).north <= 90);
});

test('memories at the same rounded point share one star, newest first', () => {
  const groups = groupByPlace([m('old', 14.6, 120.98, 1), m('new', 14.6, 120.98, 9), m('far', 35.68, 139.65, 5)]);
  assert.equal(groups.length, 2);
  const here = groups.find((g) => g.key === '14.60,120.98');
  assert.deepEqual(here?.memories.map((x) => x.id), ['new', 'old']);
});

test('every failure has plain words for the member', () => {
  for (const reason of ['not-allowed', 'suspended', 'rate-limited', 'too-large', 'type', 'content', 'identity', 'unavailable', 'offline', 'failed'] as const) assert.ok(atlasProblemText(reason).length > 10, reason);
});

test('map tiles: production needs a configured provider and never falls back to the public OpenStreetMap servers', () => {
  assert.equal(resolveTileConfig({}, false), null, 'production without a provider: map unavailable');
  assert.equal(resolveTileConfig({ VITE_ATLAS_TILE_URL: 'http://insecure.test/{z}/{x}/{y}.png' }, false), null, 'https only');
  assert.equal(resolveTileConfig({ VITE_ATLAS_TILE_URL: 'https://tiles.test/tile.png' }, false), null, 'needs {z}/{x}/{y}');
  const prod = resolveTileConfig({ VITE_ATLAS_TILE_URL: 'https://tiles.example.com/{z}/{x}/{y}.png?key=pub', VITE_ATLAS_TILE_ATTRIBUTION: '&copy; Example Tiles', VITE_ATLAS_TILE_TONE: 'dark' }, false);
  assert.equal(prod?.url, 'https://tiles.example.com/{z}/{x}/{y}.png?key=pub');
  assert.equal(prod?.tone, 'dark');
  assert.ok(prod?.attribution.startsWith(OSM_ATTRIBUTION), 'the OpenStreetMap credit is always shown');
  assert.ok(prod?.attribution.includes('Example Tiles'));
  const dev = resolveTileConfig({}, true);
  assert.match(dev?.url ?? '', /tile\.openstreetmap\.org/, 'local development may use the public tiles');
  assert.equal(dev?.tone, 'light');
  assert.equal(isTileTemplate('https://a.test/{z}/{x}/{y}.png'), true);
});

test('a chosen spot is only a point on the map: valid ranges, longitude wrapped around the world, and there is no place search or name any more', () => {
  assert.equal(isValidPick(null), false);
  assert.equal(isValidPick({ lat: 14.6, lng: 120.98 }), true);
  for (const bad of [{ lat: 91, lng: 0 }, { lat: -91, lng: 0 }, { lat: 0, lng: 181 }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }]) assert.equal(isValidPick(bad), false, JSON.stringify(bad));
  assert.equal(wrapLongitude(190), -170);
  assert.equal(wrapLongitude(-190), 170);
  assert.equal(wrapLongitude(540), -180);
  assert.equal(wrapLongitude(120.98), 120.98);
  for (const file of ['src/components/AtlasMemoryComposer.tsx', 'src/components/AtlasPage.tsx', 'src/services/atlasService.ts', 'src/utils/atlasConfig.ts', '.env.example']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /geocod|nominatim|searchPlaces|LocationSearch|Place name/i, `${file} has no place search or place-name field`);
  }
  assert.equal(fs.existsSync('src/components/AtlasLocationPicker.tsx'), false, 'the old picker component is gone');
});

test('no map key or secret is in the client source', () => {
  for (const file of ['src/utils/atlasConfig.ts', 'src/services/atlasService.ts', 'src/components/AtlasMap.tsx', 'src/components/AtlasPage.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /[?&](key|apikey|api_key|access_token)=[A-Za-z0-9]{8,}/i, file);
    assert.doesNotMatch(source, /pk\.[A-Za-z0-9]{20,}/, file);
  }
});
