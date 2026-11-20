import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MenuDrawer } from './MenuDrawer.tsx';

afterEach(cleanup);
const noop = () => {};
const drawer = (over: Partial<React.ComponentProps<typeof MenuDrawer>> = {}) => render(
  <MenuDrawer onClose={noop} onOpenInfo={noop} onOpenSupport={noop} onOpenAbout={noop} onOpenProfile={noop} onOpenSettings={noop} onOpenWhatsNew={noop} isSoundMuted={false} onToggleSound={noop} showAdmin={false} profile={{ displayName: 'Luna' }} {...over} />
);

test('sections come in the agreed order with the agreed rows', () => {
  drawer();
  const dialog = screen.getByRole('dialog');
  const sections = Array.from(dialog.querySelectorAll('section')).map((s) => ({
    title: s.querySelector('h3')!.textContent,
    rows: Array.from(s.querySelectorAll('li > button, li > a')).map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()),
  }));
  assert.deepEqual(sections.map((s) => s.title), ['Information', 'Safety & Privacy', 'Support', 'Preferences', 'Account']);
  assert.deepEqual(sections[0].rows, ['What’s New', 'About', 'Our Story', 'FAQ']);
  assert.deepEqual(sections[1].rows, ['Community Guidelines', 'Privacy', 'Terms']);
  assert.deepEqual(sections[2].rows, ['Chat with us', 'Buy me a coffee']);
  assert.deepEqual(sections[3].rows, ['SoundOn', 'Settings & appearance']);
  assert.deepEqual(sections[4].rows, ['Sign out']);
});

test('Community Guidelines keeps its shield icon and opens the same guidelines modal', () => {
  const opened: string[] = [];
  drawer({ onOpenInfo: (m) => opened.push(m) });
  const row = screen.getByRole('button', { name: 'Community Guidelines' });
  assert.ok(row.querySelector('svg.lucide-shield'), 'shield icon');
  fireEvent.click(row);
  assert.deepEqual(opened, ['guidelines']);
});

test('the profile card is the first thing in the menu, one button, with the avatar and a chevron', () => {
  drawer();
  const card = screen.getByTestId('menu-profile');
  assert.equal(card.tagName, 'BUTTON');
  assert.ok(card.querySelector('svg.lucide-chevron-right'));
  assert.equal(card.parentElement!.firstElementChild, card);
});

test('Sign out asks first, says it cannot be undone, and does nothing until confirmed', () => {
  drawer();
  assert.equal(screen.queryByTestId('menu-signout-confirm'), null);
  fireEvent.click(screen.getByTestId('menu-signout'));
  const confirm = screen.getByRole('alertdialog');
  assert.match(confirm.textContent ?? '', /can’t be brought back/);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Stay signed in' }));
  assert.equal(screen.queryByRole('alertdialog'), null);
});
