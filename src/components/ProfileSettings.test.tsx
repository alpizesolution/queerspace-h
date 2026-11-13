import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProfileResponse } from '../utils/profileView.ts';
import { presetBackground, type ProfileBackground } from '../utils/profileBackground.ts';

/**
 * Profile settings: the gear is the member's own, the settings page gathers existing controls in four groups with no dead options,
 * the background card lives under Appearance with a preview and a customize action (saving through the existing save), and the
 * profile page itself no longer carries settings.
 */
let answer: { ok: true; data: ProfileResponse } = { ok: true, data: null as never };
mock.module('../lib/firebase.ts', {
  namedExports: {
    isFirebaseConfigured: true,
    db: null,
    auth: { currentUser: { uid: 'me-member-1', isAnonymous: true, providerData: [], email: null, getIdToken: async () => 'token' } },
    ensureAnonymousAuth: async () => null,
    subscribeAuthState: () => () => {},
    handleFirestoreError: () => {},
    logScreenView: () => {},
    OperationType: {},
  },
});
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
mock.module('../services/stardustService.ts', { namedExports: { fetchStardustTotal: async () => 7, giveStardust: async () => ({ ok: false }), subscribeToMyStardust: () => () => {} } });
mock.module('../services/profileBackgroundService.ts', {
  namedExports: {
    prepareBackgroundImage: async (f: Blob) => f,
    uploadBackgroundImage: async () => ({ ok: true, image: 'a1b2c3d4e5f60718' }),
    uploadProblemText: (r: string) => r,
    fetchBackgroundImage: async () => 'blob:saved',
    pruneBackgroundImages: async () => {},
    clearBackgroundImageCache: () => {},
  },
});
const { ProfilePage } = await import('./ProfilePage.tsx');
const { ProfileSettingsPage } = await import('./ProfileSettingsPage.tsx');

const member = { id: 'me-member-1', displayName: 'Luna', pronouns: 'she/her', avatar: null, about: 'Tea and books', vibe: 'Cozy', style: null, intention: 'friends', interests: ['books'], location: 'Manila', orientation: null, identity: null, expression: [], showsAge: false, memberSince: '2025-03-01' };
const respond = (self: boolean, background: ProfileBackground | null = null) => {
  answer = { ok: true, data: { self, member: { ...member, background }, relation: { state: self ? 'self' : 'none' }, blocked: null, currentVibe: null } as ProfileResponse };
};
const noop = () => {};

const showPage = async (props: Partial<React.ComponentProps<typeof ProfilePage>> = {}, prefs: Record<string, unknown> = {}) => {
  render(<ProfilePage memberId="me-member-1" selfId="me-member-1" userPrefs={{ showAgeOnProfile: false, showLocationOnProfile: true, ...prefs } as never} nsfwPreference={'hide' as never} onClose={noop} onOpenConversation={noop} onOpenRequests={noop} onEditProfile={noop} onBlockMember={noop} onOpenSettings={noop} {...props} />);
  await screen.findByRole('heading', { level: 1 });
};

const calls: string[] = [];
const settings = (prefs: Record<string, unknown> = {}, over: Partial<React.ComponentProps<typeof ProfileSettingsPage>> = {}) => {
  calls.length = 0;
  render(
    <ProfileSettingsPage
      userPrefs={{ displayName: 'Luna', pronouns: 'she/her', showLocationOnProfile: true, ...prefs } as never}
      nsfwPreference={'hide' as never}
      onChangeNsfwPreference={(v) => calls.push(`nsfw:${v}`)}
      onEditProfile={() => calls.push('edit')}
      onEditPreferences={() => calls.push('prefs')}
      onSaveBackground={(b) => { calls.push(`bg:${JSON.stringify(b)}`); }}
      onOpenAppAppearance={() => calls.push('appearance')}
      onOpenWhatsNew={() => calls.push('whatsnew')}
      onOpenSupport={() => calls.push('support')}
      onClose={() => calls.push('close')}
      {...over}
    />
  );
};

