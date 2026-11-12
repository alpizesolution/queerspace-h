import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';

/**
 * The live inbox listener's reliability: it reconnects after a temporary failure with growing pauses, stops after a bounded number
 * of tries, treats a permission refusal as permanent after one retry, keeps only one listener, cleans up on unmount, and a manual
 * retry (or coming back online) starts again.
 */
const real = await import('../services/signalsInbox.ts');
type Handlers = { onData: (data: unknown) => void; onError: (error: unknown) => void; unsubscribed: boolean };
let listeners: Handlers[] = [];
let authCallback: ((user: { uid: string } | null) => void) | null = null;

mock.module('../services/signalsInbox.ts', {
  namedExports: {
    ...real,
    subscribeSignalsInbox: (_uid: string, onData: Handlers['onData'], onError: Handlers['onError']) => {
      // Firestore ends a listener by itself when it reports an error, so a failed one counts as gone.
      const handlers: Handlers = { onData, onError: (error) => { handlers.unsubscribed = true; onError(error); }, unsubscribed: false };
      listeners.push(handlers);
      return () => { handlers.unsubscribed = true; };
    },
  },
});
mock.module('../lib/firebase.ts', {
  namedExports: { subscribeAuthState: (callback: (user: { uid: string } | null) => void) => { authCallback = callback; callback({ uid: 'me' }); return () => { authCallback = null; }; } },
});
const { useSignalsInbox } = await import('./useSignalsInbox.ts');

const live = () => listeners.filter((l) => !l.unsubscribed);

beforeEach(() => {
  listeners = [];
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { cleanup(); mock.timers.reset(); });

const mount = () => renderHook(() => useSignalsInbox(() => {}));
const fail = (code: string) => act(() => { live().at(-1)!.onError({ code }); });
const wait = (ms: number) => act(() => { mock.timers.tick(ms); });

test('it connects once, and unmounting removes the listener and any pending retry', () => {
  const view = mount();
  assert.equal(live().length, 1);
  fail('unavailable');
  assert.equal(view.result.current.reconnecting, true);
  view.unmount();
  wait(60_000);
  assert.equal(live().length, 0, 'no listener is left, and the pending retry never fired');
});

test('a temporary failure is retried after 1s, 2s, 4s, 8s and 16s, with only ever one listener, and then it stops and says so', () => {
  const view = mount();
  const delays = [1000, 2000, 4000, 8000, 16000];
  delays.forEach((delay, i) => {
    fail('unavailable');
    assert.equal(live().length, 0, 'the failed listener is gone while waiting');
    wait(delay - 1);
    assert.equal(live().length, 0, `not before ${delay}ms (retry ${i + 1})`);
    wait(1);
    assert.equal(live().length, 1, `exactly one listener after ${delay}ms`);
  });
  fail('unavailable');
  assert.equal(view.result.current.reconnecting, false);
  assert.match(view.result.current.error ?? '', /unavailable/i);
  wait(120_000);
  assert.equal(live().length, 0, 'it does not retry forever');
  assert.equal(listeners.length, 6, 'one first connection plus five retries');
});

test('a success resets the attempts, clears the error and the reconnecting state', () => {
  const view = mount();
  fail('unavailable');
  wait(1000);
  act(() => live().at(-1)!.onData({ rev: 4 }));
  assert.equal(view.result.current.live, true);
  assert.equal(view.result.current.reconnecting, false);
  assert.equal(view.result.current.error, null);
  assert.equal(view.result.current.rev, 4);
  fail('unavailable');
  wait(1000);
  assert.equal(live().length, 1, 'the first pause again (1s), not a longer one');
});

test('a permission refusal is retried once, then reported as permanent without further tries', () => {
  const view = mount();
  fail('permission-denied');
  wait(1000);
  assert.equal(live().length, 1, 'one retry (a sign-in that was still settling)');
  fail('permission-denied');
  assert.match(view.result.current.error ?? '', /session/i, 'worded as a session problem, not a connection one');
  wait(120_000);
  assert.equal(live().length, 0);
});

test('Retry starts again from the beginning and the Retry button state clears the error', () => {
  const view = mount();
  for (let i = 0; i < 6; i += 1) { fail('unavailable'); wait(30_000); }
  assert.ok(view.result.current.error);
  assert.equal(live().length, 0);
  act(() => view.result.current.retry?.());
  assert.equal(live().length, 1);
  assert.equal(view.result.current.error, null);
  assert.equal(view.result.current.reconnecting, true);
  act(() => live().at(-1)!.onData({ rev: 9 }));
  assert.equal(view.result.current.live, true);
});

test('coming back online after giving up reconnects; while a listener is healthy it does nothing', () => {
  const view = mount();
  act(() => live().at(-1)!.onData({ rev: 1 }));
  act(() => { window.dispatchEvent(new Event('online')); });
  assert.equal(listeners.length, 1, 'a healthy listener is left alone');
  for (let i = 0; i < 6; i += 1) { fail('unavailable'); wait(30_000); }
  assert.equal(live().length, 0);
  act(() => { window.dispatchEvent(new Event('online')); });
  assert.equal(live().length, 1);
  assert.equal(view.result.current.error, null);
});

test('signing out stops listening and clears the inbox; signing in as someone else connects fresh', () => {
  const view = mount();
  act(() => live().at(-1)!.onData({ rev: 3 }));
  act(() => authCallback?.(null));
  assert.equal(live().length, 0);
  assert.equal(view.result.current.rev, 0);
  act(() => authCallback?.({ uid: 'other' }));
  assert.equal(live().length, 1);
});

test('a late answer from a listener that was replaced is ignored', () => {
  const view = mount();
  const old = live().at(-1)!;
  act(() => authCallback?.({ uid: 'other' }));
  act(() => old.onData({ rev: 99 }));
  assert.equal(view.result.current.rev, 0, 'the old member\'s data never lands on the new member');
});
