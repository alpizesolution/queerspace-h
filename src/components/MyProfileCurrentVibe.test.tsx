import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseVibe, type VibeView } from '../utils/currentVibe.ts';

/**
 * The "My profile" sheet (what the Profile button in the header and menu opens) shows the member's own status as a small bubble under
 * their name, or a quiet "Add status" pill: no card. Nothing until the profile is finished (saving a status needs it).
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
  parseVibe({ emoji: '🌙', message: 'taking it slow', updatedAt: new Date(NOW - 3_600_000).toISOString(), expiresAt: new Date(NOW + 23 * 3_600_000).toISOString(), visibility: 'everyone', ...over })!;
const prefs = (over: Record<string, unknown> = {}) => ({ displayName: 'Luna', pronouns: 'she/her', profileComplete: true, intention: 'friendship', aboutMe: '', ...over }) as never;
const show = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  render(<ProfilePageSheet currentPrefs={prefs(over)} onClose={() => {}} onEditProfile={() => {}} onEditPreferences={() => {}} {...extra} />);
const absent = (id: string) => assert.ok(screen.queryByTestId(id) === null, `no ${id}`);

beforeEach(() => { stored = null; removeOk = true; removed.length = 0; });
afterEach(cleanup);

test('with no live status the sheet offers a small "Add status" pill, and it opens the editor', async () => {
  show();
  fireEvent.click(await screen.findByTestId('add-status'));
  assert.ok(await screen.findByLabelText('Your status message'));
});

test('a live status shows as a small bubble under the name: the emoji and the words, no card, no heading, no time', async () => {
  stored = live();
  show();
  const bubble = await screen.findByTestId('vibe-bubble');
  assert.match(bubble.textContent ?? '', /🌙/);
  assert.match(bubble.textContent ?? '', /taking it slow/);
  absent('current-vibe');
  assert.ok(screen.queryByText(/Visible to|Updated .* ago|Expires in|Clears in/) === null);
  assert.ok(screen.queryByText(/^Current Vibe$/i) === null);
});

test('an expired status is not shown, only the pill', async () => {
  stored = live({ expiresAt: new Date(NOW - 1000).toISOString() });
  show();
  await screen.findByTestId('add-status');
  absent('vibe-bubble');
});

test('tapping the bubble opens the editor on it, and Clear removes it and brings the pill back', async () => {
  stored = live({ visibility: 'connections' });
  show();
  fireEvent.click(await screen.findByTestId('vibe-bubble'));
  assert.equal(((await screen.findByLabelText('Your status message')) as HTMLInputElement).value, 'taking it slow');
  assert.equal((screen.getByRole('radio', { name: /Approved connections only/ }) as HTMLInputElement).checked, true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await screen.findByTestId('add-status');
  assert.equal(removed.length, 1);
  absent('vibe-bubble');
});

test('a failed clear leaves the status in place and says so', async () => {
  stored = live();
  removeOk = false;
  show();
  fireEvent.click(await screen.findByTestId('vibe-bubble'));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
  assert.ok(await screen.findByText('problem:failed'));
  assert.ok(screen.queryAllByTestId('vibe-bubble').length >= 1, 'the status is still there (the editor shows a second, preview one)');
});

test('until the profile is finished there is no status control (saving one needs a finished profile)', async () => {
  show({ profileComplete: false });
  await waitFor(() => assert.ok(screen.queryByText('Finish your profile') !== null));
  absent('my-profile-current-vibe');
  absent('add-status');
});

test('"View my public profile" opens the page other members see, and is absent when it cannot', async () => {
  const calls: string[] = [];
  const view = show({}, { onViewPublicProfile: () => calls.push('open') });
  fireEvent.click(await screen.findByRole('button', { name: /View my public profile/ }));
  assert.deepEqual(calls, ['open']);
  view.unmount();
  show();
  await screen.findByTestId('add-status');
  assert.ok(screen.queryByRole('button', { name: /View my public profile/ }) === null);
});
