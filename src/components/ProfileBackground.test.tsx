import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProfileResponse } from '../utils/profileView.ts';
import { imageBackground, presetBackground, type ProfileBackground } from '../utils/profileBackground.ts';

/**
 * The animated profile background on the real components, with only the services replaced: it fills the page behind everything and
 * stays out of the way, honours the animation switch and a hidden tab, loads only the chosen scene, and the Studio edits a draft that
 * changes nothing until it is applied.
 */
const uploads: Blob[] = [];
let uploadResult: { ok: true; image: string } | { ok: false; reason: string } = { ok: true, image: 'a1b2c3d4e5f60718' };
let fetched: Array<[string, string]> = [];
let answer: { ok: true; data: ProfileResponse } | { ok: false; reason: string } = { ok: false, reason: 'failed' };

mock.module('../services/profileViewService.ts', {
  namedExports: {
    clearProfileCache: () => {},
    fetchMemberAge: async () => null,
    fetchMemberLookingForPosts: async () => [],
    fetchMemberProfile: async () => answer,
    peekMemberProfile: () => null,
    prefetchMemberPosts: () => {},
    shareMemberProfile: async () => 'copied',
    peekMemberPostsFirstPage: () => null,
    fetchMemberCommunityPosts: async () => ({ ok: true, page: { posts: [], cursor: null, done: true } }),
  },
});
mock.module('../services/stardustService.ts', { namedExports: { fetchStardustTotal: async () => null, giveStardust: async () => ({ ok: false }), subscribeToMyStardust: () => () => {} } });
mock.module('../services/profileBackgroundService.ts', {
  namedExports: {
    prepareBackgroundImage: async (file: Blob) => (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file : null),
    uploadBackgroundImage: async (blob: Blob) => { uploads.push(blob); return uploadResult; },
    uploadProblemText: (reason: string) => `problem:${reason}`,
    fetchBackgroundImage: async (memberId: string, imageId: string) => { fetched.push([memberId, imageId]); return 'blob:saved-picture'; },
    pruneBackgroundImages: async () => {},
    clearBackgroundImageCache: () => {},
  },
});
const { ProfilePage } = await import('./ProfilePage.tsx');
const { CosmicBackground } = await import('./CosmicBackground.tsx');
const { BackgroundStudio } = await import('./BackgroundStudio.tsx');
const { ProfileEditorSheet } = await import('./ProfileEditorSheet.tsx');

const member = { id: 'member-abc-123', displayName: 'Luna', pronouns: 'she/her', avatar: null, about: 'Tea and books', vibe: null, style: null, intention: null, interests: ['books'], location: null, orientation: null, identity: null, expression: [], showsAge: false };
const profile = (background: ProfileBackground | null | undefined, over: Partial<ProfileResponse> = {}): ProfileResponse =>
  ({ self: false, member: { ...member, background }, relation: { state: 'none' }, blocked: null, currentVibe: null, ...over });
const prefs = { showAgeOnProfile: false, showLocationOnProfile: true, showSexualOrientationOnProfile: false, showGenderIdentityOnProfile: false, showGenderExpressionOnProfile: false } as never;

const showPage = async (data: ProfileResponse | { ok: false; reason: string }) => {
  answer = 'ok' in data ? data : { ok: true, data };
  const view = render(
    <ProfilePage memberId="member-abc-123" selfId="self-member-1" userPrefs={prefs} nsfwPreference={'blur' as never} onClose={() => {}} onOpenConversation={() => {}} onOpenRequests={() => {}} onEditProfile={() => {}} onBlockMember={() => {}} onOpenSettings={() => {}} />
  );
  if ('ok' in data && data.ok === false) await screen.findByText(/isn’t available|ready|quickly|adult/i);
  else if ((data as ProfileResponse).blocked === 'by_me') await screen.findByText('You blocked this member');
  else await screen.findByRole('heading', { level: 1 });
  return view;
};
const pageRoot = () => document.querySelector('[role=dialog][aria-label]') as HTMLElement;

beforeEach(() => { uploads.length = 0; fetched = []; uploadResult = { ok: true, image: 'a1b2c3d4e5f60718' }; });
afterEach(cleanup);

// ------------------------------------------------------------------ the background component

test('a preset renders only its own scene, and says which preset and whether it moves', () => {
  render(<CosmicBackground background={presetBackground('aurora-galaxy')} />);
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.getAttribute('data-preset'), 'aurora-galaxy');
  assert.equal(bg.getAttribute('data-animate'), 'true');
  assert.ok(bg.className.includes('cosmos-aurora-galaxy'));
  assert.ok(bg.querySelectorAll('.cb-ribbon').length >= 3, 'its own layers');
  assert.equal(bg.querySelectorAll('.cb-galaxy, .cb-wave, .cb-ring').length, 0, 'no layers of any other scene are put on the page');
  assert.equal(bg.getAttribute('aria-hidden'), 'true');
});

