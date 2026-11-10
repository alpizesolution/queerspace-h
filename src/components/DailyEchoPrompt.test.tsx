import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UnsaidPost } from '../services/unsaidService.ts';

const realUnsaid = await import('../services/unsaidService.ts');
const realCommunity = await import('../services/communityService.ts');
const posted: unknown[][] = [];

mock.module('../services/unsaidService.ts', {
  namedExports: {
    ...realUnsaid,
    isUnsaidAvailable: () => true,
    subscribeToUnsaid: (onPosts: (p: UnsaidPost[], m: { nextBefore: number | null }) => void) => { setTimeout(() => onPosts([], { nextBefore: null }), 0); return () => {}; },
    loadMyUnsaidIds: async () => [],
    postUnsaid: async (...args: unknown[]) => { posted.push(args); return 'posted'; },
  },
});
mock.module('../services/communityService.ts', { namedExports: { ...realCommunity, fetchIsCommunityAdmin: async () => false } });

const { UnsaidView } = await import('./UnsaidView.tsx');
const { dailyEchoPrompt } = await import('../utils/dailyEchoPrompt.ts');

beforeEach(() => { posted.length = 0; try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

const box = () => screen.getByLabelText('Write something unsaid') as HTMLTextAreaElement;
const todays = () => dailyEchoPrompt().text;
const cardAction = () => within(screen.getByRole('region', { name: "Today's Echo" })).getByRole('button', { name: 'Write an Echo' });

test("the Today's Echo card shows today's prompt", async () => {
  render(<UnsaidView />);
  assert.equal((await screen.findByTestId('daily-echo-prompt')).textContent, todays());
});

test("the card's button opens the composer with the prompt filled in, and it can be edited and posted", async () => {
  render(<UnsaidView />);
  await screen.findByTestId('daily-echo-prompt');
  fireEvent.click(cardAction());
  assert.ok(box().value.startsWith(todays()));
  fireEvent.change(box(), { target: { value: `${todays()}\n\nHonestly, it took me years.` } });
  fireEvent.click(screen.getByRole('button', { name: 'Let it out' }));
  await waitFor(() => assert.equal(posted.length, 1));
  assert.match(String(posted[0][1]), /took me years/);
});

test('the prefilled text can be removed entirely and a different category chosen', async () => {
  render(<UnsaidView />);
  await screen.findByTestId('daily-echo-prompt');
  fireEvent.click(cardAction());
  fireEvent.change(box(), { target: { value: '' } });
  assert.equal(box().value, '');
  assert.equal((screen.getByRole('button', { name: 'Let it out' }) as HTMLButtonElement).disabled, true, 'nothing is forced: an empty box cannot post');
  fireEvent.change(box(), { target: { value: 'Just my own words' } });
  fireEvent.click(screen.getByRole('radio', { name: /Little Win/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Let it out' }));
  await waitFor(() => assert.equal(posted.length, 1));
  assert.equal(posted[0][0], 'wins');
  assert.equal(posted[0][1], 'Just my own words');
});

test('the Write an Echo header button still opens a blank composer, even after a prompt was inserted and dismissed', async () => {
  render(<UnsaidView />);
  await screen.findByTestId('daily-echo-prompt');
  fireEvent.click(cardAction());
  assert.ok(box().value.length > 0);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  const header = screen.getAllByRole('button', { name: /Write an Echo/ }).find((b) => !b.closest('section'))!;
  fireEvent.click(header);
  assert.equal(box().value, '', 'blank, not the old prompt');
});

test('a draft the member already typed is kept when they use the prompt button', async () => {
  render(<UnsaidView />);
  await screen.findByTestId('daily-echo-prompt');
  const header = screen.getAllByRole('button', { name: /Write an Echo/ }).find((b) => !b.closest('section'))!;
  fireEvent.click(header);
  fireEvent.change(box(), { target: { value: 'my own unfinished thought' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(cardAction());
  assert.equal(box().value, 'my own unfinished thought');
});
