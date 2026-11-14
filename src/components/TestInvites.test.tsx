import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TEST_CATALOG, testById } from '../utils/testCatalog.ts';

/**
 * The Tests section and the Test Invitation card, on the real components: three catalog tests, an Invite flow that sends one ordinary
 * message of kind "test", and a card whose Take Test is a plain link to the exact address in a new tab (never a frame, never an
 * internal page), with nothing collected about answers or results.
 */
mock.module('../lib/firebase.ts', {
  namedExports: {
    isFirebaseConfigured: true, db: null,
    auth: { currentUser: { uid: 'alice', isAnonymous: true, providerData: [], getIdToken: async () => 'token' } },
    ensureAnonymousAuth: async () => null, subscribeAuthState: () => () => {}, handleFirestoreError: () => {}, logScreenView: () => {}, OperationType: {},
  },
});
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() {} } } });
const realService = await import('../services/signalsListService.ts');
const activePair = (id: string, name: string) => ({ id, invitationId: id, participants: ['alice', `${id}-o`], status: 'active', createdAt: '2026-01-01T10:00:00Z', endedAt: null, endedBy: null, partner: { displayName: name, avatar: null } });
let pairs = [activePair('pair-aaaaaaaa', 'Ana'), activePair('pair-bbbbbbbb', 'Bea')];
mock.module('../services/signalsListService.ts', {
  namedExports: { ...realService, fetchPairsPage: async () => ({ pairs, nextCursor: null }), fetchPendingInvitations: async () => [], fetchPair: async () => null },
});
const { TestInviteBubble, TestsPanel } = await import('./TestInvites.tsx');
const { SignalsView } = await import('./SignalsView.tsx');
const { SignalsConversation } = await import('./SignalsConversation.tsx');

const noop = () => {};
// The test page has no real storage, so give it a small in-memory one (the card only uses it for the "Maybe later" memory).
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); }, clear: () => memory.clear() } });
beforeEach(() => memory.clear());
afterEach(cleanup);

// ------------------------------------------------------------------ the card

const bubble = (over: Partial<React.ComponentProps<typeof TestInviteBubble>> = {}) =>
  render(<TestInviteBubble messageId="m1" testId="bdsm-test" mine={false} invitedBy="Luna" time="9:41 AM" {...over} />);

test('the card shows the test name, icon, description, who invited, and a clearly visible Take Test', () => {
  bubble();
  const card = screen.getByTestId('test-invite');
  assert.match(card.textContent ?? '', /Test invitation/);
  assert.match(card.textContent ?? '', /BDSM Test/);
  assert.match(card.textContent ?? '', /Explore preferences and dynamics\./);
  assert.match(card.textContent ?? '', /Invited by Luna/);
  assert.match(card.textContent ?? '', /🖤/);
  assert.ok(within(card).getByRole('link', { name: /Take Test/ }));
  assert.ok(within(card).getByRole('button', { name: 'Maybe later' }));
});

test('Take Test is a plain link to the EXACT catalog address in a new tab, with no opener and no referrer, and nothing is embedded', () => {
  for (const t of TEST_CATALOG) {
    cleanup();
    bubble({ testId: t.id });
    const link = screen.getByRole('link', { name: /Take Test/ }) as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), t.url, 'the exact address');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(link.getAttribute('rel') ?? '', /noopener/);
    assert.match(link.getAttribute('rel') ?? '', /noreferrer/);
    assert.equal(document.querySelectorAll('iframe, webview, embed, object').length, 0, 'never a frame');
    assert.equal(link.getAttribute('onclick'), null);
  }
});

test('the link is not intercepted: no internal navigation is triggered by the tap, and the conversation stays where it is', () => {
  bubble();
  const link = screen.getByRole('link', { name: /Take Test/ });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'the browser opens the link itself');
});

test('the card says what QUEERSPACE does not do: no results collected, no diagnosis, no compatibility claim', () => {
  bubble();
  const text = screen.getByTestId('test-invite').textContent ?? '';
  assert.match(text, /never sees your answers or results/);
  assert.match(text, /not a diagnosis/);
  assert.match(text, /compatibility/);
  assert.doesNotMatch(text, /your result|your score|compatible with/i);
});

test('Maybe later collapses the card, is remembered on this device, and Take Test stays reachable; the sender has no Maybe later', () => {
  bubble();
  fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
  assert.equal(screen.getByTestId('test-invite').getAttribute('data-state'), 'dismissed');
  assert.ok(screen.getByRole('link', { name: /Take Test anyway/ }));
  cleanup();
  bubble();
  assert.equal(screen.getByTestId('test-invite').getAttribute('data-state'), 'dismissed', 'still dismissed after reopening');
  cleanup();
  bubble({ messageId: 'someone-elses', mine: true, invitedBy: 'you' });
  assert.equal(screen.queryAllByRole('button', { name: 'Maybe later' }).length, 0);
  assert.match(screen.getByTestId('test-invite').textContent ?? '', /Invited by you/);
});

test('an id that is not in the catalog renders nothing at all (never a link)', () => {
  bubble({ testId: 'nope' });
  assert.equal(screen.queryAllByTestId('test-invite').length, 0);
  assert.equal(screen.queryAllByRole('link').length, 0);
});

// ------------------------------------------------------------------ the Tests section