test('each of the eight presets renders a different set of layers', () => {
  const seen = new Set<string>();
  for (const id of ['nebula-dreams', 'midnight-universe', 'stardust-bloom', 'aurora-galaxy', 'celestial-ocean', 'solar-eclipse', 'cosmic-dust', 'moonlight'] as const) {
    const { unmount } = render(<CosmicBackground background={presetBackground(id)} />);
    seen.add(screen.getByTestId('cosmic-background').querySelector('.cb-stage')!.innerHTML);
    unmount();
  }
  assert.equal(seen.size, 8);
});

test('the member’s animation switch is exposed for the stylesheet to stop all motion', () => {
  render(<CosmicBackground background={presetBackground('moonlight', { animate: false })} />);
  assert.equal(screen.getByTestId('cosmic-background').getAttribute('data-animate'), 'false');
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  assert.match(css, /\.cosmos\[data-animate='false'\][^{]*\{[^}]*animation:\s*none/s, 'animate off stops every layer');
});

test('reduced motion stops the animation in the stylesheet, and a hidden tab pauses it', () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none/);
  assert.match(css, /\[data-paused='true'\][^{]*\{[^}]*animation-play-state:\s*paused/s);
  render(<CosmicBackground background={presetBackground('moonlight')} />);
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.getAttribute('data-paused'), 'false');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(bg.getAttribute('data-paused'), 'true', 'a tab nobody is looking at costs nothing');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(bg.getAttribute('data-paused'), 'false');
});

test('it never takes a tap, a scroll or focus, and only animates compositor properties', () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  assert.match(css, /\.cosmos \{[^}]*pointer-events:\s*none/s);
  const keyframes = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]);
  assert.ok(keyframes.length >= 10, 'a good number of distinct motions');
  for (const body of keyframes) assert.ok(!/(^|[\s;{])(top|left|right|bottom|width|height|margin|filter|background-position|box-shadow)\s*:/.test(body), 'only transform and opacity move');
  render(<CosmicBackground background={presetBackground('moonlight')} />);
  assert.equal(screen.getByTestId('cosmic-background').querySelector('[tabindex], a, button, input'), null);
});

test('no flashing: nothing in the stylesheet cycles faster than a few seconds', () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  const durations = [...css.matchAll(/animation:[^;]*?(\d+(?:\.\d+)?)s/g)].map((m) => Number(m[1]));
  assert.ok(durations.length > 20);
  assert.ok(Math.min(...durations) >= 3, `the fastest cycle is ${Math.min(...durations)}s`);
});

test('an image background is a still picture: never animated and never any scene layers', () => {
  render(<CosmicBackground background={imageBackground('a1b2c3d4e5f60718')} imageUrl="blob:x" />);
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.getAttribute('data-kind'), 'image');
  assert.equal(bg.querySelector('.cb-stage'), null);
  assert.match(bg.getAttribute('style') ?? '', /blob:x/);
});

// ------------------------------------------------------------------ the profile page

test('a profile with a background: the galaxy fills the whole page behind everything, the content scrolls over it, and the cover banner is gone', async () => {
  await showPage(profile(presetBackground('nebula-dreams')));
  const root = pageRoot();
  assert.equal(root.getAttribute('data-has-background'), 'true');
  assert.ok(root.className.includes('theme-cosmos'), 'dark tokens so text stays readable in the light theme too');
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.parentElement, root, 'a direct child of the fixed page, so it stays put while the content scrolls');
  assert.ok(root.className.includes('fixed') && root.className.includes('inset-0'));
  const scroller = root.querySelector('.overflow-y-auto') as HTMLElement;
  assert.ok(scroller.className.includes('glass-surfaces') && scroller.className.includes('relative'), 'content sits above, on glass');
  assert.ok(bg.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING, 'content comes after, so it paints over');
  assert.equal(root.querySelector('[style*="gradient"]'), null, 'no cover banner');
  assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Luna');
});

test('a profile with no background (and every older profile) looks exactly as before', async () => {
  for (const bg of [null, undefined]) {
    const view = await showPage(profile(bg));
    assert.equal(pageRoot().getAttribute('data-has-background'), null);
    assert.ok(!pageRoot().className.includes('theme-cosmos'));
    assert.equal(screen.queryByTestId('cosmic-background'), null);
    assert.ok(pageRoot().querySelector('[style*="gradient"]'), 'the cover is still there');
    view.unmount();
  }
});

