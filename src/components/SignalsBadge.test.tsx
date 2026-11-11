import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { BottomNavigation } from './BottomNavigation.tsx';

afterEach(cleanup);

const nav = (badges: Record<string, number> = {}) => render(<BottomNavigation currentView="home" onNavigate={() => {}} badges={badges as never} />);
const signalsTab = () => screen.getByRole('button', { name: /Signals/ });
const badge = () => within(signalsTab()).queryByLabelText(/pending/);

test('no badge on the Signals icon when there is nothing unread', () => {
  nav({ signals: 0 });
  assert.equal(badge(), null);
  cleanup();
  nav({});
  assert.equal(badge(), null);
});

test('the badge shows the count, from one up to 99', () => {
  for (const n of [1, 7, 10, 42, 99]) {
    nav({ signals: n });
    assert.equal(badge()?.textContent, String(n), `${n}`);
    cleanup();
  }
});

test('above 99 it reads 99+', () => {
  for (const n of [100, 101, 5000]) {
    nav({ signals: n });
    assert.equal(badge()?.textContent, '99+', `${n}`);
    cleanup();
  }
});

test('the badge is small and sits on the icon: it does not change the tab bar, and uses the accent colours', () => {
  nav({ signals: 150 });
  const el = badge()!;
  assert.match(el.className, /absolute/);
  assert.match(el.className, /bg-berry/);
  assert.match(el.className, /text-ink/);
  assert.match(el.className, /rounded-full/);
  assert.match(el.className, /min-w-\[16px\]/);
});

test('only the Signals tab shows it; other tabs keep their own counts', () => {
  nav({ signals: 3, unsaid: 120 });
  const tabs = screen.getAllByRole('button').filter((b) => /Home|Seek|Galaxy|Echoes|Cosmos|Signals/.test(b.textContent ?? ''));
  const withBadge = tabs.filter((t) => within(t).queryByLabelText(/pending/));
  assert.deepEqual(withBadge.map((t) => /Signals|Echoes/.exec(t.textContent ?? '')?.[0]).sort(), ['Echoes', 'Signals']);
  assert.equal(within(screen.getByRole('button', { name: /Echoes/ })).getByLabelText(/pending/).textContent, '99+');
});
