import '../../test/dom-setup.ts';
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/** The real Seek searching screen: when the search times out it shows the "stars" empty state. */
const timeouts: Array<() => void> = [];
let starts = 0;
mock.module('../utils/search-attempt.ts', {
  namedExports: { startSearchAttempt: ({ onTimeout }: { onTimeout: () => void }) => { starts++; timeouts.push(onTimeout); return () => {}; } },
});
const { SearchingState } = await import('./SearchingState.tsx');

afterEach(() => { cleanup(); timeouts.length = 0; starts = 0; });

const prefs = { displayName: 'Me', pronouns: 'she/her' } as never;
const show = (onCancel = () => {}) => render(<SearchingState mode="quick" prefs={prefs} onCancel={onCancel} onMatched={() => {}} blockedPartnerIds={[]} />);

test('while searching there is no empty state; when the search times out it shows the approved copy', () => {
  show();
  assert.equal(screen.queryByText('Your next connection might be just around the corner.'), null);
  act(() => timeouts[0]());
  assert.ok(screen.getByRole('heading', { name: "The stars haven't crossed paths yet." }));
  assert.ok(screen.getByText('Your next connection might be just around the corner.'));
  assert.ok(screen.getByRole('button', { name: /Explore again/ }));
  assert.ok(screen.getByRole('button', { name: 'Cancel' }));
  assert.ok(screen.getByText('Anonymous and protected'));
});

test('the old empty-state wording is gone from the screen and the source', () => {
  show();
  act(() => timeouts[0]());
  assert.equal(screen.queryByText("No one's around yet"), null);
  assert.equal(screen.queryByText(/still finding their way/), null);
  assert.equal(screen.queryByRole('button', { name: /Try again/ }), null);
  const src = fs.readFileSync('src/components/SearchingState.tsx', 'utf8');
  assert.doesNotMatch(src, /No one's around yet|finding their way/);
  assert.equal(fs.existsSync('src/utils/seekEmptyMessage.ts'), false, 'no second copy of the empty-state wording');
});

test('Explore again restarts the search and Cancel still cancels', () => {
  let cancelled = 0;
  show(() => { cancelled++; });
  act(() => timeouts[0]());
  const before = starts;
  fireEvent.click(screen.getByRole('button', { name: /Explore again/ }));
  assert.equal(starts, before + 1, 'a new search attempt begins');
  assert.equal(screen.queryByText('Your next connection might be just around the corner.'), null, 'back to searching');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(cancelled, 1);
});
