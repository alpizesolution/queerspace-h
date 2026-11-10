import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UnsaidPost } from '../services/unsaidService.ts';

const realUnsaid = await import('../services/unsaidService.ts');
const realCommunity = await import('../services/communityService.ts');
const posted: unknown[][] = [];
let feed: UnsaidPost[] = [];

mock.module('../services/unsaidService.ts', {
  namedExports: {
    ...realUnsaid,
    isUnsaidAvailable: () => true,
    subscribeToUnsaid: (onPosts: (p: UnsaidPost[], m: { nextBefore: number | null }) => void) => { setTimeout(() => onPosts(feed, { nextBefore: null }), 0); return () => {}; },
    loadMyUnsaidIds: async () => [],
    postUnsaid: async (...args: unknown[]) => { posted.push(args); return 'posted'; },
  },
});
mock.module('../services/communityService.ts', { namedExports: { ...realCommunity, fetchIsCommunityAdmin: async () => false } });

const { UnsaidView } = await import('./UnsaidView.tsx');

const echo = (id: string, over: Partial<UnsaidPost> = {}): UnsaidPost => ({
  id, kind: 'vent', text: `Echo ${id}`, createdAt: Date.now() - 60_000, replyCount: 0, moodTags: [], expiresAt: null, hugs: 0, same: 0, felt: 0, strong: 0, proud: 0, cry: 0, flags: 0, ...over,
});
beforeEach(() => { posted.length = 0; feed = []; try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

const box = () => screen.getByLabelText('Write something unsaid') as HTMLTextAreaElement;
const openComposer = async () => {
  render(<UnsaidView />);
  await screen.findByTestId('daily-echo-prompt');
  fireEvent.click(screen.getAllByRole('button', { name: /Write an Echo/ }).find((b) => !b.closest('section'))!);
};
const moodList = () => within(screen.getByRole('group', { name: 'Moods' }));
const send = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Let it out' }));
  await waitFor(() => assert.equal(posted.length, 1));
};

test('publishing without a mood sends none', async () => {
  await openComposer();
  await send('no mood today');
  assert.equal(posted[0][1], 'no mood today');
  assert.deepEqual(posted[0][2], []);
});

test('publishing with one mood, and with two', async () => {
  await openComposer();
  fireEvent.click(screen.getByRole('button', { name: 'Add a mood' }));
  fireEvent.click(moodList().getByRole('button', { name: /Hopeful/ }));
  await send('one mood');
  assert.deepEqual(posted[0][2], ['hopeful']);
  cleanup(); posted.length = 0;
  await openComposer();
  fireEvent.click(screen.getByRole('button', { name: 'Add a mood' }));
  fireEvent.click(moodList().getByRole('button', { name: /In Love/ }));
  fireEvent.click(moodList().getByRole('button', { name: /Feeling Myself/ }));
  await send('two moods');
  assert.deepEqual(posted[0][2], ['in-love', 'feeling-myself']);
});

test('a third mood cannot be picked; removing one, or swapping, makes room', async () => {
  await openComposer();
  fireEvent.click(screen.getByRole('button', { name: 'Add a mood' }));
  fireEvent.click(moodList().getByRole('button', { name: /Happy/ }));
  fireEvent.click(moodList().getByRole('button', { name: /Silly/ }));
  const chill = moodList().getByRole('button', { name: /Chill/ }) as HTMLButtonElement;
  assert.equal(chill.disabled, true);
  fireEvent.click(chill);
  assert.equal(screen.queryByRole('button', { name: 'Remove mood Chill' }), null, 'the third was not added');
  // Remove Happy from the chosen pills, then Chill can be chosen.
  fireEvent.click(screen.getByRole('button', { name: 'Remove mood Happy' }));
  assert.equal((moodList().getByRole('button', { name: /Chill/ }) as HTMLButtonElement).disabled, false);
  fireEvent.click(moodList().getByRole('button', { name: /Chill/ }));
  await send('swapped');
  assert.deepEqual(posted[0][2], ['silly', 'chill']);
});

test('moods are cleared after posting, so the next Echo starts without one', async () => {
  await openComposer();
  fireEvent.click(screen.getByRole('button', { name: 'Add a mood' }));
  fireEvent.click(moodList().getByRole('button', { name: /Proud/ }));
  await send('first');
  await waitFor(() => assert.equal(screen.queryByLabelText('Write something unsaid'), null));
  fireEvent.click(screen.getAllByRole('button', { name: /Write an Echo/ }).find((b) => !b.closest('section'))!);
  assert.equal(screen.queryByRole('button', { name: 'Remove mood Proud' }), null);
});

test('published Echoes show their moods as small pills; Echoes without moods show no mood section at all', async () => {
  feed = [echo('with', { moodTags: ['hopeful', 'proud'] }), echo('older')];
  render(<UnsaidView />);
  const withMoods = (await screen.findByText('Echo with')).closest('li') as HTMLElement;
  const pills = within(within(withMoods).getByTestId('mood-pills'));
  assert.ok(pills.getByText('Hopeful') && pills.getByText('Proud'));
  const older = screen.getByText('Echo older').closest('li') as HTMLElement;
  assert.equal(within(older).queryByTestId('mood-pills'), null);
  assert.equal(within(older).queryByLabelText('Moods'), null);
});

test('moods change nothing about the card: the category tag, reactions and reply control are the same', async () => {
  feed = [echo('adv', { kind: 'advice', moodTags: ['vulnerable'] })];
  render(<UnsaidView />);
  const card = (await screen.findByText('Echo adv')).closest('li') as HTMLElement;
  assert.ok(within(card).getByText('Need Advice'));
  assert.ok(within(card).getByRole('button', { name: /^Reply$|\d+ repl/i }));
  assert.equal(within(card).getAllByRole('button').filter((b) => /, \d+$/.test(b.getAttribute('aria-label') ?? '')).length, 6);
});
