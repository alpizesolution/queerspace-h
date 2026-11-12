import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BACKGROUND_PRESETS, DEFAULT_DIM_IMAGE, DEFAULT_DIM_PRESET, DIM_MAX, backgroundToStore, describeBackground, dimColor, imageBackground,
  parseBackground, presetBackground, sameBackground,
} from './profileBackground.ts';
import { buildPublicProfilePayload, mergeCloudProfile } from '../services/profilePersistence.ts';
import { parseProfileResponse } from './profileView.ts';
import { pickProfile } from './preferences.ts';

const IDS = ['nebula-dreams', 'midnight-universe', 'stardust-bloom', 'aurora-galaxy', 'celestial-ocean', 'solar-eclipse', 'cosmic-dust', 'moonlight'];

test('there are exactly the eight presets, each with a name, a blurb and a distinct way of moving', () => {
  assert.deepEqual(BACKGROUND_PRESETS.map((p) => p.id), IDS);
  assert.equal(new Set(BACKGROUND_PRESETS.map((p) => p.name)).size, 8);
  assert.equal(new Set(BACKGROUND_PRESETS.map((p) => p.motion)).size, 8, 'no two presets are described as the same motion');
  assert.ok(BACKGROUND_PRESETS.every((p) => p.blurb && p.motion));
});

test('every preset has its own scene classes in the stylesheet and its own layers (not a recolour of one scene)', async () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  const { SCENES } = await import('../components/CosmicBackground.tsx');
  const signatures = new Set<string>();
  for (const id of IDS) {
    assert.ok(css.includes(`.cosmos-${id}`), `${id} has its scene in cosmos.css`);
    const layers = JSON.stringify(SCENES[id as keyof typeof SCENES]);
    assert.ok(layers.length > 50, `${id} has layers`);
    signatures.add(layers);
  }
  assert.equal(signatures.size, 8, 'eight different layer structures');
});

test('parseBackground accepts a valid preset and a valid image, and fills the defaults', () => {
  assert.deepEqual(parseBackground({ kind: 'preset', preset: 'moonlight' }), { kind: 'preset', preset: 'moonlight', x: 50, y: 50, dim: DEFAULT_DIM_PRESET, animate: true });
  assert.deepEqual(parseBackground({ kind: 'image', image: 'a1b2c3d4e5f60718' }), { kind: 'image', image: 'a1b2c3d4e5f60718', x: 50, y: 50, dim: DEFAULT_DIM_IMAGE, animate: true });
  assert.equal(parseBackground({ kind: 'preset', preset: 'moonlight', animate: false })!.animate, false);
});

test('parseBackground brings numbers inside their limits and treats every malformed value as the default look (null)', () => {
  const clamped = parseBackground({ kind: 'preset', preset: 'moonlight', x: -20, y: 400, dim: 999 })!;
  assert.deepEqual([clamped.x, clamped.y, clamped.dim], [0, 100, DIM_MAX]);
  for (const bad of [
    null, undefined, 'moonlight', 7, [], {}, { kind: 'video', preset: 'moonlight' }, { kind: 'preset' }, { kind: 'preset', preset: 'nope' },
    { kind: 'preset', preset: 'moonlight', image: 'a1b2c3d4e5f60718' }, { kind: 'image' }, { kind: 'image', image: '../../x' }, { kind: 'image', image: 'A1B2C3D4E5F60718' },
    { kind: 'image', image: 'a1b2c3d4e5f60718', preset: 'moonlight' }, { kind: 'preset', preset: 'moonlight', url: 'https://evil.example/a.png' },
    { kind: 'preset', preset: 'moonlight', video: 'https://evil.example/a.webm' },
  ]) assert.equal(parseBackground(bad), null, JSON.stringify(bad));
});

test('backgroundToStore keeps only the small setting of the right kind: never a URL or media', () => {
  assert.deepEqual(backgroundToStore(presetBackground('aurora-galaxy', { x: 10, dim: 30, animate: false })), { kind: 'preset', preset: 'aurora-galaxy', x: 10, y: 50, dim: 30, animate: false });
  assert.deepEqual(backgroundToStore(imageBackground('a1b2c3d4e5f60718')), { kind: 'image', image: 'a1b2c3d4e5f60718', x: 50, y: 50, dim: DEFAULT_DIM_IMAGE, animate: true });
  assert.equal(backgroundToStore(null), null);
  const dirty = { ...presetBackground('moonlight'), blob: 'data:image/png;base64,AAAA' } as never;
  assert.equal(backgroundToStore(dirty), null, 'an unknown field makes it invalid, so it is never stored');
  for (const stored of [backgroundToStore(presetBackground('moonlight')), backgroundToStore(imageBackground('a1b2c3d4e5f60718'))]) {
    assert.ok(JSON.stringify(stored).length < 140, 'a tiny record');
  }
});

