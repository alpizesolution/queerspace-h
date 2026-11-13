import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Header } from './Header.tsx';

/**
 * The profile button goes straight to the member's own full profile page. There is no "My profile" preview sheet, no "View my
 * public profile" step, and no second profile screen: one ProfilePage, with owner controls only on the owner's own page.
 */
afterEach(cleanup);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const header = (calls: string[]) => render(
  <Header
    onNavigate={() => {}} currentView="home" isSoundMuted={false} onToggleSound={() => {} }
    onOpenSafetyModal={() => {}} onOpenProfile={() => calls.push('profile')} onOpenSettings={() => {}} onOpenWhatsNew={() => {}}
    onOpenInfo={() => {}} onOpenSupport={() => {}} profile={{ avatar: undefined, displayName: 'Luna' }}
  />
);

test('the avatar button in the header opens the profile directly (one action, no intermediate screen)', () => {
  const calls: string[] = [];
  header(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
  assert.deepEqual(calls, ['profile']);
});

test('the menu entry goes to the same place and is named for what it opens', () => {
  const calls: string[] = [];
  header(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'My profile' }));
  assert.deepEqual(calls, ['profile']);
  assert.equal(screen.queryByRole('button', { name: 'Edit profile' }), null);
});

test('the "My profile" preview sheet is gone: no component, no "View my public profile", no duplicate Edit profile in a sheet', () => {
  assert.equal(fs.existsSync('src/components/ProfilePageSheet.tsx'), false);
  const files = fs.readdirSync('src/components').filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
  for (const file of files) {
    const source = read(`src/components/${file}`);
    assert.equal(source.includes('ProfilePageSheet'), false, `${file} does not use the sheet`);
    assert.equal(source.includes('View my public profile'), false, `${file} has no "View my public profile" step`);
  }
  assert.equal(read('src/App.tsx').includes('ProfilePageSheet'), false);
  assert.equal(/profileOpen\b|setProfileOpen/.test(read('src/App.tsx')), false, 'no state left for the sheet');
});

test('the app opens the member\'s own profile page with the existing openProfile, and only starts the editor when no profile is saved yet', () => {
  const app = read('src/App.tsx');
  assert.match(app, /onOpenProfile=\{openOwnProfile\}/);
  const open = app.slice(app.indexOf('const openOwnProfile'), app.indexOf('/** Profile settings get their own history entry'));
  assert.match(open, /const ownId = auth\?\.currentUser\?\.uid;/);
  assert.match(open, /if \(userPrefs\.profileComplete !== true\) \{ setProfileEditOpen\(true\)/);
  assert.match(open, /openProfile\(ownId\);/);
  // One ProfilePage for everyone: the same component renders other members and the owner, with owner controls decided inside it.
  assert.equal((app.match(/<ProfilePage\b/g) ?? []).length, 1);
  assert.match(app, /memberId=\{profileMemberId\}[\s\S]*selfId=\{auth\?\.currentUser\?\.uid \?\? null\}/);
});

test('saving the profile returns to the actual profile page, not a preview sheet', () => {
  const app = read('src/App.tsx');
  const save = app.slice(app.indexOf('const handleSaveProfile'), app.indexOf('/** Saves only the profile background'));
  assert.match(save, /const ownId = auth\?\.currentUser\?\.uid;\s*if \(ownId\) openProfile\(ownId\);/);
});

test('browser back: the profile has its own history entry, settings add another, and Back closes only settings', () => {
  const app = read('src/App.tsx');
  assert.match(app, /window\.history\.pushState\(\{ qsProfile: profileMemberId, qsSettings: true \}, ''\)/);
  assert.match(app, /if \(window\.history\.state\?\.qsSettings\) window\.history\.back\(\);\s*else setProfileSettingsOpen\(false\);/);
  assert.match(app, /setProfileSettingsOpen\(state\?\.qsSettings === true\);/, 'a Back or Forward sets settings from the entry itself');
  assert.match(app, /window\.history\.go\(-2\)/, 'leaving to an editor undoes both entries');
  assert.match(app, /onClose=\{closeProfileSettings\}/);
  assert.match(app, /onOpenProfileSettings=\{openProfileSettings\}/);
});

test('owner controls stay on the owner\'s page only (the gear is offered by the page to the owner, never to a visitor)', () => {
  const page = read('src/components/ProfilePage.tsx');
  const owner = page.slice(page.indexOf('{isSelf && ('), page.indexOf('<h1'));
  assert.match(owner, /Edit profile/);
  assert.match(owner, /onOpenProfileSettings && <button/);
  assert.match(owner, /Share profile/);
  assert.equal(page.slice(page.indexOf('<h1')).includes('aria-label="Profile settings"'), false);
});
