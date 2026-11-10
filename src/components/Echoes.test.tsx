import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UnsaidPost, UnsaidReply } from '../services/unsaidService.ts';

/**
 * The real Echoes screen and reply thread, rendered and clicked. Only the services that reach Firestore are replaced, with
 * answers the tests control, so this checks what a member would see and what the app sends.
 */
const realUnsaid = await import('../services/unsaidService.ts');
const realCommunity = await import('../services/communityService.ts');

let feed: UnsaidPost[] = [];
let myPostIds: string[] = [];
let thread: UnsaidReply[] = [];
let myReplyIds: string[] = [];
let sendResult: { ok: true; id: string } | { ok: false; reason: 'not-allowed' | 'too-fast' | 'invalid' | 'failed' } = { ok: true, id: 'reply-new-0001' };
let sendGate: Promise<void> | null = null;
const calls = { reply: [] as unknown[][], remove: [] as unknown[][], report: [] as unknown[][], post: [] as unknown[][] };

mock.module('../services/unsaidService.ts', {
  namedExports: {
    ...realUnsaid,
    isUnsaidAvailable: () => true,
    subscribeToUnsaid: (onPosts: (p: UnsaidPost[], m: { nextBefore: number | null }) => void) => { setTimeout(() => onPosts(feed, { nextBefore: null }), 0); return () => {}; },
    loadMyUnsaidIds: async () => myPostIds,
    reactToUnsaid: async () => true,
    postUnsaid: async (...args: unknown[]) => { calls.post.push(args); return 'posted'; },
    subscribeToUnsaidReplies: (_id: string, onReplies: (r: UnsaidReply[]) => void) => { setTimeout(() => onReplies(thread), 0); return () => {}; },
    loadMyReplyIds: async () => myReplyIds,
    replyToUnsaid: async (...args: unknown[]) => { calls.reply.push(args); if (sendGate) await sendGate; return sendResult; },
    deleteUnsaidReply: async (...args: unknown[]) => { calls.remove.push(args); return true; },
    reportUnsaidReply: async (...args: unknown[]) => { calls.report.push(args); return true; },
  },
});
mock.module('../services/communityService.ts', { namedExports: { ...realCommunity, fetchIsCommunityAdmin: async () => false } });

const { UnsaidView } = await import('./UnsaidView.tsx');
const { UnsaidReplies } = await import('./UnsaidReplies.tsx');
const { EchoFilterBar, EchoKindPicker, EchoKindTag } = await import('./EchoCategories.tsx');

const ALL = ['confession', 'vent', 'unsent', 'advice', 'thoughts', 'wins', 'gratitude', 'daydreams'] as const;
const REPLY = ['advice', 'wins', 'gratitude', 'daydreams'];
const LABEL: Record<string, string> = { confession: 'Confession', vent: 'Vent', unsent: 'Unsent Letter', advice: 'Need Advice', thoughts: 'Random Thought', wins: 'Little Win', gratitude: 'Gratitude', daydreams: 'Daydream' };

const echo = (kind: (typeof ALL)[number], over: Partial<UnsaidPost> = {}): UnsaidPost => ({
  id: `p-${kind}`, kind, text: `A ${kind} echo`, createdAt: Date.now() - 60_000, replyCount: 0, expiresAt: null, hugs: 0, same: 0, felt: 0, strong: 0, proud: 0, cry: 0, flags: 0, ...over,
});
const reply = (id: string, text: string, at = 1000): UnsaidReply => ({ id, text, createdAt: at });
const sleep = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  feed = ALL.map((k) => echo(k));
  myPostIds = [];
  thread = [];
  myReplyIds = [];
  sendResult = { ok: true, id: 'reply-new-0001' };
  sendGate = null;
  calls.reply.length = 0; calls.remove.length = 0; calls.report.length = 0; calls.post.length = 0;
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(cleanup);

const card = (kind: string) => screen.getByText(`A ${kind} echo`).closest('li') as HTMLElement;
const showBoard = async () => {
  render(<UnsaidView />);
  await screen.findByText('A confession echo');
};

// ------------------------------------------------------------------------------------------------ the eight categories
test('all eight categories show on the board, each with its own tag', async () => {
  await showBoard();
  for (const kind of ALL) assert.ok(within(card(kind)).getByText(LABEL[kind]), `${kind} has its tag`);
});

