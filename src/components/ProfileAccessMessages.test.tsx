import '../../test/dom-setup.ts';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * When the server will not show a profile, the page says what is actually wrong and offers the way out.
 *
 * The server refuses (403) when it holds no adult birthday for the VIEWER, or when the viewer's account is paused. Both used to
 * read "Profiles are for adult members / It may have been removed, or it isn't shared with you" with only a Back button, which
 * left an adult member whose birthday had never reached the server (a refused name, a failed save, a new anonymous account on a
 * phone that still held the old profile) with no explanation and nothing to do. The birthday now reaches the server on its own.
 */
let answer: { ok: false; reason: string } = { ok: false, reason: 'failed' };
let loads = 0;
mock.module('../services/profileViewService.ts', {
  namedExports: {
    clearProfileCache: () => {},
    fetchMemberAge: async () => null,
    fetchMemberLookingForPosts: async () => [],
    fetchMemberProfile: async () => { loads++; return answer; },
    peekMemberProfile: () => null,
    prefetchMemberPosts: () => {},
    shareMemberProfile: async () => 'copied',
    peekMemberPostsFirstPage: () => null,
    fetchMemberCommunityPosts: async () => ({ ok: true, page: { posts: [], cursor: null, done: true } }),
  },
});
mock.module('../services/stardustService.ts', { namedExports: { fetchStardustTotal: async () => null, giveStardust: async () => ({ ok: false }), subscribeToMyStardust: () => () => {} } });
mock.module('../services/currentVibeService.ts', {
  namedExports: { publishCurrentVibe: async () => ({ ok: false }), removeCurrentVibe: async () => ({ ok: false }), fetchMemberVibe: async () => null, clearVibeCache: () => {}, vibeProblemText: () => '' },
});
const { ProfilePage } = await import('./ProfilePage.tsx');

const SELF = 'self-member-1';
const prefs = { showAgeOnProfile: false, showLocationOnProfile: true } as never;
const edits: string[] = [];
const show = async (reason: string, memberId: string, title: RegExp) => {
  answer = { ok: false, reason };
  loads = 0;
  render(
    <ProfilePage memberId={memberId} selfId={SELF} userPrefs={prefs} nsfwPreference={'blur' as never} onClose={() => {}} onOpenConversation={() => {}} onOpenRequests={() => {}} onEditProfile={() => edits.push('edit')} onBlockMember={() => {}} onOpenSettings={() => {}} />,
  );
  await screen.findByText(title);
};
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
afterEach(() => { cleanup(); edits.length = 0; });

test('no birthday on the server: the page says the account needs finishing, and offers the editor and another try', async () => {
  await show('forbidden', 'member-abc-123', /Finish setting up your account/);
  assert.ok(screen.getByText(/couldn’t confirm your birthday on this account yet/));
  assert.equal(screen.queryByText(/Profiles are for adult members/), null);
  assert.equal(screen.queryByText(/may have been removed/), null, 'nothing was removed; the problem is on the viewer’s own account');
  fireEvent.click(screen.getByRole('button', { name: 'Save my profile' }));
  assert.deepEqual(edits, ['edit']);
  const before = loads;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  assert.equal(loads, before + 1, 'Try again asks the server again');
  assert.ok(screen.getByRole('button', { name: 'Back' }));
});

test('a paused account is told it is paused, not that profiles are for adults', async () => {
  await show('suspended', 'member-abc-123', /Your account is paused/);
  assert.ok(screen.getByText(/while the team reviews a report/));
  assert.equal(screen.queryByRole('button', { name: 'Save my profile' }), null, 'saving the profile would not help');
  assert.equal(screen.queryByRole('button', { name: 'Try again' }), null);
});

test('your own profile that never reached the server says so and opens the editor; someone else’s keeps the old words', async () => {
  await show('unavailable', SELF, /Your profile isn’t saved yet/);
  assert.ok(screen.getByText(/If your name is taken, choose another or tap the dice/));
  fireEvent.click(screen.getByRole('button', { name: 'Save my profile' }));
  assert.deepEqual(edits, ['edit']);
  cleanup();
  await show('unavailable', 'member-abc-123', /This profile isn’t available/);
  assert.ok(screen.getByText(/may have been removed, or it isn’t shared with you/));
  assert.equal(screen.queryByRole('button', { name: 'Save my profile' }), null);
});

test('the two meanings of a refusal are told apart from what the server answered', () => {
  const service = read('src/services/profileViewService.ts');
  assert.match(service, /response\.status === 403\) \{[\s\S]*?body\?\.error === 'account_unavailable' \? 'suspended' : 'forbidden'/);
  const api = read('api/_profiles.js');
  assert.match(api, /!isAdultMember\(viewerSettings\.data\(\)\)\) throw fail\(403, 'not_allowed'\)/);
  assert.match(api, /viewerSuspended\.exists\) throw fail\(403, 'account_unavailable'\)/);
});

test('an adult birthday held only on the device is sent on its own: at startup, and when a profile save does not reach the cloud', () => {
  const app = read('src/App.tsx');
  assert.match(app, /loadAnonymousProfile\(\)\.then\(\(res\) => \{[\s\S]*?!res\.cloudHasBirthDate && isAdultBirthDate\(res\.prefs\.birthDate\) && getStorageItem\('queerspace_age_restricted'\) !== 'true'[\s\S]*?saveBirthDateOnly\(res\.prefs\.birthDate\)[\s\S]*?if \(!res\.fromCloudSuccess\) return;/,
    'before the early return, so a brand-new account with nothing in the cloud is covered');
  assert.match(app, /withBirthDate && !feedback\.savedToCloud && await saveBirthDateOnly\(toSave\.birthDate\)/, 'a refused name no longer holds the birthday back');
  assert.match(app, /res\.cloudHasProfile === false \? null : cloudProfileSignature/, 'a birthday-only record does not make the profile look already saved');
  const persistence = read('src/services/profilePersistence.ts');
  const body = persistence.slice(persistence.indexOf('export async function saveBirthDateOnly'), persistence.indexOf('export async function loadAnonymousProfile'));
  assert.match(body, /birthDate instanceof Timestamp\) return true;/, 'a birthday the cloud already holds is never rewritten');
  assert.doesNotMatch(body, /'public'|displayName/, 'only the private record is written; the profile and the name are untouched');
});

test('with no connection to the cloud, the birthday sync quietly does nothing', async () => {
  const { saveBirthDateOnly } = await import('../services/profilePersistence.ts');
  assert.equal(await saveBirthDateOnly(undefined), false);
});
