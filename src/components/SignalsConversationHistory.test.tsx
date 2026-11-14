import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Long conversations in the real component, with only the network replaced by a small fake of the server's paging: the newest page
 * opens first, older pages are brought in on request (button or scrolling to the top) without duplicates or reordering, and a
 * conversation the server will not show says so instead of looking empty.
 */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
let chimes = 0;
const posts: Array<Record<string, unknown>> = [];
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() { chimes += 1; } } } });
const { SignalsConversation } = await import('./SignalsConversation.tsx');

const BASE = Date.parse('2026-01-01T00:00:00.000Z');
let total = 0;
let mode: 'ok' | 'unavailable' | 'network' = 'ok';
let urls: string[] = [];
const message = (i: number) => ({ id: `msg-${String(i).padStart(6, '0')}`, senderId: i % 2 ? 'bob' : 'alice', text: `text-${i}`, createdAt: new Date(BASE + i * 1000).toISOString(), replyTo: null, reactions: [] });

/** The server's behaviour in miniature: newest page first, `before` pages back (cursor = index), `after` returns only changes (none here). */
const fakeServer = (url: string) => {
  const params = new URL(url, 'http://x').searchParams;
  if (params.get('after')) return { messages: [], cursor: new Date().toISOString() };
  const limit = Math.min(Number(params.get('limit') ?? 100), 100);
  const end = params.get('before') ? Number(params.get('before')) : total;
  const start = Math.max(0, end - limit);
  return { messages: Array.from({ length: end - start }, (_, k) => message(start + k)), cursor: new Date().toISOString(), olderCursor: start > 0 ? String(start) : null };
};

beforeEach(() => {
  total = 150;
  mode = 'ok';
  urls = [];
  chimes = 0;
  posts.length = 0;
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String((init as { body?: string }).body ?? '{}'))); return { ok: true, status: 200, json: async () => ({}) }; }
    urls.push(String(url));
    if (!String(url).includes('view=messages')) return { ok: true, status: 200, json: async () => ({}) };
    if (mode === 'unavailable') return { ok: false, status: 403, json: async () => ({ error: 'conversation_unavailable' }) };
    if (mode === 'network') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => fakeServer(String(url)) };
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

const open = () => render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} />);
const shown = () => screen.queryAllByRole('button', { name: /message: text-\d+/ }).map((el) => Number(/text-(\d+)/.exec(el.getAttribute('aria-label') ?? '')![1]));

test('opening a 150-message conversation shows the NEWEST 50 in order, asks for a page, and offers earlier messages', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  const ids = shown();
  assert.equal(ids.length, 50);
  assert.deepEqual(ids, Array.from({ length: 50 }, (_, i) => 100 + i), 'messages 100 to 149, oldest first');
  assert.match(urls[0], /limit=50/, 'a page is asked for, never the whole history');
  assert.doesNotMatch(urls[0], /after=/);
  assert.ok(screen.getByTestId('load-earlier'));
});

test('"Load earlier messages" adds the next older page above, with no duplicates and consistent order, until the start', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 100));
  assert.deepEqual(shown(), Array.from({ length: 100 }, (_, i) => 50 + i));
  assert.match(urls.at(-1)!, /before=100/);
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 150));
  assert.deepEqual(shown(), Array.from({ length: 150 }, (_, i) => i));
  assert.equal(screen.queryByTestId('load-earlier'), null, 'the whole history is loaded: nothing more to offer');
});

test('scrolling to the top loads the next older page, once even if the scroll event repeats', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  const list = document.querySelector('[aria-live="polite"]') as HTMLElement;
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 0, writable: true });
  fireEvent.scroll(list);
  fireEvent.scroll(list);
  fireEvent.scroll(list);
  await waitFor(() => assert.equal(shown().length, 100));
  assert.equal(urls.filter((u) => /before=100/.test(u)).length, 1, 'one request for that page');
});

test('the reader keeps their place: after older messages are added the scroll position moves down by exactly what was added', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  const list = document.querySelector('[aria-live="polite"]') as HTMLElement;
  // Each message on screen is 40px tall, so the list grows by 2000px when fifty older ones are added.
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 3000 + shown().length * 40 });
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 30, writable: true });
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 100));
  assert.equal((list as unknown as { scrollTop: number }).scrollTop, 30 + 2000, 'the same messages stay under the reader\'s eyes');
  assert.equal(screen.queryByRole('button', { name: /New messages/ }), null, 'older messages are never announced as new');
});

test('a conversation with fewer than 50 messages shows all of them and no "earlier" button', async () => {
  total = 12;
  open();
  await screen.findByRole('button', { name: /message: text-11/ });
  assert.equal(shown().length, 12);
  assert.equal(screen.queryByTestId('load-earlier'), null);
});

test('a refused older page shows a retry on the button, keeps what is on screen, and works on the next tap', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  const originalFetch = globalThis.fetch;
  let failOnce = true;
  globalThis.fetch = (async (url: string, init?: never) => {
    if (/before=/.test(String(url)) && failOnce) { failOnce = false; throw new TypeError('offline'); }
    return (originalFetch as unknown as (u: string, i?: never) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.match(screen.getByTestId('load-earlier').textContent ?? '', /retry/i));
  assert.equal(shown().length, 50, 'nothing was lost');
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 100));
});

