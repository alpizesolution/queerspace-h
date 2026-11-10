import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UnsaidPost } from '../services/unsaidService.ts';
import type { EchoNotification } from '../services/echoNotificationService.ts';

const realUnsaid = await import('../services/unsaidService.ts');
const realCommunity = await import('../services/communityService.ts');
const realNotes = await import('../services/echoNotificationService.ts');

let feed: UnsaidPost[] = [];
let fetchable: UnsaidPost | null = null;
const fetched: string[] = [];

mock.module('../services/unsaidService.ts', {
  namedExports: {
    ...realUnsaid,
    isUnsaidAvailable: () => true,
    subscribeToUnsaid: (onPosts: (p: UnsaidPost[], m: { nextBefore: number | null }) => void) => { setTimeout(() => onPosts(feed, { nextBefore: null }), 0); return () => {}; },
    loadMyUnsaidIds: async () => [],
    subscribeToUnsaidReplies: (_id: string, onReplies: (r: never[]) => void) => { setTimeout(() => onReplies([]), 0); return () => {}; },
    loadMyReplyIds: async () => [],
  },
});
mock.module('../services/communityService.ts', { namedExports: { ...realCommunity, fetchIsCommunityAdmin: async () => false } });
mock.module('../services/echoNotificationService.ts', {
  namedExports: { ...realNotes, fetchUnsaidPost: async (id: string) => { fetched.push(id); return fetchable; } },
});

const { UnsaidView } = await import('./UnsaidView.tsx');
const { EchoNotificationsSheet } = await import('./EchoNotificationsSheet.tsx');

const post = (id: string, kind: UnsaidPost['kind'] = 'advice', over: Partial<UnsaidPost> = {}): UnsaidPost => ({
  id, kind, text: `Echo ${id}`, createdAt: Date.now() - 60_000, replyCount: 0, moodTags: [], expiresAt: null, hugs: 0, same: 0, felt: 0, strong: 0, proud: 0, cry: 0, flags: 0, ...over,
});
const note = (id: string, over: Partial<EchoNotification> = {}): EchoNotification => ({
  id, type: 'reply', postId: 'p1', kind: 'advice', preview: 'Be gentle with yourself', threshold: null, at: Date.now() - 5 * 60_000, createdAt: Date.now() - 5 * 60_000, read: false, ...over,
});

