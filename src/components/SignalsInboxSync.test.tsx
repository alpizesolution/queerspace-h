import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SignalsInboxState } from '../hooks/useSignalsInbox.ts';

/**
 * The inbox screen keeps up with changes: a conversation that is created (an accepted invitation) appears without a reload, an
 * older answer arriving late can never overwrite a newer one, a conversation is never listed twice, the order follows the latest
 * activity, what was loaded is remembered only for the revision it was asked at, and a failed live connection can be retried.
 */
mock.module('../lib/firebase.ts', {
  namedExports: {
    isFirebaseConfigured: true,
    db: null,
    ensureAnonymousAuth: async () => null,
    subscribeAuthState: () => () => {},
    handleFirestoreError: () => {},
    logScreenView: () => {},
    OperationType: {},
    auth: { currentUser: { uid: 'me', isAnonymous: true, providerData: [], email: null, getIdToken: async () => 'token' } },
  },
});
const realService = await import('../services/signalsListService.ts');
type Calls = { before: string | null; fresh: boolean; resolve: (page: { pairs: unknown[]; nextCursor: string | null }) => void }[];
let calls: Calls = [];
let immediate: { pairs: unknown[]; nextCursor: string | null } | null = null;
mock.module('../services/signalsListService.ts', {
  namedExports: {
    ...realService,
    fetchPairsPage: (before: string | null = null, fresh = false) => new Promise((resolve) => {
      if (immediate) { resolve(immediate); calls.push({ before, fresh, resolve }); return; }
      calls.push({ before, fresh, resolve: resolve as Calls[number]['resolve'] });
    }),
    fetchPendingInvitations: async () => [],
    fetchPair: async () => null,
  },
});
const { SignalsView } = await import('./SignalsView.tsx');

const pair = (id: string, name: string, createdAt: string, status = 'active') => ({ id, invitationId: id, participants: ['me', `${id}-other`], status, createdAt, endedAt: null, endedBy: null, partner: { displayName: name, avatar: null } });
const inboxState = (over: Partial<SignalsInboxState> = {}): SignalsInboxState => ({ rev: 1, pendingIds: [], unread: {}, last: {}, acceptedUnread: [], requestIds: [], live: true, error: null, ...over });
const names = () => screen.queryAllByText(/^(Ana|Bea|Cy|Di)$/).map((el) => el.textContent);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });

beforeEach(() => {
  calls = [];
  immediate = null;
  realService.clearInboxCache();
});
afterEach(cleanup);

test('a new conversation appears when the live inbox changes, with no reload', async () => {
  const view = render(<SignalsView inbox={inboxState({ rev: 1 })} />);
  await waitFor(() => assert.equal(calls.length, 1));
  await act(async () => calls[0].resolve({ pairs: [pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null }));
  await waitFor(() => assert.deepEqual(names(), ['Ana']));
  // The other member accepts: the server bumps the revision, and the app asks again.
  view.rerender(<SignalsView inbox={inboxState({ rev: 2 })} />);
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1].fresh, true, 'a refresh after a known change never joins an older request');
  await act(async () => calls[1].resolve({ pairs: [pair('pair-bbbbbbbb', 'Bea', '2026-01-02T10:00:00Z'), pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null }));
  await waitFor(() => assert.deepEqual(names().sort(), ['Ana', 'Bea']));
});