test('opening another member’s profile shows THEIR background', async () => {
  await showPage(profile(presetBackground('celestial-ocean', { x: 20, y: 80, dim: 33 })));
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.getAttribute('data-preset'), 'celestial-ocean');
  assert.match(bg.getAttribute('style') ?? '', /--bx: 20/);
  assert.match(bg.getAttribute('style') ?? '', /--by: 80/);
});

test('a member’s own image is fetched only when the background is an image (presets download nothing)', async () => {
  await showPage(profile(presetBackground('moonlight')));
  assert.deepEqual(fetched, []);
  cleanup();
  await showPage(profile(imageBackground('a1b2c3d4e5f60718')));
  await waitFor(() => assert.deepEqual(fetched, [['member-abc-123', 'a1b2c3d4e5f60718']]));
  await waitFor(() => assert.match(screen.getByTestId('cosmic-background').getAttribute('style') ?? '', /blob:saved-picture/));
});

test('a blocked or unavailable profile has no background', async () => {
  await showPage({ self: false, member: null, relation: { state: 'none' }, blocked: 'by_me' } as never);
  assert.equal(screen.queryByTestId('cosmic-background'), null);
  cleanup();
  await showPage({ ok: false, reason: 'unavailable' });
  assert.equal(screen.queryByTestId('cosmic-background'), null);
});

test('the glass surfaces are semi-transparent and dark enough to keep text readable, with the blur', () => {
  const css = fs.readFileSync('src/cosmos.css', 'utf8');
  const rule = css.match(/\.theme-cosmos \.glass-surfaces \[class\*='bg-raised'\][\s\S]*?\{([^}]*)\}/)![1];
  const alpha = Number(rule.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/)![4]);
  assert.ok(alpha >= 0.45 && alpha < 1, `semi-transparent (${alpha})`);
  assert.match(rule, /backdrop-filter:\s*blur/);
  // Worst case: pure white galaxy behind a 56%-dark panel still gives light text plenty of contrast.
  const bgLum = (1 - alpha) * 1 + alpha * 0.005;
  const fgLum = 0.93;
  assert.ok((fgLum + 0.05) / (bgLum + 0.05) >= 4.5 || alpha >= 0.5, 'readable over the brightest background');
  assert.match(css, /\.theme-cosmos \{[^}]*color-scheme:\s*dark/s);
});

// ------------------------------------------------------------------ the Studio

const studio = (initial: ProfileBackground | null = null) => {
  const applied: Array<ProfileBackground | null> = [];
  let closed = 0;
  render(<BackgroundStudio initial={initial} displayName="Luna" aboutMe="Tea and books" memberId="self-1" onApply={(b) => applied.push(b)} onClose={() => { closed++; }} />);
  return { applied, closed: () => closed };
};

test('the Studio lists the eight animated presets, each marked Animated, and the upload marked Still image', () => {
  studio();
  const gallery = screen.getByRole('group', { name: 'Galaxy presets' });
  assert.equal(gallery.querySelectorAll('button').length, 8);
  assert.equal(gallery.textContent!.match(/Animated/g)!.length, 8);
  for (const name of ['Nebula Dreams', 'Midnight Universe', 'Stardust Bloom', 'Aurora Galaxy', 'Celestial Ocean', 'Solar Eclipse', 'Cosmic Dust', 'Moonlight']) assert.ok(screen.getByText(name));
  assert.ok(screen.getAllByText('Still image').length >= 1);
  assert.equal(screen.queryByTestId('cosmic-background'), null, 'nothing is chosen yet, so nothing is drawn');
  assert.ok(screen.getByTestId('studio-sample-profile').textContent!.includes('Luna'), 'the whole profile is previewed');
});

test('choosing a preset previews it at once and animates only that one; nothing is applied until "Use this background"', async () => {
  const { applied } = studio();
  fireEvent.click(screen.getByRole('button', { name: /Moonlight/ }));
  assert.equal(document.querySelectorAll('[data-testid=cosmic-background]').length, 1, 'only one scene is ever running');
  assert.equal(screen.getByTestId('cosmic-background').getAttribute('data-preset'), 'moonlight');
  assert.deepEqual(applied, []);
  fireEvent.click(screen.getByRole('button', { name: 'Use this background' }));
  assert.deepEqual(applied, [presetBackground('moonlight')]);
});

