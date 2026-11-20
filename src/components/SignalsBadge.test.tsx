import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Header } from './Header.tsx';
import { BottomNavigation, NAV_ITEMS } from './BottomNavigation.tsx';

afterEach(cleanup);

const noop = () => {};
const header = (badges: Record<string, number> = {}, onNavigate: (v: string) => void = noop, currentView = 'home') => render(
  <Header
    onNavigate={onNavigate as never} badges={badges as never} currentView={currentView} isSoundMuted={false} onToggleSound={noop}
    onOpenProfile={noop} onOpenSettings={noop} onOpenWhatsNew={noop} onOpenInfo={noop} onOpenSupport={noop} onOpenAbout={noop}
    profile={{ displayName: 'Luna' }}
  />
);
const inbox = () => screen.getByTestId('header-inbox');
const badge = () => within(inbox()).queryByText(/^\d+\+?$/);

test('no badge on the Inbox icon when there is nothing unread', () => {
  header({ signals: 0 });
  assert.equal(badge(), null);
  assert.equal(inbox().getAttribute('aria-label'), 'Open inbox');
  cleanup();
  header({});
  assert.equal(badge(), null);
});

test('the badge shows the count, from one up to 99, and the button says so to screen readers', () => {
  for (const n of [1, 7, 10, 42, 99]) {
    header({ signals: n });
    assert.equal(badge()?.textContent, String(n), `${n}`);
    assert.equal(inbox().getAttribute('aria-label'), `Open inbox, ${n} unread`);
    cleanup();
  }
});

test('above 99 it reads 99+', () => {
  for (const n of [100, 101, 5000]) {
    header({ signals: n });
    assert.equal(badge()?.textContent, '99+', `${n}`);
    cleanup();
  }
});

test('the badge is small and sits on the icon, in the accent colours', () => {
  header({ signals: 150 });
  const el = badge()!;
  assert.match(el.className, /absolute/);
  assert.match(el.className, /bg-berry/);
  assert.match(el.className, /text-ink/);
  assert.match(el.className, /rounded-full/);
  assert.match(el.className, /min-w-\[16px\]/);
});

test('the Inbox opens Signals (the existing view and unread logic) and is marked current there', () => {
  const went: string[] = [];
  header({ signals: 2 }, (v) => went.push(v));
  fireEvent.click(inbox());
  assert.deepEqual(went, ['signals']);
  cleanup();
  header({}, noop, 'signals');
  assert.equal(inbox().getAttribute('aria-current'), 'page');
});

test('the header reads Logo, status, Inbox, Menu: no shield and no avatar button', () => {
  header();
  assert.equal(screen.queryByRole('button', { name: /Safety and community guidelines/ }), null);
  assert.equal(screen.queryByRole('button', { name: 'Your profile' }), null);
  const row = screen.getByRole('banner').querySelector('.ml-auto')!;
  const order = Array.from(row.children).map((el) => (el.getAttribute('role') === 'status' ? 'status' : el.getAttribute('data-testid') === 'header-inbox' ? 'inbox' : el.getAttribute('aria-label') === 'Open menu' ? 'menu' : 'other'));
  assert.deepEqual(order.filter((o) => o !== 'other'), ['status', 'inbox', 'menu']);
  assert.equal(order.indexOf('inbox'), order.indexOf('status') + 1, 'Inbox sits right after the status');
  assert.equal(order[order.length - 1], 'menu', 'the menu is last, at the far right');
});

test('the bottom bar has exactly six tabs, Atlas sixth, and Signals is not one of them', () => {
  assert.deepEqual(NAV_ITEMS.map((item) => item.label), ['Home', 'Seek', 'Galaxy', 'Echoes', 'Cosmos', 'Atlas']);
  const went: string[] = [];
  render(<BottomNavigation currentView="home" onNavigate={(v) => went.push(v)} badges={{ signals: 4, unsaid: 120 }} />);
  assert.equal(screen.getAllByRole('button').length, 6);
  assert.equal(screen.queryByRole('button', { name: /Signals/ }), null);
  assert.equal(within(screen.getByRole('button', { name: /Echoes/ })).getByLabelText(/pending/).textContent, '99+');
  assert.equal(within(screen.getByRole('button', { name: /Atlas/ })).queryByLabelText(/pending/), null, 'the Signals count lives on the Inbox, not on Atlas');
  fireEvent.click(screen.getByRole('button', { name: /Atlas/ }));
  assert.deepEqual(went, ['atlas']);
});
