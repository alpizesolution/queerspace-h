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
const { TestInviteBubble, TestPicker } = await import('./TestInvites.tsx');
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

// ------------------------------------------------------------------ the composer picker

const picker = (onInvite: (t: string, m: string) => Promise<string | null>) => render(<TestPicker partnerName="Luna" onInvite={onInvite} onClose={noop} />);

test('the picker lists exactly the three tests, compactly, with the privacy note, and opens nothing by itself', () => {
  picker(async () => null);
  const box = screen.getByTestId('test-picker');
  for (const t of TEST_CATALOG) {
    const row = within(box).getByRole('button', { name: `Invite to ${t.name}` });
    assert.match(row.textContent ?? '', new RegExp(t.description.replace('.', '\\.')));
  }
  assert.equal(within(box).getAllByRole('listitem').length, 3);
  assert.equal(document.querySelectorAll('a[href], iframe').length, 0, 'no link and no frame in the picker: nothing opens from here');
  assert.match(box.textContent ?? '', /never sees your answers or results/);
  assert.match(box.textContent ?? '', /Pick a test to invite Luna/);
});

test('choosing a test sends ONE invitation into this conversation with a stable id, however many times it is tapped', async () => {
  const calls: Array<[string, string]> = [];
  let release: () => void = noop;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  picker(async (t, m) => { calls.push([t, m]); await gate; return null; });
  const row = screen.getByRole('button', { name: 'Invite to Rice Purity Test' });
  fireEvent.click(row);
  fireEvent.click(row);
  fireEvent.click(screen.getByRole('button', { name: 'Invite to BDSM Test' }));
  assert.equal(calls.length, 1, 'a second tap, or another choice, while one is sending does nothing');
  await act(async () => { release(); });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Invited to Rice Purity Test' })));
  fireEvent.click(screen.getByRole('button', { name: 'Invited to Rice Purity Test' }));
  assert.equal(calls.length, 1, 'an invitation already sent is not sent again');
  assert.equal(calls[0][0], 'rice-purity-test');
  assert.ok(calls[0][1].length >= 8);
});

test('a failed send shows the reason and a retry reuses the same message id (so it can never double)', async () => {
  const ids: string[] = [];
  let fail = true;
  picker(async (_t, m) => { ids.push(m); return fail ? 'Could not send the invitation. Please try again.' : null; });
  fireEvent.click(screen.getByRole('button', { name: 'Invite to BDSM Test' }));
  await screen.findByRole('alert');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Invite to BDSM Test' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Invited to BDSM Test' })));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

// ------------------------------------------------------------------ the composer and the inbox

const setupFetch = (posts: Record<string, unknown>[], messages: unknown[] = []) => {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (body.kind === 'test') return { ok: true, status: 201, json: async () => ({ id: body.messageId, senderId: 'alice', text: 'Test invitation: Rice Purity Test', kind: 'test', test: { id: body.testId }, createdAt: new Date().toISOString(), replyTo: null, reactions: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => (String(url).includes('view=messages') ? { messages: String(url).includes('after=') ? [] : messages, cursor: new Date().toISOString(), olderCursor: null } : {}) };
  }) as unknown as typeof fetch;
};

test('the composer has a Tests button beside the other actions, which opens the picker; the other actions are all still there', async () => {
  setupFetch([]);
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={noop} />);
  const tests = await screen.findByRole('button', { name: 'Tests' });
  const row = tests.parentElement!;
  const names = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
  for (const kept of ['Send a timed photo', 'Send a GIF', 'Comfort Cards', 'Two Truths and a Lie']) assert.ok(names.includes(kept), `${kept} is still in the toolbar`);
  assert.ok(names.indexOf('Tests') > names.indexOf('Comfort Cards') && names.indexOf('Tests') < names.indexOf('Two Truths and a Lie'), 'beside the cards, in the same toolbar');
  assert.match(tests.className, /h-10 w-10/, 'the same size as its neighbours');
  fireEvent.click(tests);
  assert.ok(screen.getByRole('dialog', { name: /Invite to a test/ }));
});

test('inviting from the composer sends an ordinary send-message of kind "test" for this conversation, and the card appears in it', async () => {
  const posts: Record<string, unknown>[] = [];
  setupFetch(posts, [{ id: 'm0', senderId: 'bob', text: 'hello', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [] }]);
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tests' }));
  fireEvent.click(screen.getByRole('button', { name: 'Invite to Rice Purity Test' }));
  await waitFor(() => assert.equal(posts.filter((p) => p.kind === 'test').length, 1));
  const sent = posts.find((p) => p.kind === 'test')!;
  assert.deepEqual(Object.keys(sent).sort(), ['action', 'kind', 'messageId', 'pairId', 'testId']);
  assert.equal(sent.pairId, 'pair-12345678');
  assert.equal(sent.testId, 'rice-purity-test');
  const card = await screen.findByTestId('test-invite');
  assert.match(card.textContent ?? '', /Invited by you/);
  assert.ok(await screen.findByLabelText(/message: hello/), 'the conversation is unchanged');
});

test('there is no Tests tab in the inbox any more: only Inbox and Requests', async () => {
  render(<SignalsView inbox={{ rev: 1, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [], live: true, error: null }} />);
  const tabs = screen.getByRole('tablist', { name: 'Signals sections' });
  assert.deepEqual(within(tabs).getAllByRole('tab').map((t) => t.textContent?.trim()), ['Inbox', 'Requests']);
  assert.equal(screen.queryAllByTestId('tests-panel').length, 0);
});

test('a received invitation appears as the distinct card, and the original conversation stays after tapping Take Test', async () => {
  setupFetch([], [
    { id: 'm0', senderId: 'bob', text: 'hello', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [] },
    { id: 'm1', senderId: 'bob', text: 'Test invitation: Rice Purity Test', kind: 'test', test: { id: 'rice-purity-test' }, createdAt: '2026-01-01T10:01:00.000Z', replyTo: null, reactions: [] },
  ]);
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={noop} />);
  const card = await screen.findByTestId('test-invite');
  assert.match(card.textContent ?? '', /Invited by Luna/);
  const link = within(card).getByRole('link', { name: /Take Test/ }) as HTMLAnchorElement;
  assert.equal(link.href, testById('rice-purity-test')!.url);
  fireEvent.click(link);
  assert.ok(await screen.findByLabelText(/message: hello/));
  assert.equal(document.querySelectorAll('iframe').length, 0);
});
