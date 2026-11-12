import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { parseVibe, type VibeView } from '../utils/currentVibe.ts';

/**
 * The "My profile" sheet (what the Profile button in the header and menu opens) now shows the member's own Current Vibe: the card
 * with Edit and Remove when it is live, a quiet prompt when it is not, and nothing until the profile is finished (publishing needs it).
 */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'self-member-1', getIdToken: async () => 't' } }, db: null } });
let stored: VibeView | null = null;
let removeOk = true;
const removed: number[] = [];
mock.module('../services/currentVibeService.ts', {
  namedExports: {
    fetchMemberVibe: async () => stored,
    removeCurrentVibe: async () => { removed.push(1); return removeOk ? { ok: true, vibe: null } : { ok: false, reason: 'failed' }; },
    publishCurrentVibe: async () => ({ ok: true, vibe: stored }),
    clearVibeCache: () => {},
    vibeProblemText: (reason: string) => `problem:${reason}`,
  },
});
const { ProfilePageSheet } = await import('./ProfilePageSheet.tsx');

const NOW = Date.now();
const live = (over: Record<string, unknown> = {}) =>
  parseVibe({ moodId: 'healing', message: 'One day at a time', updatedAt: new Date(NOW - 3_600_000).toISOString(), expiresAt: new Date(NOW + 23 * 3_600_000).toISOString(), visibility: 'everyone', ...over })!;
const prefs = (over: Record<string, unknown> = {}) => ({ displayName: 'Luna', pronouns: 'she/her', profileComplete: true, intention: 'friendship', aboutMe: '', ...over }) as never;
const show = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  render(<ProfilePageSheet currentPrefs={prefs(over)} onClose={() => {}} onEditProfile={() => {}} onEditPreferences={() => {}} {...extra} />);

beforeEach(() => { stored = null; removeOk = true; removed.length = 0; });
afterEach(cleanup);

test('with no live status the sheet offers a quiet way to set one, and it opens the editor', async () => {
  show();
  fireEvent.click(await screen.findByTestId('set-current-vibe'));
  assert.ok(await screen.findByRole('radiogroup', { name: 'Choose a mood' }));
});

test('a live status shows as a card with Edit Mood, Remove Mood and who can see it', async () => {
  stored = live({ visibility: 'connections' });
  show();
  const card = within(await screen.findByTestId('current-vibe'));
  assert.ok(card.getByText('Healing'));
  assert.ok(card.getByText('“One day at a time”'));
  assert.ok(card.getByText(/Visible to: Approved connections only/));
  assert.ok(card.getByRole('button', { name: /Edit Mood/ }));
  assert.ok(card.getByRole('button', { name: /Remove Mood/ }));
});

test('an expired status is not shown, only the prompt', async () => {
  stored = live({ expiresAt: new Date(NOW - 1000).toISOString() });
  show();
  await screen.findByTestId('set-current-vibe');
  assert.ok(screen.queryByTestId('current-vibe') === null);
});

test('Remove Mood takes it off and brings the prompt back; a failure leaves it and says so', async () => {
  stored = live();
  show();
  removeOk = false;
  fireEvent.click(within(await screen.findByTestId('current-vibe')).getByRole('button', { name: /Remove Mood/ }));
  assert.ok(await screen.findByText('problem:failed'));
  assert.ok(screen.queryByTestId('current-vibe') !== null, 'still there after a failed removal');
  removeOk = true;
  fireEvent.click(within(screen.getByTestId('current-vibe')).getByRole('button', { name: /Remove Mood/ }));
  await screen.findByTestId('set-current-vibe');
  assert.equal(removed.length, 2);
  assert.ok(screen.queryByTestId('current-vibe') === null);
});

test('Edit Mood opens the editor on the current status', async () => {
  stored = live({ moodId: 'lonely', message: 'quiet night' });
  show();
  fireEvent.click(within(await screen.findByTestId('current-vibe')).getByRole('button', { name: /Edit Mood/ }));
  assert.equal((await screen.findByRole('radio', { name: /Lonely/ })).getAttribute('aria-checked'), 'true');
});

test('until the profile is finished there is no Current Vibe section (publishing needs a finished profile)', async () => {
  show({ profileComplete: false });
  await waitFor(() => assert.ok(screen.queryByText('Finish your profile') !== null));
  assert.ok(screen.queryByTestId('my-profile-current-vibe') === null);
  assert.ok(screen.queryByTestId('set-current-vibe') === null);
});

test('"View my public profile" opens the page other members see, and is absent when it cannot', async () => {
  const calls: string[] = [];
  const view = show({}, { onViewPublicProfile: () => calls.push('open') });
  fireEvent.click(await screen.findByRole('button', { name: /View my public profile/ }));
  assert.deepEqual(calls, ['open']);
  view.unmount();
  show();
  await screen.findByTestId('set-current-vibe');
  assert.ok(screen.queryByRole('button', { name: /View my public profile/ }) === null);
});