test('every category keeps the same six reactions (existing reaction functionality is intact)', async () => {
  await showBoard();
  for (const kind of ALL) {
    const reactions = within(card(kind)).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed') && /, \d+$/.test(b.getAttribute('aria-label') ?? ''));
    assert.equal(reactions.length, 6, `${kind}: six reactions`);
  }
});

// -------------------------------------------------------------------------------------------------------- reply controls
test('a Reply control appears on Need Advice, Little Wins, Gratitude and Daydreams, and on nothing else', async () => {
  await showBoard();
  const replyControl = (kind: string) => within(card(kind)).queryByRole('button', { name: /^Reply$|\d+ repl/i });
  for (const kind of ALL) {
    if (REPLY.includes(kind)) assert.ok(replyControl(kind), `${kind} has a Reply control`);
    else assert.equal(replyControl(kind), null, `${kind} has no Reply or Comment control`);
  }
  assert.equal(within(card('vent')).queryByRole('button', { name: /comment/i }), null);
});

test('the reply count shows on the control, and opening it shows the thread with a reply box', async () => {
  feed = [echo('advice', { replyCount: 2 }), echo('vent')];
  thread = [reply('r1', 'Talk to her gently', 1000), reply('r2', 'Same happened to me', 2000)];
  render(<UnsaidView />);
  const toggle = await screen.findByRole('button', { name: /2 replies\. Show replies/ });
  assert.equal(toggle.textContent, '2 replies');
  fireEvent.click(toggle);
  await screen.findByText('Talk to her gently');
  const texts = within(card('advice')).getAllByText(/Talk to her gently|Same happened to me/).map((n) => n.textContent);
  assert.deepEqual(texts, ['Talk to her gently', 'Same happened to me'], 'oldest first');
  assert.ok(within(card('advice')).getByLabelText('Write a reply'));
  assert.equal(within(card('vent')).queryByLabelText('Write a reply'), null, 'a vent never has a reply box');
});

test('the author is told about new replies on their own post, and opening the thread marks them seen', async () => {
  feed = [echo('wins', { replyCount: 3 }), echo('gratitude', { replyCount: 1 })];
  myPostIds = ['p-wins'];
  thread = [reply('r1', 'So proud!'), reply('r2', 'Amazing'), reply('r3', 'Go you')];
  const seen: Array<[string, number]> = [];
  render(<UnsaidView replyNotices={{ unseenByPost: { 'p-wins': 3, 'p-gratitude': 1 }, markSeen: (id, n) => seen.push([id, n]) }} />);
  await screen.findByText('A wins echo');
  await waitFor(() => assert.ok(within(card('wins')).getByLabelText('3 new replies')));
  assert.equal(within(card('gratitude')).queryByLabelText(/new repl/), null, 'only the author sees the badge, and only on their own post');
  fireEvent.click(within(card('wins')).getByRole('button', { name: /3 replies\. Show replies/ }));
  await waitFor(() => assert.deepEqual(seen.at(-1), ['p-wins', 3]));
});

// -------------------------------------------------------------------------------------------------------------- filters
test('the filter has three groups; choosing one shows its categories, and a category narrows it further', async () => {
  await showBoard();
  assert.equal(screen.queryByRole('tablist', { name: 'Release categories' }), null, 'no second row for "All"');
  fireEvent.click(screen.getByRole('tab', { name: /Uplift/ }));
  assert.ok(screen.getByRole('tablist', { name: 'Uplift categories' }));
  for (const kind of ['wins', 'gratitude', 'daydreams']) assert.ok(screen.getByText(`A ${kind} echo`));
  for (const kind of ['vent', 'advice', 'confession']) assert.equal(screen.queryByText(`A ${kind} echo`), null, `${kind} is filtered out`);
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Uplift categories' })).getByRole('tab', { name: /Gratitude/ }));
  assert.ok(screen.getByText('A gratitude echo'));
  assert.equal(screen.queryByText('A wins echo'), null);
  fireEvent.click(screen.getByRole('tab', { name: 'All' }));
  assert.ok(screen.getByText('A vent echo'));
});

