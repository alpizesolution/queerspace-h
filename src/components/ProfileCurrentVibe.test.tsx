import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { parseVibe, type VibeView } from '../utils/currentVibe.ts';
import type { ProfileResponse } from '../utils/profileView.ts';

/**
 * Current Vibe on the real profile page, with only the services replaced: your own page offers a quiet way to set one and shows
 * a live one with Edit and Remove; someone else's shows a card only when they have a live status the server let this viewer see,
 * and never an empty card; an expired status disappears; blocked and unavailable profiles never show one.
 */
const NOW = Date.now();
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const live = (over: Record<string, unknown> = {}) =>
  parseVibe({ moodId: 'healing', message: 'Taking life one day at a time.', updatedAt: iso(-2 * 3_600_000), expiresAt: iso(22 * 3_600_000), visibility: 'everyone', ...over })!;

let answer: { ok: true; data: ProfileResponse } | { ok: false; reason: string } = { ok: false, reason: 'failed' };
const removed: number[] = [];
let removeOk = true;
let publishAs: VibeView | null = null;
const published: unknown[] = [];

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
    removeCurrentVibe: async () => { removed.push(1); return removeOk ? { ok: true, vibe: null } : { ok: false, reason: 'failed' }; },
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

beforeEach(() => { removed.length = 0; published.length = 0; removeOk = true; publishAs = null; });
afterEach(cleanup);

test('another member with a live status: the card shows the mood, the message and the times, with no actions', async () => {
  await show(profile({ currentVibe: live() }));
  const card = within(await screen.findByTestId('current-vibe'));
  assert.ok(card.getByText('Healing'));
  assert.ok(card.getByText('“Taking life one day at a time.”'));
  assert.ok(card.getByText('Updated 2 hours ago · Expires in 22 hours'));
  assert.equal(card.queryByRole('button'), null, 'no Edit or Remove on someone else\'s');
  assert.equal(screen.queryByTestId('set-current-vibe'), null, 'no prompt to set one on someone else\'s page');
});

test('another member with no status (or one the server hid): nothing at all, never an empty card or a prompt', async () => {
  await show(profile({ currentVibe: null }));
  assert.equal(screen.queryByTestId('current-vibe'), null);
  assert.equal(screen.queryByTestId('set-current-vibe'), null);
  assert.equal(screen.queryByText(/Current Vibe/), null);
});

test('an older server answer with no status field at all shows nothing and nothing breaks', async () => {
  const { currentVibe: _gone, ...older } = profile();
  await show(older as ProfileResponse);
  assert.equal(screen.queryByTestId('current-vibe'), null);
  assert.ok(screen.getByText('Tea and books'));
});

test('an expired status is not shown, even if the answer still carries it', async () => {
  await show(profile({ currentVibe: live({ expiresAt: iso(-1000) }) }));
  assert.equal(screen.queryByTestId('current-vibe'), null);
});

test('your own page without a status offers a quiet way to set one, and opens the editor', async () => {
  await show(profile({ self: true, currentVibe: null }));
  fireEvent.click(await screen.findByTestId('set-current-vibe'));
  assert.ok(screen.getByRole('dialog', { name: 'Current Vibe' }));
  assert.equal(screen.getAllByRole('radio').filter((r) => r.getAttribute('role') === 'radio' && r.getAttribute('aria-checked') !== null).length, 14);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByRole('dialog', { name: 'Current Vibe' }), null, 'cancel closes without saving');
  assert.equal(published.length, 0);
});

test('publishing from your own page puts the status on it straight away', async () => {
  publishAs = live({ moodId: 'grateful', message: 'Thank you all', updatedAt: iso(0), expiresAt: iso(24 * 3_600_000) });
  await show(profile({ self: true, currentVibe: null }));
  fireEvent.click(await screen.findByTestId('set-current-vibe'));
  fireEvent.click(screen.getByRole('radio', { name: /Grateful/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Current Vibe' }), null));
  const card = within(await screen.findByTestId('current-vibe'));
  assert.ok(card.getByText('Grateful'));
  assert.ok(card.getByText('“Thank you all”'));
  assert.equal(screen.queryByTestId('set-current-vibe'), null);
  assert.equal(screen.queryByRole('dialog', { name: 'Current Vibe' }), null);
});

test('your own live status shows Edit Mood, Remove Mood and who can see it; Edit opens the editor on it', async () => {
  await show(profile({ self: true, currentVibe: live({ visibility: 'connections' }) }));
  const card = within(await screen.findByTestId('current-vibe'));
  assert.ok(card.getByText(/Visible to: Approved connections only/));
  fireEvent.click(card.getByRole('button', { name: /Edit Mood/ }));
  assert.equal(screen.getByRole('radio', { name: /Healing/ }).getAttribute('aria-checked'), 'true');
  assert.equal((screen.getByRole('radio', { name: /Approved connections only/ }) as HTMLInputElement).checked, true);
});

test('Remove Mood takes it off the page and the prompt comes back; a failure leaves it and says so', async () => {
  await show(profile({ self: true, currentVibe: live() }));
  removeOk = false;
  fireEvent.click(within(await screen.findByTestId('current-vibe')).getByRole('button', { name: /Remove Mood/ }));
  await waitFor(() => assert.equal(removed.length, 1));
  assert.ok(await screen.findByText('problem:failed'));
  assert.ok(screen.getByTestId('current-vibe'), 'still there after a failed removal');
  removeOk = true;
  fireEvent.click(within(screen.getByTestId('current-vibe')).getByRole('button', { name: /Remove Mood/ }));
  assert.ok(await screen.findByTestId('set-current-vibe'));
  assert.equal(screen.queryByTestId('current-vibe'), null);
  assert.ok(screen.getByText('Current Vibe removed.'));
});

test('a blocked member\'s profile and an unavailable one never show a status', async () => {
  await show({ self: false, member: null, relation: { state: 'none' }, blocked: 'by_me' } as ProfileResponse, /You blocked this member/);
  assert.equal(screen.queryByTestId('current-vibe'), null);
  assert.equal(screen.queryByTestId('set-current-vibe'), null);
  cleanup();
  await show({ ok: false, reason: 'unavailable' }, /This profile isn’t available/);
  assert.equal(screen.queryByTestId('current-vibe'), null);
});