test('the section lists the three tests with their descriptions, an Invite action and "Take it myself" (a plain link) for each', () => {
  render(<TestsPanel pairs={[]} onInvite={async () => null} />);
  for (const t of TEST_CATALOG) {
    const card = screen.getByTestId(`test-${t.id}`);
    assert.match(card.textContent ?? '', new RegExp(t.name));
    assert.match(card.textContent ?? '', new RegExp(t.description.replace('.', '\\.')));
    assert.ok(within(card).getByRole('button', { name: /Invite/ }));
    const own = within(card).getByRole('link', { name: /Take it myself/ }) as HTMLAnchorElement;
    assert.equal(own.getAttribute('href'), t.url);
    assert.equal(own.getAttribute('target'), '_blank');
  }
  assert.match(screen.getByTestId('tests-panel').textContent ?? '', /never sees your answers or results/);
});

test('Invite lets you choose an existing conversation and sends one invitation with a stable message id, however many times it is clicked', async () => {
  const calls: Array<[string, string, string]> = [];
  let release: () => void = noop;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  render(<TestsPanel pairs={pairs} onInvite={async (p, t, m) => { calls.push([p, t, m]); await gate; return null; }} />);
  fireEvent.click(within(screen.getByTestId('test-rice-purity-test')).getByRole('button', { name: /Invite/ }));
  const sheet = screen.getByRole('dialog', { name: /Invite to the Rice Purity Test/ });
  const ana = within(sheet).getByRole('button', { name: 'Invite Ana' });
  fireEvent.click(ana);
  fireEvent.click(ana);
  fireEvent.click(within(sheet).getByRole('button', { name: 'Invite Bea' }));
  assert.equal(calls.length, 1, 'a second click, or another choice, while one is sending does nothing');
  await act(async () => { release(); });
  await waitFor(() => assert.ok(within(sheet).getByRole('button', { name: 'Invited Ana' })));
  fireEvent.click(within(sheet).getByRole('button', { name: 'Invited Ana' }));
  assert.equal(calls.length, 1, 'an invitation already sent is not sent again');
  assert.deepEqual(calls[0].slice(0, 2), ['pair-aaaaaaaa', 'rice-purity-test']);
  assert.ok(calls[0][2].length >= 8);
});

test('a failed send shows the reason, keeps the sheet open, and a retry reuses the same message id (so it can never double)', async () => {
  const calls: string[] = [];
  let fail = true;
  render(<TestsPanel pairs={pairs} onInvite={async (_p, _t, m) => { calls.push(m); return fail ? 'Could not send the invitation. Please try again.' : null; }} />);
  fireEvent.click(within(screen.getByTestId('test-bdsm-test')).getByRole('button', { name: /Invite/ }));
  const sheet = screen.getByRole('dialog');
  fireEvent.click(within(sheet).getByRole('button', { name: 'Invite Ana' }));
  await within(sheet).findByRole('alert');
  fail = false;
  fireEvent.click(within(sheet).getByRole('button', { name: 'Invite Ana' }));
  await waitFor(() => assert.ok(within(sheet).getByRole('button', { name: 'Invited Ana' })));
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1], 'the same id on the retry');
});

test('with no active conversation there is a clear empty state and nothing to send to', () => {
  render(<TestsPanel pairs={[]} onInvite={async () => null} />);
  fireEvent.click(within(screen.getByTestId('test-bdsm-test')).getByRole('button', { name: /Invite/ }));
  assert.match(screen.getByTestId('no-conversations').textContent ?? '', /no active conversations/);
});

// ------------------------------------------------------------------ in the inbox and the conversation

test('the Signals inbox has a Tests section beside Inbox and Requests, and inviting sends an ordinary send-message of kind "test"', async () => {
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return { ok: true, status: 201, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
  render(<SignalsView inbox={{ rev: 1, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [], live: true, error: null }} />);
  const tabs = screen.getByRole('tablist', { name: 'Signals sections' });
  assert.deepEqual(within(tabs).getAllByRole('tab').map((t) => t.textContent?.trim()), ['Inbox', 'Requests', 'Tests']);
  await screen.findByText('Ana');
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Tests' }));
  assert.ok(screen.getByTestId('tests-panel'));
  fireEvent.click(within(screen.getByTestId('test-attachment-style-quiz')).getByRole('button', { name: /Invite/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite Bea' }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].action, 'send-message');
  assert.equal(posts[0].kind, 'test');
  assert.equal(posts[0].testId, 'attachment-style-quiz');
  assert.equal(posts[0].pairId, 'pair-bbbbbbbb');
  for (const forbidden of ['text', 'url', 'name', 'description']) assert.equal(forbidden in posts[0], false, `${forbidden} is not sent`);
});

test('a received invitation appears in the conversation as the distinct card, and the original conversation stays after tapping Take Test', async () => {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('view=messages')
      ? { messages: [
        { id: 'm0', senderId: 'bob', text: 'hello', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [] },
        { id: 'm1', senderId: 'bob', text: 'Test invitation: Rice Purity Test', kind: 'test', test: { id: 'rice-purity-test' }, createdAt: '2026-01-01T10:01:00.000Z', replyTo: null, reactions: [] },
      ], cursor: new Date().toISOString(), olderCursor: null }
      : {}),
  })) as unknown as typeof fetch;
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={noop} />);
  const card = await screen.findByTestId('test-invite');
  assert.match(card.textContent ?? '', /Rice Purity Test/);
  assert.match(card.textContent ?? '', /Invited by Luna/);
  const link = within(card).getByRole('link', { name: /Take Test/ }) as HTMLAnchorElement;
  assert.equal(link.href, testById('rice-purity-test')!.url);
  fireEvent.click(link);
  assert.ok(await screen.findByLabelText(/message: hello/), 'the conversation is still on screen');
  assert.equal(document.querySelectorAll('iframe').length, 0);
});
