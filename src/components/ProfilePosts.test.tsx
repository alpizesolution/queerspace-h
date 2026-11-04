import '../../test/dom-setup.ts';
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommunityPost } from '../types.ts';

/**
 * The real ProfilePosts, rendered and clicked. Only the service that talks to Firestore is replaced, with answers the tests
 * control, so what is checked is what a member would see: a loading state, a list, "No public posts yet" only after a
 * successful empty answer, an error with a retry, and a card that opens the original post.
 */
type Outcome = { ok: true; page: { posts: CommunityPost[]; cursor: unknown; done: boolean } } | { ok: false; reason: 'failed' };
let answers: Array<() => Promise<Outcome>> = [];
const asked: Array<{ memberId: string; after: unknown }> = [];

mock.module('../services/profileViewService.ts', {
  namedExports: {
    peekMemberPostsFirstPage: () => null,
    fetchMemberCommunityPosts: (memberId: string, after: unknown = null) => {
      asked.push({ memberId, after });
      const next = answers.shift();
      if (!next) throw new Error('unexpected request for posts');
      return next();
    },
  },
});

const { ProfilePosts } = await import('./ProfileSections.tsx');
const { ProfileNavProvider } = await import('./ProfileNav.tsx');

const post = (id: string, title: string, over: Partial<CommunityPost> = {}): CommunityPost => ({
  id, authorId: 'ana-member-1', author: 'Ana', authorPronouns: 'she/her', category: 'general', title, content: `About ${title}`,
  timestamp: Date.now() - 60_000, likes: 0, stardustCount: 0, replyCount: 2, replies: [], tags: [], ...over,
});
const page = (posts: CommunityPost[], done = true): Outcome => ({ ok: true, page: { posts, cursor: posts.at(-1) ?? null, done } });
const later = <T,>(value: T, ms = 5) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const show = (openPost = (_id: string) => {}) =>
  render(
    <ProfileNavProvider value={{ openProfile: () => {}, openPost }}>
      <ProfilePosts memberId="ana-member-1" />
    </ProfileNavProvider>
  );

afterEach(() => { cleanup(); answers = []; asked.length = 0; });

test('while posts are loading the member sees a loading state, never "No public posts yet"', async () => {
  let finish!: (o: Outcome) => void;
  answers = [() => new Promise<Outcome>((resolve) => { finish = resolve; })];
  show();
  assert.ok(screen.getByRole('status', { name: 'Loading posts' }));
  assert.equal(screen.queryByText('No public posts yet'), null);
  finish(page([post('p1aaaaaaaa', 'First')]));
  await screen.findByText('First');
  assert.equal(screen.queryByRole('status', { name: 'Loading posts' }), null);
});

test('several posts are listed in the order given (newest first), with their reply counts', async () => {
  answers = [() => later(page([post('p3aaaaaaaa', 'Third'), post('p2aaaaaaaa', 'Second'), post('p1aaaaaaaa', 'First')]))];
  show();
  await screen.findByText('Third');
  const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  assert.deepEqual(titles, ['Third', 'Second', 'First']);
  assert.equal(screen.queryByText('No public posts yet'), null);
  assert.equal(screen.queryByText(/Couldn’t load posts/), null);
});

test('a member with no posts: "No public posts yet" appears only after the request succeeded', async () => {
  let finish!: (o: Outcome) => void;
  answers = [() => new Promise<Outcome>((resolve) => { finish = resolve; })];
  show();
  assert.equal(screen.queryByText('No public posts yet'), null, 'not before the answer');
  finish(page([]));
  await screen.findByText('No public posts yet');
  assert.ok(screen.getByText('Their shared posts will appear here.'));
  assert.equal(screen.queryByRole('button', { name: /try again/i }), null, 'an empty profile is not an error');
});

test('a failed request is an error with a retry, never "No public posts yet"; retrying can then succeed', async () => {
  answers = [() => later<Outcome>({ ok: false, reason: 'failed' }), () => later(page([post('p1aaaaaaaa', 'Recovered')]))];
  show();
  await screen.findByText(/Couldn’t load posts/);
  assert.equal(screen.queryByText('No public posts yet'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Recovered');
  assert.equal(screen.queryByText(/Couldn’t load posts/), null);
  assert.equal(asked.length, 2);
  assert.deepEqual(asked.map((a) => a.after), [null, null], 'the retry asks for the first page again');
});

test('clicking a post opens the original post by its own id, from the card and from the keyboard', async () => {
  const opened: string[] = [];
  answers = [() => later(page([post('abcdEFGH1234ijkl5678', 'Open me')]))];
  show((id) => opened.push(id));
  const card = await screen.findByRole('link', { name: 'Open post: Open me' });
  fireEvent.click(card);
  fireEvent.keyDown(card, { key: 'Enter' });
  assert.deepEqual(opened, ['abcdEFGH1234ijkl5678', 'abcdEFGH1234ijkl5678']);
});

test('more than a page: "Show more" adds the next page after the first, without losing it', async () => {
  const first = [post('p3aaaaaaaa', 'Third'), post('p2aaaaaaaa', 'Second')];
  answers = [() => later(page(first, false)), () => later(page([post('p1aaaaaaaa', 'First')], true))];
  show();
  await screen.findByText('Third');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  await screen.findByText('First');
  assert.deepEqual(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent), ['Third', 'Second', 'First']);
  assert.equal(screen.queryByRole('button', { name: 'Show more' }), null, 'nothing more to show');
  assert.equal(asked[1].after, first[1], 'the second request continues after the last post shown');
});

test('a failed "Show more" keeps the posts already shown and offers a retry', async () => {
  answers = [() => later(page([post('p2aaaaaaaa', 'Second')], false)), () => later<Outcome>({ ok: false, reason: 'failed' })];
  show();
  await screen.findByText('Second');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  await waitFor(() => assert.ok(screen.getByText(/Couldn’t load posts/)));
  assert.ok(screen.getByText('Second'), 'the list stays');
  assert.equal(screen.queryByText('No public posts yet'), null);
});