test('sameBackground and describeBackground tell the studio and the editor what changed', () => {
  assert.ok(sameBackground(null, undefined));
  assert.ok(sameBackground(presetBackground('moonlight'), presetBackground('moonlight')));
  assert.ok(!sameBackground(presetBackground('moonlight'), presetBackground('moonlight', { x: 51 })));
  assert.ok(!sameBackground(presetBackground('moonlight'), null));
  assert.equal(describeBackground(null), 'Default');
  assert.equal(describeBackground(presetBackground('aurora-galaxy')), 'Aurora Galaxy (animated)');
  assert.equal(describeBackground(presetBackground('aurora-galaxy', { animate: false })), 'Aurora Galaxy (still)');
  assert.equal(describeBackground(imageBackground('a1b2c3d4e5f60718')), 'Your image (still)', 'uploads are plainly labelled still');
});

test('dimColor stays inside 0 to 80 percent', () => {
  assert.equal(dimColor(0), 'rgba(7, 3, 14, 0.00)');
  assert.equal(dimColor(40), 'rgba(7, 3, 14, 0.40)');
  assert.equal(dimColor(500), 'rgba(7, 3, 14, 0.80)');
  assert.equal(dimColor(-5), 'rgba(7, 3, 14, 0.00)');
});

test('the profile save stores only the small setting, and removes the field when there is none', () => {
  const withBg = buildPublicProfilePayload({ background: presetBackground('solar-eclipse', { dim: 22 }) } as never) as Record<string, unknown>;
  assert.deepEqual(withBg.background, { kind: 'preset', preset: 'solar-eclipse', x: 50, y: 50, dim: 22, animate: true });
  const without = buildPublicProfilePayload({} as never) as Record<string, unknown>;
  assert.ok('background' in without, 'the field is explicitly cleared');
  assert.notDeepEqual(without.background, null);
  assert.equal(typeof (without.background as { _methodName?: string })._methodName, 'string', 'a delete marker, so a reset removes it from the cloud');
  assert.ok(!JSON.stringify(withBg).includes('data:'), 'no media in the profile record');
});

test('restoring a profile from the cloud brings the background back, and a malformed or missing one is the default look', () => {
  const local = { background: presetBackground('moonlight') } as never;
  assert.deepEqual(mergeCloudProfile(local, { background: { kind: 'preset', preset: 'cosmic-dust', x: 1, y: 2, dim: 3, animate: false } }, {}).background, { kind: 'preset', preset: 'cosmic-dust', x: 1, y: 2, dim: 3, animate: false });
  assert.equal(mergeCloudProfile(local, {}, {}).background, null, 'removed on another device means removed here');
  assert.equal(mergeCloudProfile(local, { background: { kind: 'preset', preset: 'nope' } }, {}).background, null);
});

test('the background is part of the profile half of the preferences, so it saves with the profile and not with the filters', () => {
  const picked = pickProfile({ background: presetBackground('moonlight') } as never);
  assert.ok('background' in picked);
});

test('a profile answer carries a validated background; an invalid one never makes the profile fail', () => {
  const base = { id: 'm1', displayName: 'Luna', pronouns: null, avatar: null, about: null, vibe: null, style: null, intention: null, interests: [], location: null, orientation: null, identity: null, expression: [], showsAge: false };
  const answer = (background: unknown) => parseProfileResponse({ self: false, member: { ...base, background }, relation: { state: 'none' }, blocked: null });
  assert.deepEqual(answer({ kind: 'preset', preset: 'moonlight', x: 5, y: 6, dim: 7, animate: true })!.member!.background, { kind: 'preset', preset: 'moonlight', x: 5, y: 6, dim: 7, animate: true });
  assert.equal(answer({ kind: 'preset', preset: 'nope' })!.member!.background, null);
  assert.equal(answer(undefined)!.member!.background, null);
  assert.equal(answer({ kind: 'preset', preset: 'moonlight', url: 'https://evil.example/x.png' })!.member!.background, null);
});

test('no animated preset downloads media: the scene stylesheet has no remote url() and no video', () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8') + fs.readFileSync('src/cosmos-tiles.css', 'utf8');
  assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'no remote images');
  assert.ok(!/\.(webm|mp4|gif)\b/i.test(css), 'no video or gif files');
});
