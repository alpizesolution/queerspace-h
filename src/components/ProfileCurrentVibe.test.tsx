import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { parseVibe, type VibeView } from '../utils/currentVibe.ts';
import type { ProfileResponse } from '../utils/profileView.ts';

/**
 * The custom status on the real profile page, with only the services replaced: a small bubble beside the avatar when there is a live
 * status the server let this viewer see; on your own page a quiet "Add status" pill when there is none; never an empty bubble, never a
 * pill on someone else's page; an expired status disappears; blocked and unavailable profiles never show one.
 */
const NOW = Date.now();
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const live = (over: Record<string, unknown> = {}) =>
  parseVibe({ emoji: '🦋', message: 'healing quietly', updatedAt: iso(-2 * 3_600_000), expiresAt: iso(22 * 3_600_000), visibility: 'everyone', ...over })!;

let answer: { ok: true; data: ProfileResponse } | { ok: false; reason: string } = { ok: false, reason: 'failed' };
let removeOk = true;
let publishAs: VibeView | null = null;
const published: unknown[] = [];
let removed = 0;

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
mock.module('../services/currentVibeService.ts', {
  namedExports: {
    publishCurrentVibe: async (input: unknown) => { published.push(input); return { ok: true, vibe: publishAs }; },
    removeCurrentVibe: async () => { removed++; return removeOk ? { ok: true, vibe: null } : { ok: false, reason: 'failed' }; },
    fetchMemberVibe: async () => null,
    clearVibeCache: () => {},
    vibeProblemText: (reason: string) => `problem:${reason}`,
  },
});
const { ProfilePage } = await import('./ProfilePage.tsx');

const member = { id: 'member-abc-123', displayName: 'Luna', pronouns: 'she/her', avatar: null, about: 'Tea and books', vibe: null, style: null, intention: null, interests: [], location: null, orientation: null, identity: null, expression: [], showsAge: false };
const profile = (over: Partial<ProfileResponse> = {}): ProfileResponse => ({ self: false, member, relation: { state: 'none' }, blocked: null, currentVibe: null, ...over });
const prefs = { showAgeOnProfile: false, showLocationOnProfile: true, showSexualOrientationOnProfile: false, showGenderIdentityOnProfile: false, showGenderExpressionOnProfile: false } as never;

const show = async (data: ProfileResponse | { ok: false; reason: string }, waitFor: 'profile' | RegExp = 'profile') => {
  answer = 'ok' in data ? data : { ok: true, data };
  render(
    <ProfilePage memberId="member-abc-123" selfId="self-member-1" userPrefs={prefs} nsfwPreference={'blur' as never} onClose={() => {}} onOpenConversation={() => {}} onOpenRequests={() => {}} onEditProfile={() => {}} onBlockMember={() => {}} onOpenSettings={() => {}} />
  );
  if (waitFor === 'profile') await screen.findByRole('heading', { level: 1 });
  else await screen.findByText(waitFor);
};
const none = (id: string) => assert.ok(screen.queryByTestId(id) === null, `no ${id}`);

beforeEach(() => { removed = 0; published.length = 0; removeOk = true; publishAs = null; });
afterEach(cleanup);

test('another member with a live status: a small bubble beside their avatar with the emoji and the words, and no card, heading or time on the page', async () => {
  await show(profile({ currentVibe: live() }));
  const bubble = await screen.findByTestId('vibe-bubble');
  assert.match(bubble.textContent ?? '', /🦋/);
  assert.match(bubble.textContent ?? '', /healing quietly/);
  none('current-vibe');
  assert.ok(screen.queryByText(/Current Vibe/i) === null, 'no section heading');
  assert.ok(screen.queryByText(/Updated 2 hours ago|Expires in/) === null, 'no time line on the page');
  none('add-status');
});

test('the bubble sits in the avatar block, off to its right at the top, with a width that fits the screen', async () => {
  await show(profile({ currentVibe: live() }));
  const holder = (await screen.findByTestId('vibe-bubble')).closest('.absolute') as HTMLElement;
  assert.ok(holder, 'positioned relative to the avatar');
  assert.match(holder.className, /left-\[calc\(100%\+0\.5rem\)\]/, 'to the right of the avatar, not over it');
  assert.match(holder.className, /-top-1\.5/, 'a little above the avatar top, so it clears the buttons below');
  assert.match(holder.className, /max-w-\[calc\(100vw-7\.5rem\)\]/, 'never wider than the screen minus the avatar and the margins');
  assert.ok(holder.parentElement!.querySelector('img, svg, [class*="rounded-full"]') !== null, 'the avatar is in the same block');
});

