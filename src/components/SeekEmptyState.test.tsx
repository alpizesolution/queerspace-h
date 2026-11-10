import '../../test/dom-setup.ts';
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SEEK_EMPTY_MESSAGES, pickSeekEmptyMessage } from '../utils/seekEmptyMessage.ts';

/** The real Seek searching screen: when the search times out, one of three messages shows, and it stays put. */
const timeouts: Array<() => void> = [];
mock.module('../utils/search-attempt.ts', {
  namedExports: { startSearchAttempt: ({ onTimeout }: { onTimeout: () => void }) => { timeouts.push(onTimeout); return () => {}; } },
});
const { SearchingState } = await import('./SearchingState.tsx');

afterEach(() => { cleanup(); timeouts.length = 0; });

const prefs = { displayName: 'Me', pronouns: 'she/her' } as never;
const show = () => render(<SearchingState mode="quick" prefs={prefs} onCancel={() => {}} onMatched={() => {}} blockedPartnerIds={[]} />);
const shown = () => SEEK_EMPTY_MESSAGES.filter((m) => screen.queryByText(m));

test('the three messages are exactly the approved ones', () => {
  assert.deepEqual([...SEEK_EMPTY_MESSAGES], [
    'Your people are still finding their way here.',
    'Somewhere out there, your kind of person is looking too.',
    'The universe is still working its magic. ✨',
  ]);
});

test('the picker chooses each message across the random range, and never anything else', () => {
  assert.equal(pickSeekEmptyMessage(() => 0), SEEK_EMPTY_MESSAGES[0]);
  assert.equal(pickSeekEmptyMessage(() => 0.34), SEEK_EMPTY_MESSAGES[1]);
  assert.equal(pickSeekEmptyMessage(() => 0.99), SEEK_EMPTY_MESSAGES[2]);
  assert.equal(pickSeekEmptyMessage(() => 1), SEEK_EMPTY_MESSAGES[2], 'an out-of-range value is clamped');
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(pickSeekEmptyMessage());
  assert.equal(seen.size, 3, 'all three turn up');
});

test('while searching there is no empty message; when the search times out exactly one shows, under the same title', () => {
  show();
  assert.equal(shown().length, 0);
  act(() => timeouts[0]());
  assert.ok(screen.getByRole('heading', { name: "No one's around yet" }));
  assert.equal(shown().length, 1);
});

test('the message stays the same through re-renders while the empty state is on screen', () => {
  const view = show();
  act(() => timeouts[0]());
  const first = shown()[0];
  for (let i = 0; i < 10; i++) view.rerender(<SearchingState mode="quick" prefs={prefs} onCancel={() => {}} onMatched={() => {}} blockedPartnerIds={[]} />);
  assert.equal(shown().length, 1);
  assert.equal(shown()[0], first);
});

test('a new empty state can pick again, and the existing Try again and Cancel buttons are still there', () => {
  const original = Math.random;
  try {
    show();
    Math.random = () => 0;
    act(() => timeouts[0]());
    assert.equal(shown()[0], SEEK_EMPTY_MESSAGES[0]);
    assert.ok(screen.getByRole('button', { name: /Try again/ }));
    assert.ok(screen.getByRole('button', { name: 'Cancel' }));
  } finally {
    Math.random = original;
  }
  cleanup(); timeouts.length = 0;
  const original2 = Math.random;
  try {
    Math.random = () => 0.99;
    show();
    act(() => timeouts[0]());
    assert.equal(shown()[0], SEEK_EMPTY_MESSAGES[2]);
  } finally {
    Math.random = original2;
  }
});

test('errors still show their own message, not the empty-state line', () => {
  assert.equal(SEEK_EMPTY_MESSAGES.some((m) => m.includes("Couldn't")), false);
});