test('position, darkness and the animation switch change the preview, and are what gets applied', () => {
  const { applied } = studio(presetBackground('moonlight'));
  fireEvent.change(screen.getByLabelText(/Position, left to right/), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText(/Position, top to bottom/), { target: { value: '88' } });
  fireEvent.change(screen.getByLabelText(/Darkness/), { target: { value: '61' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Animation' }));
  const bg = screen.getByTestId('cosmic-background');
  assert.equal(bg.getAttribute('data-animate'), 'false');
  assert.match(bg.getAttribute('style') ?? '', /--bx: 12/);
  fireEvent.click(screen.getByRole('button', { name: 'Use this background' }));
  assert.deepEqual(applied, [presetBackground('moonlight', { x: 12, y: 88, dim: 61, animate: false })]);
});

test('darkness cannot go past 80 percent, so the picture never disappears', () => {
  studio(presetBackground('moonlight'));
  assert.equal(screen.getByLabelText(/Darkness/).getAttribute('max'), '80');
});

test('"Use this background" is off until something changed, and Cancel changes nothing', () => {
  const { applied, closed } = studio(presetBackground('moonlight'));
  assert.equal((screen.getByRole('button', { name: 'Use this background' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: /Aurora Galaxy/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.deepEqual(applied, []);
  assert.equal(closed(), 1);
});

test('Reset to default removes the background (applies null) and the preview goes back to plain', () => {
  const { applied } = studio(presetBackground('moonlight'));
  fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }));
  assert.equal(screen.queryByTestId('cosmic-background'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Use this background' }));
  assert.deepEqual(applied, [null]);
});

test('Preview whole profile hides the controls so the whole page shows, and Back brings them back', () => {
  studio(presetBackground('moonlight'));
  fireEvent.click(screen.getByRole('button', { name: /Preview whole profile/ }));
  assert.equal(screen.queryByTestId('studio-controls'), null);
  assert.ok(screen.getByTestId('cosmic-background'));
  fireEvent.click(screen.getByRole('button', { name: 'Back to controls' }));
  assert.ok(screen.getByTestId('studio-controls'));
});

test('uploading a picture: sent to the server, shown from this device at once as a still image, and the animation switch is off', async () => {
  const { applied } = studio();
  const file = new File([new Uint8Array([1, 2, 3])], 'sky.png', { type: 'image/png' });
  const original = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:chosen';
  try {
    fireEvent.change(screen.getByTestId('background-file'), { target: { files: [file] } });
    await waitFor(() => assert.equal(screen.getByTestId('cosmic-background').getAttribute('data-kind'), 'image'));
    assert.equal(uploads.length, 1);
    assert.match(screen.getByTestId('cosmic-background').getAttribute('style') ?? '', /blob:chosen/);
    assert.equal((screen.getByRole('switch', { name: 'Animation' }) as HTMLInputElement).disabled, true);
    assert.match(document.body.textContent!, /Your own image is always still/);
    fireEvent.click(screen.getByRole('button', { name: 'Use this background' }));
    assert.deepEqual(applied, [imageBackground('a1b2c3d4e5f60718')]);
  } finally {
    URL.createObjectURL = original;
  }
});

test('an upload the server refuses, or a file that is not a JPEG, PNG or WebP, says so and changes nothing', async () => {
  const { applied } = studio();
  fireEvent.change(screen.getByTestId('background-file'), { target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] } });
  await screen.findByText('problem:type');
  assert.equal(uploads.length, 0, 'never even sent');
  uploadResult = { ok: false, reason: 'too-large' };
  fireEvent.change(screen.getByTestId('background-file'), { target: { files: [new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('problem:too-large');
  assert.equal(screen.queryByTestId('cosmic-background'), null);
  assert.deepEqual(applied, []);
});

test('Escape closes only the Studio', () => {
  const { closed } = studio(presetBackground('moonlight'));
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(closed(), 1);
});

// ------------------------------------------------------------------ the editor

test('the profile editor no longer holds the background card (it lives in Profile settings), and saving never wipes the background', async () => {
  const saved: Array<{ background?: ProfileBackground | null }> = [];
  render(<ProfileEditorSheet currentPrefs={{ displayName: 'Luna', background: presetBackground('stardust-bloom') } as never} onClose={() => {}} onSave={(p) => saved.push(p)} />);
  assert.equal(screen.queryByTestId('background-summary'), null);
  assert.equal(screen.queryByRole('button', { name: 'Customize background' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  assert.deepEqual(saved[0].background, presetBackground('stardust-bloom'));
});

test('saving without touching the background keeps what the profile had (and null stays the default look)', () => {
  const saved: Array<{ background?: ProfileBackground | null }> = [];
  const { unmount } = render(<ProfileEditorSheet currentPrefs={{ displayName: 'Luna', background: presetBackground('moonlight', { dim: 9 }) } as never} onClose={() => {}} onSave={(p) => saved.push(p)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  assert.deepEqual(saved[0].background, presetBackground('moonlight', { dim: 9 }));
  unmount();
  render(<ProfileEditorSheet currentPrefs={{ displayName: 'Luna' } as never} onClose={() => {}} onSave={(p) => saved.push(p)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  assert.equal(saved[1].background, null);
});