test('a slow, older answer that arrives after a newer one cannot overwrite it', async () => {
  const view = render(<SignalsView inbox={inboxState({ rev: 1 })} />);
  await waitFor(() => assert.equal(calls.length, 1));
  view.rerender(<SignalsView inbox={inboxState({ rev: 2 })} />);
  await waitFor(() => assert.equal(calls.length, 2));
  // The newer request answers first, with the new conversation...
  await act(async () => calls[1].resolve({ pairs: [pair('pair-bbbbbbbb', 'Bea', '2026-01-02T10:00:00Z'), pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null }));
  await waitFor(() => assert.deepEqual(names().sort(), ['Ana', 'Bea']));
  // ...then the older request, sent before the change, finally answers with the old list.
  await act(async () => calls[0].resolve({ pairs: [pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null }));
  await settle();
  assert.deepEqual(names().sort(), ['Ana', 'Bea'], 'the old answer was ignored');
});

test('a conversation is never listed twice, even when answers overlap', async () => {
  const view = render(<SignalsView inbox={inboxState({ rev: 1 })} />);
  await waitFor(() => assert.equal(calls.length, 1));
  const ana = pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z');
  await act(async () => calls[0].resolve({ pairs: [ana, ana, pair('pair-bbbbbbbb', 'Bea', '2026-01-02T10:00:00Z')].filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i), nextCursor: null }));
  view.rerender(<SignalsView inbox={inboxState({ rev: 2 })} />);
  await waitFor(() => assert.equal(calls.length, 2));
  await act(async () => calls[1].resolve({ pairs: [pair('pair-bbbbbbbb', 'Bea', '2026-01-02T10:00:00Z'), ana], nextCursor: null }));
  await settle();
  assert.equal(names().filter((n) => n === 'Ana').length, 1);
  assert.equal(names().filter((n) => n === 'Bea').length, 1);
});

test('the order follows the latest activity: unread first, then the most recent message, not when the conversation began', async () => {
  const ana = pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z');
  const bea = pair('pair-bbbbbbbb', 'Bea', '2026-01-02T10:00:00Z');
  const cy = pair('pair-cccccccc', 'Cy', '2026-01-03T10:00:00Z');
  immediate = { pairs: [cy, bea, ana], nextCursor: null };
  const view = render(<SignalsView inbox={inboxState({ last: { 'pair-aaaaaaaa': { text: 'hi', mine: false, at: Date.parse('2026-02-01T10:00:00Z') } } })} />);
  await waitFor(() => assert.equal(names().length, 3));
  assert.deepEqual(names(), ['Ana', 'Cy', 'Bea'], 'Ana was messaged most recently, so she is first even though her chat is the oldest');
  view.rerender(<SignalsView inbox={inboxState({ last: { 'pair-aaaaaaaa': { text: 'hi', mine: false, at: Date.parse('2026-02-01T10:00:00Z') } }, unread: { 'pair-bbbbbbbb': 2 } })} />);
  await waitFor(() => assert.deepEqual(names(), ['Bea', 'Ana', 'Cy'], 'unread comes first'));
});

test('what was loaded is remembered for the revision it was ASKED at, so a change made while it loaded is not hidden by the cache', async () => {
  const first = render(<SignalsView inbox={inboxState({ rev: 5 })} />);
  await waitFor(() => assert.equal(calls.length, 1));
  first.rerender(<SignalsView inbox={inboxState({ rev: 6 })} />);
  await waitFor(() => assert.equal(calls.length, 2));
  // Only the request that started at rev 5 answers (with the list from before the change), and the newer one is lost on its way.
  await act(async () => calls[0].resolve({ pairs: [pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null }));
  await settle();
  first.unmount();
  calls = [];
  // Coming back at rev 6: the remembered list is for rev 5, so it is refreshed, not trusted.
  render(<SignalsView inbox={inboxState({ rev: 6 })} />);
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 2000 });
});

test('coming back with nothing changed asks for nothing at all (the cache still saves the request)', async () => {
  immediate = { pairs: [pair('pair-aaaaaaaa', 'Ana', '2026-01-01T10:00:00Z')], nextCursor: null };
  const first = render(<SignalsView inbox={inboxState({ rev: 7 })} />);
  await waitFor(() => assert.deepEqual(names(), ['Ana']));
  await settle();
  first.unmount();
  calls = [];
  render(<SignalsView inbox={inboxState({ rev: 7 })} />);
  await settle();
  assert.equal(calls.length, 0, 'the remembered list for the same revision is shown without a request');
  assert.deepEqual(names(), ['Ana']);
});

test('a failed live connection shows a message with Retry that starts the listener again and refreshes the list', async () => {
  let retried = 0;
  immediate = { pairs: [], nextCursor: null };
  render(<SignalsView inbox={inboxState({ live: false, error: 'Live Signals updates are unavailable. Check your connection and tap Retry.', retry: () => { retried += 1; } })} />);
  const box = await screen.findByTestId('inbox-sync-error');
  assert.match(box.textContent ?? '', /unavailable/);
  const before = calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  assert.equal(retried, 1);
  await waitFor(() => assert.ok(calls.length > before), { timeout: 2000 });
});

test('while the connection is being re-established the screen says so, and an anonymous member is offered a way to keep their conversations', async () => {
  immediate = { pairs: [], nextCursor: null };
  render(<SignalsView inbox={inboxState({ live: false, reconnecting: true })} />);
  assert.ok(await screen.findByTestId('inbox-reconnecting'));
  assert.ok(screen.getByTestId('save-account-banner'));
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }));
  const sheet = await screen.findByTestId('account-recovery');
  assert.match(sheet.textContent ?? '', /can’t be recovered/, 'says plainly what is lost if nothing is saved');
  assert.equal(screen.queryByText(/we can restore/i), null);
});
