import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceSettingsModal } from './AppearanceSettingsModal.tsx';

/** On phones the Appearance modal shows only theme and text size; the NSFW section and the What’s New row are hidden below the sm breakpoint. */
afterEach(cleanup);

const show = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  render(<AppearanceSettingsModal theme="dark" onChangeTheme={(t) => calls.push(`theme:${t}`)} fontSize={'medium' as never} onChangeFontSize={(s) => calls.push(`size:${s}`)} nsfwPreference={'hide' as never} onChangeNsfwPreference={() => {}} onOpenWhatsNew={() => {}} onClose={() => calls.push('close')} {...over} />);
  return calls;
};

test('the NSFW section and the What’s New row are hidden on phones and kept from the sm breakpoint up', () => {
  show();
  const nsfw = screen.getByText('Show NSFW content').closest('div') as HTMLElement;
  assert.match(nsfw.className, /\bhidden\b/);
  assert.match(nsfw.className, /\bsm:block\b/);
  const whatsNew = screen.getByText(/What’s New/).closest('button') as HTMLElement;
  assert.match(whatsNew.className, /\bhidden\b/);
  assert.match(whatsNew.className, /\bsm:flex\b/);
});

test('everything else stays: label, heading, description, close, themes, text sizes and the preview', () => {
  const calls = show();
  assert.ok(screen.getByText('Preferences'));
  assert.ok(screen.getByRole('heading', { name: 'Appearance' }));
  assert.ok(screen.getByText('Choose how QUEERSPACE looks on this device.'));
  fireEvent.click(screen.getByRole('button', { name: /Light/ }));
  assert.ok(screen.getByRole('button', { name: /Dark/ }));
  for (const label of ['Tiny', 'Small', 'Medium', 'Large']) assert.ok(screen.getByRole('radio', { name: label }));
  fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
  assert.ok(screen.getByText(/This is how messages and posts will read/));
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  assert.deepEqual(calls, ['theme:light', 'size:large', 'close']);
});