beforeEach(() => { feed = []; fetchable = null; fetched.length = 0; try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

const api = (items: EchoNotification[], over: Record<string, unknown> = {}) => {
  const calls = { read: [] as string[], all: 0, more: 0, prefs: [] as unknown[], post: [] as string[] };
  const value = {
    items, unread: items.filter((n) => !n.read).length, loaded: true, hasMore: false, loadingMore: false,
    prefs: { replies: true, milestones: true },
    setPrefs: (p: unknown) => { calls.prefs.push(p); },
    markRead: (id: string) => { calls.read.push(id); },
    markAllRead: () => { calls.all++; },
    markPostRead: (id: string) => { calls.post.push(id); },
    loadMore: async () => { calls.more++; },
    ...over,
  };
  return { value: value as never, calls };
};

// ------------------------------------------------------------------------------------------------------------- the list
const sheet = (items: EchoNotification[], over: Record<string, unknown> = {}, handlers: Record<string, unknown> = {}) => {
  const spies = { open: [] as EchoNotification[], read: [] as string[], all: 0, more: 0, prefs: [] as unknown[] };
  render(
    <EchoNotificationsSheet
      items={items} unread={items.filter((n) => !n.read).length} loaded hasMore={false} loadingMore={false} prefs={{ replies: true, milestones: true }}
      onClose={() => {}} onOpen={(n) => spies.open.push(n)} onMarkRead={(id) => spies.read.push(id)} onMarkAll={() => { spies.all++; }} onLoadMore={() => { spies.more++; }} onPrefs={(p) => spies.prefs.push(p)}
      {...(over as object)} {...(handlers as object)}
    />
  );
  return spies;
};

test('the list shows each notification with its icon text, category, safe preview, time and an unread marker; newest first as given', () => {
  sheet([note('a', { kind: 'wins', preview: 'So proud of you' }), note('b', { type: 'milestone', kind: 'vent', threshold: 25, preview: '', read: true, at: Date.now() - 3 * 3_600_000 })]);
  const rows = screen.getAllByRole('listitem');
  assert.equal(rows.length, 2);
  assert.ok(within(rows[0]).getByText('New reply on your Little Win'));
  assert.ok(within(rows[0]).getByText('“So proud of you”'));
  assert.ok(within(rows[0]).getByText('Little Win'));
  assert.ok(within(rows[0]).getByText('5m ago'));
  assert.ok(within(rows[0]).getByRole('img', { name: 'Unread' }));
  assert.ok(within(rows[1]).getByText('Your Vent reached 25 reactions'));
  assert.ok(within(rows[1]).getByText('3h ago'));
  assert.equal(within(rows[1]).queryByRole('img', { name: 'Unread' }), null, 'a read one has no marker');
});

test('an empty list says so', () => {
  sheet([]);
  assert.ok(screen.getByText('No notifications yet'));
  assert.equal((screen.getByRole('button', { name: 'Mark all as read' }) as HTMLButtonElement).disabled, true);
});

test('mark one as read, and mark all as read', () => {
  const spies = sheet([note('a'), note('b'), note('c', { read: true })]);
  assert.equal(screen.getAllByRole('button', { name: 'Mark as read' }).length, 2, 'a read one offers nothing');
  fireEvent.click(screen.getAllByRole('button', { name: 'Mark as read' })[1]);
  assert.deepEqual(spies.read, ['b']);
  fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
  assert.equal(spies.all, 1);
});

test('clicking a notification opens it; older ones load on request', () => {
  const spies = sheet([note('a')], { hasMore: true });
  fireEvent.click(screen.getByRole('button', { name: /New reply on your Need Advice/ }));
  assert.equal(spies.open[0].id, 'a');
  fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
  assert.equal(spies.more, 1);
});

test('the two preference switches are there and report changes', () => {
  const spies = sheet([note('a')]);
  fireEvent.click(screen.getByRole('button', { name: 'Notification settings' }));
  const replies = screen.getByRole('switch', { name: 'Replies to my Echoes' }) as HTMLInputElement;
  const milestones = screen.getByRole('switch', { name: 'Reaction milestones' }) as HTMLInputElement;
  assert.equal(replies.checked, true);
  assert.equal(screen.queryByRole('switch', { name: /comfort/i }), null, 'no comfort switch: there is no comfort feature');
  fireEvent.click(replies);
  assert.deepEqual(spies.prefs[0], { replies: false, milestones: true });
  fireEvent.click(milestones);
  assert.deepEqual(spies.prefs[1], { replies: true, milestones: false });
});

// ------------------------------------------------------------------------------------------ inside the Echoes screen
test('the Echoes header has a bell with the unread count, and it opens the list', async () => {
  feed = [post('p1')];
  const { value } = api([note('a'), note('b')]);
  render(<UnsaidView notifications={value} />);
  await screen.findByText('Echo p1');
  const bell = screen.getByRole('button', { name: 'Echo notifications, 2 unread' });
  fireEvent.click(bell);
  assert.ok(screen.getByRole('dialog'));
  assert.equal(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('New reply')).length, 2);
});

test('with nothing unread the bell has no count; without the notifications object there is no bell', async () => {
  feed = [post('p1')];
  const { value } = api([note('a', { read: true })]);
  const { unmount } = render(<UnsaidView notifications={value} />);
  await screen.findByText('Echo p1');
  assert.ok(screen.getByRole('button', { name: 'Echo notifications' }));
  unmount();
  render(<UnsaidView />);
  await screen.findByText('Echo p1');
  assert.equal(screen.queryByRole('button', { name: /Echo notifications/ }), null);
});

test('opening a notification marks it read, closes the list and brings up that Echo with its replies open', async () => {
  feed = [post('p1', 'advice', { replyCount: 1 }), post('p2', 'vent')];
  const { value, calls } = api([note('a', { postId: 'p1' })]);
  render(<UnsaidView notifications={value} />);
  await screen.findByText('Echo p1');
  fireEvent.click(screen.getByRole('button', { name: /Echo notifications/ }));
  fireEvent.click(screen.getByRole('button', { name: /New reply on your Need Advice/ }));
  assert.deepEqual(calls.read, ['a']);
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Echo notifications' }), null));
  const card = screen.getByText('Echo p1').closest('li') as HTMLElement;
  assert.ok(card.className.includes('ring-2'), 'the Echo is highlighted');
  assert.ok(card.id === 'echo-p1');
  assert.equal(fetched.length, 0, 'it was already on screen: nothing was fetched');
});

test('an older Echo that is not on screen is fetched and shown', async () => {
  feed = [post('p2', 'vent')];
  fetchable = post('old1', 'wins', { text: 'An older win' });
  const { value } = api([note('a', { postId: 'old1', kind: 'wins' })]);
  render(<UnsaidView notifications={value} />);
  await screen.findByText('Echo p2');
  fireEvent.click(screen.getByRole('button', { name: /Echo notifications/ }));
  fireEvent.click(screen.getByRole('button', { name: /New reply on your Little Win/ }));
  await screen.findByText('An older win');
  assert.deepEqual(fetched, ['old1']);
});

test('a deleted Echo says it is gone, and the notification is still marked read', async () => {
  feed = [post('p2', 'vent')];
  fetchable = null;
  const { value, calls } = api([note('a', { postId: 'gone' })]);
  render(<UnsaidView notifications={value} />);
  await screen.findByText('Echo p2');
  fireEvent.click(screen.getByRole('button', { name: /Echo notifications/ }));
  fireEvent.click(screen.getByRole('button', { name: /New reply on your Need Advice/ }));
  await screen.findByText('That Echo is no longer available.');
  assert.deepEqual(calls.read, ['a']);
});

test('the Echo list, categories, reactions and replies are unchanged by notifications', async () => {
  feed = [post('p1', 'advice'), post('p2', 'vent')];
  const { value } = api([]);
  render(<UnsaidView notifications={value} />);
  const advice = (await screen.findByText('Echo p1')).closest('li') as HTMLElement;
  const vent = screen.getByText('Echo p2').closest('li') as HTMLElement;
  assert.ok(within(advice).getByRole('button', { name: /^Reply$|\d+ repl/i }));
  assert.equal(within(vent).queryByRole('button', { name: /^Reply$|\d+ repl/i }), null, 'a vent still takes no replies');
  for (const li of [advice, vent]) assert.equal(within(li).getAllByRole('button').filter((b) => /, \d+$/.test(b.getAttribute('aria-label') ?? '')).length, 6);
});