test('an empty category says so by name', async () => {
  feed = [echo('vent')];
  render(<UnsaidView />);
  await screen.findByText('A vent echo');
  fireEvent.click(screen.getByRole('tab', { name: /Connect/ }));
  await screen.findByText('Nothing in Connect yet');
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Connect categories' })).getByRole('tab', { name: /Advice/ }));
  await screen.findByText('No advice yet');
});

// ------------------------------------------------------------------------------------------------------------- composer
test('the composer groups the eight categories, says whether replies are on, and posts the chosen one', async () => {
  await showBoard();
  fireEvent.click(screen.getAllByRole('button', { name: /Write an Echo/ })[0]);
  const picker = await screen.findByRole('radiogroup', { name: 'Post type' });
  const radios = within(picker).getAllByRole('radio').map((r) => r.textContent?.trim());
  assert.equal(radios.length, 8);
  for (const kind of ALL) assert.ok(radios.some((t) => t?.includes(LABEL[kind])), kind);
  for (const group of ['Release', 'Connect', 'Uplift']) assert.ok(within(picker).getByText(group), group);

  fireEvent.click(within(picker).getByRole('radio', { name: /Little Win/ }));
  assert.match(picker.textContent ?? '', /Replies are on\./);
  assert.ok(screen.getByPlaceholderText('A small win worth celebrating…'));
  fireEvent.click(within(picker).getByRole('radio', { name: /Random Thought/ }));
  assert.match(picker.textContent ?? '', /Reactions only: no replies\./);

  fireEvent.change(screen.getByLabelText('Write something unsaid'), { target: { value: 'My daydream is a small house by the sea' } });
  fireEvent.click(within(picker).getByRole('radio', { name: /Daydream/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Let it out' }));
  await waitFor(() => assert.equal(calls.post.length, 1));
  assert.deepEqual(calls.post[0], ['daydreams', 'My daydream is a small house by the sea']);
});

test('the category pieces render on their own: tag, filter, picker', () => {
  const { container } = render(<EchoKindTag kind="gratitude" />);
  assert.match(container.textContent ?? '', /Gratitude/);
  cleanup();
  let chosen: unknown = null;
  render(<EchoFilterBar filter="all" onChange={(f) => { chosen = f; }} />);
  fireEvent.click(screen.getByRole('tab', { name: /Release/ }));
  assert.deepEqual(chosen, { group: 'release' });
  cleanup();
  render(<EchoKindPicker value="vent" onChange={() => {}} />);
  assert.equal(screen.getAllByRole('radio').length, 8);
});

// ------------------------------------------------------------------------------------------------------------ the thread
const thread$ = (kind: (typeof ALL)[number] = 'advice', props: Partial<React.ComponentProps<typeof UnsaidReplies>> = {}) =>
  render(<UnsaidReplies post={echo(kind, { replyCount: thread.length })} isAdmin={false} {...props} />);

test('replies are anonymous: everyone is "Anonymous", the writer sees "You" and a delete control, others can report', async () => {
  thread = [reply('r1', 'Mine'), reply('r2', 'Theirs')];
  myReplyIds = ['r1'];
  thread$();
  await screen.findByText('Theirs');
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Delete your reply' })));
  const items = screen.getAllByRole('listitem');
  assert.match(items[0].textContent ?? '', /^You/);
  assert.match(items[1].textContent ?? '', /^Anonymous/);
  assert.ok(within(items[1]).getByRole('button', { name: 'Report reply' }));
  assert.equal(within(items[1]).queryByRole('button', { name: /Delete/ }), null, 'cannot delete someone else\'s reply');
  assert.doesNotMatch(document.body.textContent ?? '', /authorId|user/i);
});

test('a moderator can delete any reply', async () => {
  thread = [reply('r1', 'Theirs')];
  thread$('advice', { isAdmin: true });
  await screen.findByText('Theirs');
  assert.ok(screen.getByRole('button', { name: 'Delete reply (moderator)' }));
});

test('sending a reply: validated, sent once with the post, and the box clears', async () => {
  thread$('advice');
  await screen.findByText(/No replies yet/);
  const box = screen.getByLabelText('Write a reply') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: '   ' } });
  assert.equal((screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement).disabled, true, 'nothing to send yet');
  fireEvent.change(box, { target: { value: 'Maybe talk to her first.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => assert.equal(calls.reply.length, 1));
  assert.equal((calls.reply[0][0] as { id: string }).id, 'p-advice');
  assert.equal(calls.reply[0][1], 'Maybe talk to her first.');
  await waitFor(() => assert.equal(box.value, ''));
});

test('identifying text is refused before anything is sent, with the anonymity reason', async () => {
  thread$('advice');
  await screen.findByText(/No replies yet/);
  fireEvent.change(screen.getByLabelText('Write a reply'), { target: { value: 'message me on @someone_ig' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await screen.findByText(/Keep it anonymous/);
  assert.equal(calls.reply.length, 0);
});

test('tapping send twice while it is on its way sends once', async () => {
  let release!: () => void;
  sendGate = new Promise<void>((resolve) => { release = resolve; });
  thread$('advice');
  await screen.findByText(/No replies yet/);
  fireEvent.change(screen.getByLabelText('Write a reply'), { target: { value: 'One reply only' } });
  const send = screen.getByRole('button', { name: 'Reply' });
  fireEvent.click(send);
  fireEvent.click(screen.getByRole('button', { name: 'Sending' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sending' }));
  // The keyboard shortcut calls send directly, so the lock (not just the disabled button) has to hold too.
  const box = screen.getByLabelText('Write a reply');
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
  await sleep();
  assert.equal(calls.reply.length, 1);
  release();
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Reply' })));
});

test('sending the very same reply again straight away is stopped as an accidental duplicate', async () => {
  thread$('advice');
  await screen.findByText(/No replies yet/);
  const box = screen.getByLabelText('Write a reply');
  fireEvent.change(box, { target: { value: 'Thank you for sharing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => assert.equal(calls.reply.length, 1));
  await waitFor(() => assert.equal((box as HTMLTextAreaElement).value, ''));
  fireEvent.change(box, { target: { value: 'Thank you for sharing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await screen.findByText('You just sent that one.');
  assert.equal(calls.reply.length, 1);
  fireEvent.change(box, { target: { value: 'A different reply' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => assert.equal(calls.reply.length, 2));
});

test('failures are said plainly and the text is kept for another try', async () => {
  sendResult = { ok: false, reason: 'too-fast' };
  thread$('advice');
  await screen.findByText(/No replies yet/);
  const box = screen.getByLabelText('Write a reply') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: 'Keep going' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await screen.findByText(/a few seconds between replies/);
  assert.equal(box.value, 'Keep going');
});

test('Uplift replies feel warm: a kind button and prompt for each category, a gentle empty state', async () => {
  for (const [kind, button, prompt] of [['wins', 'Cheer', 'Cheer them on…'], ['gratitude', 'Send love', 'Send some warmth…'], ['daydreams', 'Wish well', 'Send a good wish…'], ['advice', 'Reply', 'Share advice or your experience…']] as const) {
    thread$(kind);
    await screen.findByText(kind === 'advice' ? /No replies yet/ : /Be the first to send some warmth/);
    assert.ok(screen.getByRole('button', { name: button }), `${kind}: ${button}`);
    assert.ok(screen.getByPlaceholderText(prompt), `${kind}: ${prompt}`);
    cleanup();
  }
});

test('deleting your own reply asks first, then removes it', async () => {
  thread = [reply('r1', 'Oops, wrong thread')];
  myReplyIds = ['r1'];
  thread$('wins');
  fireEvent.click(await screen.findByRole('button', { name: 'Delete your reply' }));
  assert.equal(calls.remove.length, 0, 'not yet: it asks first');
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => assert.deepEqual(calls.remove[0], ['p-wins', 'r1']));
});

test('reporting a reply hides it for the reporter and sends the reason to the moderators', async () => {
  thread = [reply('r1', 'Something unkind')];
  thread$('gratitude');
  fireEvent.click(await screen.findByRole('button', { name: 'Report reply' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Spam or selling' }));
  await waitFor(() => assert.deepEqual(calls.report[0], ['p-gratitude', 'r1', 'Spam or selling']));
  await waitFor(() => assert.equal(screen.queryByText('Something unkind'), null));
});

test('the thread tells the author how many replies it loaded, so they count as seen', async () => {
  thread = [reply('r1', 'a'), reply('r2', 'b')];
  const viewed: number[] = [];
  thread$('wins', { onViewed: (n) => viewed.push(n) });
  await screen.findByText('b');
  assert.equal(viewed.at(-1), 2);
});
