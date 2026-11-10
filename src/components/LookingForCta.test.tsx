import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StardustButton } from './StardustButton.tsx';
import { LookingForBody } from './LookingForBody.tsx';
import type { LookingForPost } from '../utils/lookingFor.ts';

afterEach(cleanup);

const noop = () => {};
const post = (over: Partial<LookingForPost> = {}): LookingForPost => ({
  id: 'u1_dating', authorId: 'u1', author: 'Willow', authorPronouns: 'she/her', title: 'Coffee and long walks',
  intro: 'x'.repeat(120), lookingFor: 'y'.repeat(120), intention: 'dating', tags: ['books'], isNsfw: false, contentWarning: null,
  requestsPaused: false, timestamp: Date.now() - 60_000, ...over,
});

// ---------------------------------------------------------------------------- Stardust, compact variant
test('compact Stardust reads "Stardust · 3": a small sparkle, the word Stardust and the count, with no "Give"', () => {
  render(<StardustButton variant="compact" count={3} given={false} onToggle={noop} />);
  const button = screen.getByRole('button');
  assert.equal(button.textContent, 'Stardust·3');
  assert.doesNotMatch(button.textContent ?? '', /Give/);
  assert.ok(button.querySelector('svg'), 'the sparkle icon');
  assert.equal(button.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
});

test('compact Stardust is transparent with no pill or border, muted at rest and a subtle lavender once given', () => {
  const { rerender } = render(<StardustButton variant="compact" count={3} given={false} onToggle={noop} />);
  const rest = screen.getByRole('button').className.split(/\s+/);
  assert.ok(rest.includes('bg-transparent'));
  assert.ok(!rest.some((c) => /^border/.test(c)), 'no border');
  assert.ok(!rest.some((c) => /^bg-(lavender|raised|plum|berry)/.test(c)), 'no filled background');
  assert.ok(rest.includes('text-[var(--reaction-rest)]'), 'muted lavender-gray at rest');

  rerender(<StardustButton variant="compact" count={4} given onToggle={noop} />);
  const given = screen.getByRole('button').className.split(/\s+/);
  assert.ok(given.includes('text-lavender'), 'lavender accent once given');
  assert.ok(given.includes('bg-transparent') && !given.some((c) => /^border/.test(c) || /^bg-(lavender|raised|plum|berry)/.test(c)), 'still no pill or border');
});

test('compact Stardust explains itself (label and tooltip) and behaves exactly like the default: one tap, pressed state, no double tap while pending', () => {
  let taps = 0;
  const { rerender } = render(<StardustButton variant="compact" count={3} given={false} onToggle={() => { taps++; }} />);
  const button = screen.getByRole('button');
  assert.equal(button.getAttribute('aria-label'), 'Give Stardust. 3 Stardust');
  assert.equal(button.getAttribute('title'), 'Give Stardust to show you appreciate this post');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  fireEvent.click(button);
  assert.equal(taps, 1);

  rerender(<StardustButton variant="compact" count={4} given onToggle={() => { taps++; }} />);
  const given = screen.getByRole('button');
  assert.equal(given.getAttribute('aria-label'), 'Given. Remove your Stardust. 4 Stardust');
  assert.equal(given.getAttribute('title'), 'You gave Stardust. Tap to take it back.');
  assert.equal(given.getAttribute('aria-pressed'), 'true');

  rerender(<StardustButton variant="compact" count={4} given pending onToggle={() => { taps++; }} />);
  assert.equal((screen.getByRole('button') as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole('button'));
  assert.equal(taps, 1, 'a tap while one is on its way does nothing');
});

test('compact Stardust on your own post shows the count and offers nothing to give', () => {
  render(<StardustButton variant="compact" count={5} given={false} own onToggle={noop} />);
  assert.equal(screen.queryByRole('button'), null);
  assert.match(document.body.textContent ?? '', /Stardust·5/);
});

test('the default look is untouched, so Community keeps "Give Stardust" and its pill', () => {
  const { rerender } = render(<StardustButton count={3} given={false} onToggle={noop} />);
  assert.match(screen.getByRole('button').textContent ?? '', /Give Stardust/);
  assert.ok(screen.getByRole('button').className.includes('border'), 'the default still has its border classes');
  rerender(<StardustButton count={3} given onToggle={noop} />);
  assert.match(screen.getByRole('button').textContent ?? '', /Given/);
});

// ---------------------------------------------------------------------------- Send Signal
const body = (over: { post?: LookingForPost; mine?: boolean; onRequest?: () => void; stardust?: React.ReactNode } = {}) =>
  render(<LookingForBody post={over.post ?? post()} mine={over.mine ?? false} canCoverAgain={false} onCoverAgain={noop} onRequest={over.onRequest ?? noop} stardust={over.stardust} />);

test('the connection request is "Send Signal" on desktop and "Signal" on mobile, with an accessible name and a signal icon', () => {
  body();
  const button = screen.getByRole('button', { name: 'Send connection signal' });
  const spans = [...button.querySelectorAll('span')];
  const mobile = spans.find((s) => s.textContent === 'Signal')!;
  const desktop = spans.find((s) => s.textContent === 'Send Signal')!;
  assert.ok(mobile.className.includes('sm:hidden'), 'the short label is for small screens');
  assert.ok(desktop.className.includes('hidden') && desktop.className.includes('sm:inline'), 'the full label appears from 640px');
  assert.ok(button.querySelector('svg'), 'a signal icon');
  assert.equal(button.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
  assert.match(button.className, /btn-primary/, 'the existing pink accent button');
  assert.match(button.className, /!px-3/, 'compact: less horizontal padding');
  assert.equal(screen.queryByText(/Connection Request/i), null, 'the old label is gone');
});

test('clicking Send Signal starts the existing request flow (the same onRequest), once per click', () => {
  let opened = 0;
  body({ onRequest: () => { opened++; } });
  fireEvent.click(screen.getByRole('button', { name: 'Send connection signal' }));
  assert.equal(opened, 1);
});

test('no signal for your own post, and a paused author shows "Requests paused" instead', () => {
  body({ mine: true });
  assert.equal(screen.queryByRole('button', { name: 'Send connection signal' }), null);
  cleanup();
  body({ post: post({ requestsPaused: true }) });
  assert.equal(screen.queryByRole('button', { name: 'Send connection signal' }), null);
  const paused = screen.getByRole('button', { name: 'Requests paused' }) as HTMLButtonElement;
  assert.equal(paused.disabled, true);
});

test('Stardust and Send Signal share one row (no extra height), Stardust on the left and the signal on the right', () => {
  body({ stardust: <StardustButton variant="compact" count={3} given={false} onToggle={noop} /> });
  const signal = screen.getByRole('button', { name: 'Send connection signal' });
  const stardust = screen.getByRole('button', { name: /Give Stardust/ });
  const row = signal.closest('div')!.parentElement!;
  assert.ok(row.contains(stardust), 'the same action row');
  assert.ok(stardust.compareDocumentPosition(signal) & Node.DOCUMENT_POSITION_FOLLOWING, 'Stardust comes first');
  assert.ok(signal.parentElement!.className.includes('ml-auto'), 'the signal is pushed to the right edge');
  assert.notEqual(stardust.className, signal.className, 'visually distinct');
});