test('another member with no status (or one the server hid): nothing at all, never an empty bubble or a pill', async () => {
  await show(profile({ currentVibe: null }));
  none('vibe-bubble');
  none('add-status');
  assert.ok(screen.queryByText(/status/i) === null);
});

test('an older server answer with no status field at all shows nothing and nothing breaks', async () => {
  const { currentVibe: _gone, ...older } = profile();
  await show(older as ProfileResponse);
  none('vibe-bubble');
  assert.ok(screen.getByText('Tea and books'));
});

test('an expired status is not shown, even if the answer still carries it', async () => {
  await show(profile({ currentVibe: live({ expiresAt: iso(-1000) }) }));
  none('vibe-bubble');
});

test('tapping a long message on someone else\'s bubble spreads it out, and the page stays usable', async () => {
  await show(profile({ currentVibe: live({ message: 'x'.repeat(60) }) }));
  const bubble = await screen.findByTestId('vibe-bubble');
  fireEvent.click(bubble);
  assert.equal(bubble.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('Tea and books'));
});

test('your own page without a status offers a small "Add status" pill, and it opens the editor', async () => {
  await show(profile({ self: true, currentVibe: null }));
  fireEvent.click(await screen.findByTestId('add-status'));
  assert.ok(await screen.findByLabelText('Your status message'));
  assert.ok(screen.getByTestId('emoji-picker'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => assert.ok(document.querySelector('[role=dialog][aria-labelledby]') === null));
  assert.equal(published.length, 0, 'cancel saves nothing');
});

test('saving from your own page puts the bubble beside your avatar straight away', async () => {
  publishAs = live({ emoji: '💜', message: 'feeling loved', updatedAt: iso(0), expiresAt: iso(24 * 3_600_000) });
  await show(profile({ self: true, currentVibe: null }));
  fireEvent.click(await screen.findByTestId('add-status'));
  fireEvent.click(screen.getByRole('button', { name: 'Use 💜' }));
  fireEvent.change(screen.getByLabelText('Your status message'), { target: { value: 'feeling loved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => assert.ok(document.querySelector('[role=dialog][aria-labelledby]') === null));
  const bubble = await screen.findByTestId('vibe-bubble');
  assert.match(bubble.textContent ?? '', /feeling loved/);
  none('add-status');
  assert.deepEqual(published, [{ emoji: '💜', message: 'feeling loved', visibility: 'everyone' }]);
  assert.ok(screen.getByText('Status saved.'));
});

test('on your own page a tap on your bubble opens the editor on it, and Clear takes it away and brings the pill back', async () => {
  await show(profile({ self: true, currentVibe: live({ visibility: 'connections' }) }));
  fireEvent.click(await screen.findByTestId('vibe-bubble'));
  assert.equal((await screen.findByLabelText('Your status message') as HTMLInputElement).value, 'healing quietly');
  assert.equal((screen.getByRole('radio', { name: /Approved connections only/ }) as HTMLInputElement).checked, true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await screen.findByTestId('add-status');
  assert.equal(removed, 1);
  none('vibe-bubble');
  assert.ok(screen.getByText('Status cleared.'));
});

test('a failed clear leaves the status and says so', async () => {
  removeOk = false;
  await show(profile({ self: true, currentVibe: live() }));
  fireEvent.click(await screen.findByTestId('vibe-bubble'));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
  assert.ok(await screen.findByText('problem:failed'));
  assert.equal(within(document.body).queryAllByTestId('vibe-bubble').length >= 1, true, 'still there');
});

test('your own page keeps its other actions: Edit profile and Share are still there beside the bubble', async () => {
  await show(profile({ self: true, currentVibe: live() }));
  assert.ok(await screen.findByRole('button', { name: /Edit profile/ }));
  assert.ok(screen.getByRole('button', { name: 'Share profile' }));
  assert.ok(screen.getByTestId('vibe-bubble'));
});

test('a blocked member\'s profile and an unavailable one never show a status', async () => {
  await show({ self: false, member: null, relation: { state: 'none' }, blocked: 'by_me' } as ProfileResponse, /You blocked this member/);
  none('vibe-bubble');
  none('add-status');
  cleanup();
  await show({ ok: false, reason: 'unavailable' }, /This profile isn’t available/);
  none('vibe-bubble');
});
