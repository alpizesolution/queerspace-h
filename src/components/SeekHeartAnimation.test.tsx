import '../../test/dom-setup.ts';
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const timeouts: Array<() => void> = [];
mock.module('../utils/search-attempt.ts', {
  namedExports: { startSearchAttempt: ({ onTimeout }: { onTimeout: () => void }) => { timeouts.push(onTimeout); return () => {}; } },
});
const { SearchingState } = await import('./SearchingState.tsx');
afterEach(() => { cleanup(); timeouts.length = 0; });

const prefs = { displayName: 'Me', pronouns: 'she/her' } as never;
const show = () => render(<SearchingState mode="quick" prefs={prefs} onCancel={() => {}} onMatched={() => {}} blockedPartnerIds={[]} />);
const css = fs.readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n');

test('the heart vibrates only while searching: on at the start, off when the search ends, on again after Explore again, one element', () => {
  show();
  assert.match(screen.getByTestId('seek-heart').className, /anim-heart-vibe/);
  act(() => timeouts[0]());
  assert.doesNotMatch(screen.getByTestId('seek-heart').className, /anim-heart-vibe/, 'stops the instant the search ends');
  fireEvent.click(screen.getByRole('button', { name: /Explore again/ }));
  assert.match(screen.getByTestId('seek-heart').className, /anim-heart-vibe/, 'restarts');
  assert.equal(screen.getAllByTestId('seek-heart').length, 1, 'never more than one');
});

test('the vibration is plain transform keyframes (translate3d, rotate, scale) on a wrapper, running forever', () => {
  const keyframes = css.slice(css.indexOf('@keyframes qs-heart-vibe'), css.indexOf('@keyframes qs-heart-calm'));
  assert.match(keyframes, /translate3d\(/);
  assert.match(keyframes, /rotate\(/);
  assert.match(keyframes, /scale\(/);
  assert.match(css, /\.anim-heart-vibe \{[^}]*animation: qs-heart-vibe [^;]*infinite;/);
  assert.match(css, /\.anim-heart-vibe \{[^}]*transform-origin: 50% 50%/);
});

test('reduced motion: the page-wide rule that stops every animation is overridden for the heart with a slow pulse (no shaking)', () => {
  const block = css.slice(css.indexOf('.anim-heart-vibe.anim-heart-vibe'));
  assert.match(block, /animation-name: qs-heart-calm !important/);
  assert.match(block, /animation-iteration-count: infinite !important/);
  const calm = css.slice(css.indexOf('@keyframes qs-heart-calm'), css.indexOf('.anim-heart-vibe {'));
  assert.doesNotMatch(calm, /translate|rotate/, 'the calm alternative never moves sideways or tilts');
});