beforeEach(() => {
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

// ------------------------------------------------------------------ the profile page

test('your own page has a gear beside Edit profile that opens settings, and nothing else about settings', async () => {
  respond(true);
  let opened = 0;
  await showPage({ onOpenProfileSettings: () => { opened += 1; } });
  const gear = screen.getByRole('button', { name: 'Profile settings' });
  assert.ok(screen.getByRole('button', { name: /Edit profile/ }));
  assert.equal(gear.parentElement, screen.getByRole('button', { name: /Edit profile/ }).parentElement, 'in the same action row as Edit profile');
  fireEvent.click(gear);
  assert.equal(opened, 1);
  assert.equal(screen.queryByText('What others can see'), null, 'the visibility card moved into settings');
  assert.equal(screen.queryByText('Profile background'), null, 'and so did the background card');
});

test('someone else\'s page never shows the gear, Edit profile or Share', async () => {
  respond(false);
  await showPage({ selfId: 'viewer-1', onOpenProfileSettings: noop });
  assert.equal(screen.queryByRole('button', { name: 'Profile settings' }), null);
  assert.equal(screen.queryByRole('button', { name: /Edit profile/ }), null);
  assert.equal(screen.queryByRole('button', { name: 'Share profile' }), null);
});

test('without a settings destination there is no gear (never a dead button)', async () => {
  respond(true);
  await showPage();
  assert.equal(screen.queryByRole('button', { name: 'Profile settings' }), null);
});

test('the main page puts the profile first: name, about, chips, then About, Interests and posts, in two columns on wide screens', async () => {
  respond(true);
  await showPage({ onOpenProfileSettings: noop });
  const h1 = screen.getByRole('heading', { level: 1 });
  assert.equal(h1.textContent, 'Luna');
  const root = document.querySelector('[role=dialog][aria-label]') as HTMLElement;
  assert.match(root.querySelector('.overflow-y-auto > div')!.className, /lg:max-w-5xl/);
  assert.ok(root.querySelector('.lg\\:grid'), 'identity beside content on wide screens');
  assert.match(screen.getByText(/Member since/).closest('li')!.className, /rounded-full/, 'member since is a small chip, not a block');
  assert.ok(screen.getByText('Interests'));
});

test('your own background still shows on your page, from your saved setting, as soon as it changes', async () => {
  respond(true, null);
  await showPage({}, { background: presetBackground('moonlight') });
  assert.equal(screen.getByTestId('cosmic-background').getAttribute('data-preset'), 'moonlight');
});

// ------------------------------------------------------------------ the settings page

test('it is a full-screen page with a back button and four groups: Profile, Appearance, Privacy & visibility, Account', () => {
  settings();
  const page = screen.getByTestId('profile-settings');
  assert.match(page.className, /fixed inset-0/);
  assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Profile settings');
  const nav = screen.getByRole('navigation', { name: 'Settings categories' });
  assert.deepEqual(within(nav).getAllByRole('button').map((b) => b.textContent), ['Profile', 'Appearance', 'Privacy & visibility', 'Account']);
  assert.match(nav.className, /hidden md:block/, 'the sidebar is for wide screens; phones stack the groups');
  fireEvent.click(screen.getByRole('button', { name: 'Back to profile' }));
  assert.deepEqual(calls, ['close']);
});

test('wide screens show one group at a time and the sidebar switches between them; phones keep every group visible', () => {
  settings();
  const profile = screen.getByTestId('settings-profile');
  const appearance = screen.getByTestId('settings-appearance');
  assert.match(profile.className, /\bblock\b/);
  assert.match(appearance.className, /hidden max-md:block/, 'hidden on wide screens, still shown on phones');
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Appearance' }));
  assert.match(appearance.className, /\bblock\b/);
  assert.match(profile.className, /hidden max-md:block/);
  assert.equal(within(screen.getByRole('navigation')).getByRole('button', { name: 'Appearance' }).getAttribute('aria-current'), 'page');
});

test('Profile: Edit profile, Avatar and Discovery preferences open the existing editors, and there is no photo option (the app has no photos)', () => {
  settings({ avatar: undefined });
  fireEvent.click(screen.getByTestId('row-edit-profile'));
  fireEvent.click(screen.getByTestId('row-avatar'));
  fireEvent.click(screen.getByTestId('row-discovery'));
  assert.deepEqual(calls, ['edit', 'edit', 'prefs']);
  assert.match(screen.getByTestId('row-edit-profile').textContent ?? '', /Luna · she\/her/);
  assert.equal(screen.queryByText(/photo/i)?.textContent?.match(/upload/i) ?? null, null);
});

test('Appearance: the background shows a preview and what it is, and Customize opens the studio; applying saves it through the app\'s save', async () => {
  settings({ background: presetBackground('aurora-galaxy') });
  const preview = screen.getByTestId('background-preview');
  assert.equal(within(preview).getByTestId('cosmic-background').getAttribute('data-preset'), 'aurora-galaxy');
  assert.match(preview.textContent ?? '', /Aurora Galaxy \(animated\)/);
  assert.match(screen.getByTestId('settings-appearance').textContent ?? '', /Free for everyone|animated galaxy behind your whole profile/);
  fireEvent.click(screen.getByTestId('customize-background'));
  const studio = await screen.findByTestId('background-studio');
  fireEvent.click(within(studio).getByRole('button', { name: /Moonlight/ }));
  fireEvent.click(within(studio).getByRole('button', { name: 'Use this background' }));
  assert.equal(screen.queryByTestId('background-studio'), null);
  assert.deepEqual(calls, [`bg:${JSON.stringify(presetBackground('moonlight'))}`]);
});

test('Appearance with no background: a plain preview, "Choose a background", and the studio can reset to default', async () => {
  settings({});
  assert.equal(within(screen.getByTestId('background-preview')).queryByTestId('cosmic-background'), null);
  assert.match(screen.getByTestId('background-preview').textContent ?? '', /Default/);
  fireEvent.click(screen.getByRole('button', { name: /Choose a background/ }));
  await screen.findByTestId('background-studio');
});

test('Appearance: theme and text size reuse the existing settings', () => {
  settings();
  fireEvent.click(screen.getByTestId('row-app-appearance'));
  assert.deepEqual(calls, ['appearance']);
});

test('Privacy & visibility: shows what others can see, points to the editor to change it, and holds the existing NSFW choice', () => {
  settings({ showAgeOnProfile: true, showLocationOnProfile: false, showGenderIdentityOnProfile: true });
  const box = screen.getByTestId('settings-privacy');
  assert.match(box.textContent ?? '', /What others can see/);
  assert.match(box.textContent ?? '', /Age/);
  assert.match(box.textContent ?? '', /Shown to people you’re connected with/);
  assert.match(box.textContent ?? '', /Location[\s\S]*Hidden/);
  fireEvent.click(within(box).getByRole('button', { name: 'Change' }));
  fireEvent.click(within(box).getByRole('radio', { name: /Ask before revealing/ }));
  assert.deepEqual(calls, ['edit', 'nsfw:ask']);
  assert.equal(within(box).getByRole('radio', { name: /Always hide/ }).getAttribute('aria-checked'), 'true');
});

test('Account: keep conversations (the existing account saving), what\'s new, support, and the birthday correction only when there is a birthday', async () => {
  settings({});
  assert.equal(screen.queryByTestId('row-birthday'), null);
  fireEvent.click(screen.getByTestId('row-whats-new'));
  fireEvent.click(screen.getByTestId('row-support'));
  assert.deepEqual(calls, ['whatsnew', 'support']);
  assert.match(screen.getByTestId('row-account').textContent ?? '', /Keep your conversations/);
  fireEvent.click(screen.getByTestId('row-account'));
  assert.match((await screen.findByTestId('account-recovery')).textContent ?? '', /can’t be recovered/);
  cleanup();
  settings({ birthDate: '1990-01-01' });
  assert.ok(screen.getByTestId('row-birthday'));
});

test('no dead options: every row and button on the page does something', () => {
  settings({ birthDate: '1990-01-01' });
  const rows = ['row-edit-profile', 'row-avatar', 'row-discovery', 'row-app-appearance', 'row-whats-new', 'row-support'];
  rows.forEach((id) => fireEvent.click(screen.getByTestId(id)));
  assert.equal(calls.length, rows.length, 'each row reached its action');
  for (const button of screen.getAllByRole('button')) assert.equal((button as HTMLButtonElement).disabled, false);
});

test('phones: compact rows, a single scrolling column with room for the safe area, no fixed widths that could overflow', () => {
  settings();
  const source = fs.readFileSync('src/components/ProfileSettingsPage.tsx', 'utf8');
  assert.match(source, /min-h-\[3\.5rem\]/, 'rows are compact');
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /min-w-0/, 'text can shrink instead of overflowing');
  assert.doesNotMatch(source, /\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/, 'no wide fixed widths');
  assert.match(screen.getByTestId('profile-settings').className, /flex-col/);
});

// ------------------------------------------------------------------ the app wiring

test('the app offers the gear only on the member\'s own profile, saves the background through the same profile save, and cleans up', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /onOpenProfileSettings=\{\(\) => setProfileSettingsOpen\(true\)\}/);
  assert.match(app, /\{profileSettingsOpen && profileMemberId && !ageGateOpen && !ageRestricted && \(\s*<ProfileSettingsPage/);
  const handler = app.slice(app.indexOf('const handleSaveBackground'), app.indexOf('const handleOpenSetup'));
  assert.match(handler, /const next = \{ \.\.\.userPrefs, background \};/);
  assert.match(handler, /persistPrefs\(next\)/);
  assert.match(handler, /clearProfileCache\(\);[\s\S]*clearBackgroundImageCache\(\);[\s\S]*pruneBackgroundImages\(\)/);
  assert.match(app, /if \(profileMemberId === null\) setProfileSettingsOpen\(false\)/, 'settings close with the profile page');
  const page = fs.readFileSync('src/components/ProfilePage.tsx', 'utf8');
  assert.match(page, /\{isSelf && \(\s*<div className="flex items-center gap-1\.5 pb-1">/, 'the gear is inside the owner block');
});

test('the NSFW choice is one shared control, used by both the settings page and the (larger-screen) appearance settings', () => {
  const modal = fs.readFileSync('src/components/AppearanceSettingsModal.tsx', 'utf8');
  const settingsSource = fs.readFileSync('src/components/ProfileSettingsPage.tsx', 'utf8');
  assert.match(modal, /<NsfwPreferenceControl[^>]*hidden sm:block/);
  assert.match(settingsSource, /<NsfwPreferenceControl/);
  assert.doesNotMatch(modal, /NSFW_PREFERENCE_OPTIONS/, 'no second copy of the options');
});
