import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LookingForPost } from '../utils/lookingFor.ts';

/** The real Looking For board, rendered: NSFW posts show in full with their badge, others look as before. */
const realService = await import('../services/lookingForService.ts');
let feed: LookingForPost[] = [];

mock.module('../services/lookingForService.ts', {
  namedExports: {
    ...realService,
    isLookingForAvailable: () => true,
    subscribeToLookingFor: (_category: string, onPosts: (p: LookingForPost[], uid: string | null) => void) => { setTimeout(() => onPosts(feed, 'me'), 0); return () => {}; },
  },
});
const realStardust = await import('../hooks/useStardust.ts');
mock.module('../hooks/useStardust.ts', {
  namedExports: { ...realStardust, useStardust: () => ({ given: {}, pending: {}, error: null, clearError: () => {}, countFor: (_id: string, base: number) => base, toggle: async () => {} }) },
});

// jsdom has no element scrolling; the category chips ask for it.
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { LookingForView } = await import('./LookingForView.tsx');

const post = (over: Partial<LookingForPost> = {}): LookingForPost => ({
  id: 'u1_dating', authorId: 'u1', author: 'Willow', authorPronouns: 'she/her', title: 'Coffee and long walks', age: 27, flair: 'All WLW',
  intro: 'Intro text that is easy to find. ' + 'x'.repeat(90), lookingFor: 'Seeking text that is easy to find. ' + 'y'.repeat(90), intention: 'dating', tags: ['books'], isNsfw: false, contentWarning: null,
  requestsPaused: false, timestamp: Date.now() - 60_000, ...over,
});

const prefs = { displayName: 'Me', pronouns: 'she/her', intention: 'open', topics: [], region: 'Anywhere', birthDate: '1995-01-01', profileComplete: true } as never;
const board = (preference: 'hide' | 'ask' | 'confirm' = 'hide') =>
  render(<LookingForView userPrefs={prefs} blockedPartnerIds={[]} nsfwPreference={preference} />);

beforeEach(() => { feed = []; try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

const articleOf = (title: string) => screen.getByText(title).closest('article') as HTMLElement;

for (const preference of ['hide', 'ask', 'confirm'] as const) {
  test(`NSFW post, content setting "${preference}": the whole post shows, with its NSFW badge and no cover or reveal`, async () => {
    feed = [post({ id: 'u2_nsfw', authorId: 'u2', title: 'Spicy title', intention: 'nsfw', isNsfw: true, contentWarning: 'Adult themes' })];
    board(preference);
    const card = articleOf(await screen.findByText('Spicy title').then(() => 'Spicy title'));
    assert.ok(within(card).getByText(/Intro text that is easy to find/), 'About me is visible');
    assert.ok(within(card).getByText(/Seeking text that is easy to find/), 'About you is visible');
    assert.ok(within(card).getByText('NSFW'), 'the NSFW badge is visible');
    assert.equal(within(card).queryByText(/Sensitive content/i), null);
    assert.equal(within(card).queryByRole('button', { name: /Reveal content/i }), null);
    assert.equal(within(card).queryByRole('button', { name: /Hide again/i }), null);
    assert.equal(card.querySelector('.blur, [class*="blur-"]'), null, 'nothing is blurred');
    assert.ok(within(card).getByRole('button', { name: 'Send connection signal' }), 'the Signal action is there');
  });
}

test('a non-NSFW post looks as it did: content visible, no NSFW badge', async () => {
  feed = [post()];
  board();
  const card = articleOf(await screen.findByText('Coffee and long walks').then(() => 'Coffee and long walks'));
  assert.ok(within(card).getByText(/Intro text that is easy to find/));
  assert.equal(within(card).queryByText('NSFW'), null);
});

test('only NSFW posts get the badge when both kinds are on the board', async () => {
  feed = [post({ id: 'a_dating', authorId: 'a', title: 'Plain post' }), post({ id: 'b_nsfw', authorId: 'b', title: 'Marked post', intention: 'nsfw', isNsfw: true })];
  board();
  await screen.findByText('Plain post');
  assert.ok(within(articleOf('Marked post')).getByText('NSFW'));
  assert.equal(within(articleOf('Plain post')).queryByText('NSFW'), null);
});

test('the "Leave out" mature filter still removes NSFW posts from the board, as before', async () => {
  feed = [post({ id: 'a_dating', authorId: 'a', title: 'Plain post' }), post({ id: 'b_nsfw', authorId: 'b', title: 'Marked post', intention: 'nsfw', isNsfw: true })];
  board();
  await screen.findByText('Plain post');
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Leave out' }));
  assert.equal(screen.queryByText('Marked post'), null);
  assert.ok(screen.getByText('Plain post'));
});

test('a member\'s own NSFW post shows in full too, with its badge and the same menu', async () => {
  feed = [post({ id: 'me_nsfw', authorId: 'me', title: 'My own post', intention: 'nsfw', isNsfw: true })];
  board();
  const card = articleOf(await screen.findByText('My own post').then(() => 'My own post'));
  assert.ok(within(card).getByText('NSFW'));
  assert.ok(within(card).getByText(/Intro text that is easy to find/));
  fireEvent.click(within(card).getByRole('button', { name: /More for/ }));
  assert.ok(screen.getByRole('menuitem', { name: /Edit/ }));
});