test('a conversation the server will not show (a block or suspension) says so: no empty chat, no composer, and nothing is claimed deleted', async () => {
  mode = 'unavailable';
  open();
  const card = await screen.findByTestId('conversation-unavailable');
  assert.match(card.textContent ?? '', /isn’t available right now/);
  assert.match(card.textContent ?? '', /Nothing has been deleted/);
  assert.equal(screen.queryByText(/A quiet little beginning/), null, 'not the "empty conversation" screen');
  assert.equal(screen.queryByPlaceholderText('Message...'), null, 'no composer');
  assert.equal(shown().length, 0);
});

test('a network failure is NOT shown as unavailable: it keeps the normal retry banner', async () => {
  mode = 'network';
  open();
  await screen.findByRole('alert');
  assert.equal(screen.queryByTestId('conversation-unavailable'), null);
  mode = 'ok';
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: /message: text-149/ });
});

test('when the server lifts the restriction, Try again brings the newest messages back', async () => {
  mode = 'unavailable';
  open();
  await screen.findByTestId('conversation-unavailable');
  mode = 'ok';
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: /message: text-149/ });
  assert.equal(screen.queryByTestId('conversation-unavailable'), null);
});

test('loading older messages never chimes, never shows "New messages", and never changes what is marked read', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  await waitFor(() => assert.ok(posts.some((p) => p.action === 'mark-read')));
  const marks = () => posts.filter((p) => p.action === 'mark-read');
  const before = marks().length;
  assert.equal(marks()[0].throughMessageId, 'msg-000149', 'read through the NEWEST message');
  assert.equal(chimes, 0, 'opening a conversation is silent');
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 100));
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 150));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(chimes, 0, 'old messages are not new messages');
  assert.equal(marks().length, before, 'no further mark-read: the unread count is exactly what it was');
  assert.equal(screen.queryByRole('button', { name: /New messages/ }), null);
});

test('sending a message after older pages were loaded works: it appears at the bottom once, and the history above is untouched', async () => {
  open();
  await screen.findByRole('button', { name: /message: text-149/ });
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(shown().length, 100));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}'));
      if (body.action === 'send-message') return { ok: true, status: 201, json: async () => ({ id: body.messageId, senderId: 'alice', text: body.text, createdAt: new Date(BASE + 999_000).toISOString(), replyTo: null, reactions: [] }) };
    }
    return (originalFetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  fireEvent.change(screen.getByPlaceholderText('Message...'), { target: { value: 'sent after paging' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: /message: sent after paging/ });
  assert.equal(screen.getAllByRole('button', { name: /message: sent after paging/ }).length, 1, 'once, not duplicated');
  assert.deepEqual(shown().slice(0, 100), Array.from({ length: 100 }, (_, i) => 50 + i), 'the loaded history is unchanged and in order');
});

test('a catch-up that says there is more is followed up at once, so a long run of missed messages is fully fetched', async () => {
  const view = render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} liveAt={null} onBack={() => {}} />);
  await screen.findByRole('button', { name: /message: text-149/ });
  const originalFetch = globalThis.fetch;
  const afters: string[] = [];
  globalThis.fetch = (async (url: string, init?: unknown) => {
    const text = String(url);
    if (/view=messages/.test(text) && /after=/.test(text)) {
      afters.push(text);
      if (afters.length === 1) return { ok: true, status: 200, json: async () => ({ messages: [message(150)], cursor: new Date(Date.now() - 5000).toISOString(), more: true }) };
      return { ok: true, status: 200, json: async () => ({ messages: [message(151)], cursor: new Date().toISOString() }) };
    }
    return (originalFetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  // The inbox listener reports new activity from the other member: the open conversation reads the changes now.
  view.rerender(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} liveAt={Date.now()} onBack={() => {}} />);
  await waitFor(() => assert.ok(screen.queryByRole('button', { name: /message: text-151/ }), 'the second batch arrived without waiting for the next poll'));
  assert.ok(screen.getByRole('button', { name: /message: text-150/ }));
  assert.equal(afters.length >= 2, true, 'it asked again straight away');
});

test('an older page holding only messages that are already on screen leaves no stale state: the next new message is still announced to a reader who scrolled up', async () => {
  const view = render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} liveAt={null} onBack={() => {}} />);
  await screen.findByRole('button', { name: /message: text-149/ });
  const originalFetch = globalThis.fetch;
  let polled = 0;
  let deliver = false;
  globalThis.fetch = (async (url: string, init?: unknown) => {
    const text = String(url);
    if (/before=/.test(text)) {
      // The "older" page is made only of messages that are already shown (for example a poll brought them in first).
      return { ok: true, status: 200, json: async () => ({ messages: Array.from({ length: 5 }, (_, k) => message(145 + k)), cursor: new Date().toISOString(), olderCursor: null }) };
    }
    if (/after=/.test(text)) {
      if (deliver) polled += 1;
      return { ok: true, status: 200, json: async () => ({ messages: deliver ? [message(150)] : [], cursor: new Date().toISOString() }) };
    }
    return (originalFetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  fireEvent.click(screen.getByTestId('load-earlier'));
  await waitFor(() => assert.equal(screen.queryByTestId('load-earlier') === null, true, 'the older page finished loading'));
  assert.equal(shown().length, 50, 'nothing new was added by that page');
  // The reader scrolls up, away from the newest message.
  const list = document.querySelector('[aria-live="polite"]') as HTMLElement;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 3000 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 400, writable: true });
  fireEvent.scroll(list);
  // A new message arrives from the other member.
  deliver = true;
  view.rerender(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} liveAt={Date.now()} onBack={() => {}} />);
  await screen.findByLabelText(/message: text-150/);
  assert.ok(polled >= 1);
  assert.ok(screen.getByText('New messages'), 'the reader is told there is a new message (it was not swallowed by the older-page bookkeeping)');
});
