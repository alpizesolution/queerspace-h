import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COMMON_EMOJI, parseVibe, type VibeView } from '../utils/currentVibe.ts';

/**
 * The custom status screens, rendered and used. Only the service that reaches the server is replaced, so every check here is about
 * what the screen does with what it is given and what it sends; the server's rules are proved by the emulator tests.
 */
type Saved = { emoji: string; message: string; visibility: string };
const saved: Saved[] = [];
let removed = 0;
let result: { ok: true; vibe: VibeView } | { ok: false; reason: 'invalid' | 'not-allowed' | 'rate-limited' | 'failed' } = { ok: false, reason: 'failed' };
let removeResult: { ok: true; vibe: null } | { ok: false; reason: 'failed' } = { ok: true, vibe: null };
let gate: Promise<void> | null = null;
mock.module('../services/currentVibeService.ts', {
  namedExports: {
    publishCurrentVibe: async (input: Saved) => { saved.push(input); if (gate) await gate; return result; },
    removeCurrentVibe: async () => { removed++; return removeResult; },
    fetchMemberVibe: async () => null,
    clearVibeCache: () => {},
    vibeProblemText: (reason: string) => `problem:${reason}`,
  },
});
const { AddStatusPill, CurrentVibeSheet, VibeBubble, VibeChip } = await import('./CurrentVibe.tsx');

const NOW = Date.now();
const vibe = (over: Record<string, unknown> = {}): VibeView =>
  parseVibe({ emoji: '🌙', message: 'taking it slow', updatedAt: new Date(NOW - 2 * 3_600_000).toISOString(), expiresAt: new Date(NOW + 22 * 3_600_000).toISOString(), visibility: 'everyone', ...over })!;

beforeEach(() => { saved.length = 0; removed = 0; gate = null; result = { ok: true, vibe: vibe() }; removeResult = { ok: true, vibe: null }; });
afterEach(cleanup);

const open = (props: Partial<React.ComponentProps<typeof CurrentVibeSheet>> = {}) => {
  const calls = { published: [] as VibeView[], cleared: 0, closed: 0 };
  render(<CurrentVibeSheet onPublished={(v) => calls.published.push(v)} onCleared={() => { calls.cleared++; }} onClose={() => { calls.closed++; }} {...props} />);
  return calls;
};
const messageBox = () => screen.getByLabelText('Your status message') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const pickEmoji = (emoji: string) => fireEvent.click(screen.getByRole('button', { name: `Use ${emoji}` }));

// ------------------------------------------------------------------------------------------------------------------ the editor
test('the editor is one compact sheet: an emoji picker of common emoji, a free message box, who can see it, and Cancel and Save; no mood list', () => {
  open();
  assert.ok(screen.getByRole('dialog', { name: 'Set your status' }));
  const picker = within(screen.getByTestId('emoji-picker'));
  assert.equal(picker.getAllByRole('button').length, COMMON_EMOJI.length);
  assert.ok(messageBox());
  assert.ok(screen.getByText('Who can see my status?'));
  assert.ok(screen.getByRole('button', { name: 'Cancel' }));
  assert.ok(screen.queryByRole('radiogroup', { name: /mood/i }) === null, 'no predefined mood categories');
  assert.ok(screen.queryByRole('button', { name: 'Preview' }) === null, 'the preview is live, not a separate step');
});

test('the message is free text: whatever the member writes, up to 60 characters, with a count of what is left', () => {
  open();
  assert.ok(screen.getByText('60 characters left'));
  fireEvent.change(messageBox(), { target: { value: 'overwhelmed rn' } });
  assert.ok(screen.getByText('46 characters left'));
  assert.equal(messageBox().value, 'overwhelmed rn');
  fireEvent.change(messageBox(), { target: { value: 'x'.repeat(80) } });
  assert.equal(messageBox().value.length, 60, 'it cannot go past 60');
  assert.ok(screen.getByText('0 characters left'));
  fireEvent.change(messageBox(), { target: { value: '🌱'.repeat(80) } });
  assert.equal([...messageBox().value].length, 60, 'an emoji counts as one character');
});

test('Save needs an emoji or some words, but either one alone is enough', () => {
  open();
  assert.equal(save().disabled, true, 'nothing yet');
  pickEmoji('☕');
  assert.equal(save().disabled, false, 'an emoji alone');
  fireEvent.click(screen.getByRole('button', { name: /Emoji: ☕/ }));
  fireEvent.click(screen.getByRole('button', { name: 'No emoji, just words' }));
  assert.equal(save().disabled, true, 'neither again');
  fireEvent.change(messageBox(), { target: { value: 'need coffee' } });
  assert.equal(save().disabled, false, 'words alone');
});

test('the preview is the bubble itself and updates as you type', () => {
  open();
  const preview = within(screen.getByTestId('status-preview'));
  assert.ok(preview.getByText(/Pick an emoji or write a few words/));
  pickEmoji('🦋');
  fireEvent.change(messageBox(), { target: { value: 'healing quietly' } });
  const bubble = preview.getByTestId('vibe-bubble');
  assert.match(bubble.textContent ?? '', /🦋/);
  assert.match(bubble.textContent ?? '', /healing quietly/);
  fireEvent.change(messageBox(), { target: { value: '  healing   quietly  ' } });
  assert.match(preview.getByTestId('vibe-bubble').textContent ?? '', /healing quietly/, 'tidied, as it will be saved');
});

test('choosing an emoji closes the picker; the emoji button reopens it', () => {
  open();
  assert.ok(screen.queryByTestId('emoji-picker') !== null, 'open for a new status');
  pickEmoji('💜');
  assert.ok(screen.queryByTestId('emoji-picker') === null);
  fireEvent.click(screen.getByRole('button', { name: /Emoji: 💜/ }));
  assert.ok(screen.queryByTestId('emoji-picker') !== null);
});

test('Cancel closes without saving anything', () => {
  const calls = open();
  pickEmoji('😔');
  fireEvent.change(messageBox(), { target: { value: 'never mind' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(calls.closed, 1);
  assert.equal(saved.length, 0);
  assert.equal(calls.published.length, 0);
});

test('Save sends the emoji, the message and the choice once, even if tapped twice, then hands back the saved status', async () => {
  let release!: () => void;
  gate = new Promise<void>((resolve) => { release = resolve; });
  const calls = open();
  pickEmoji('💜');
  fireEvent.change(messageBox(), { target: { value: ' feeling loved ' } });
  fireEvent.click(screen.getByRole('radio', { name: /Nobody/ }));
  fireEvent.click(save());
  fireEvent.click(screen.getByRole('button', { name: /Saving/ }));
  assert.deepEqual(saved, [{ emoji: '💜', message: ' feeling loved ', visibility: 'nobody' }]);
  assert.equal((screen.getByRole('button', { name: /Saving/ }) as HTMLButtonElement).disabled, true);
  release();
  await waitFor(() => assert.equal(calls.published.length, 1));
  assert.equal(saved.length, 1, 'one request');
});

test('words alone are saved with no emoji', async () => {
  const calls = open();
  fireEvent.change(messageBox(), { target: { value: 'need coffee' } });
  fireEvent.click(save());
  await waitFor(() => assert.equal(calls.published.length, 1));
  assert.deepEqual(saved, [{ emoji: '', message: 'need coffee', visibility: 'everyone' }]);
});

test('a failed save shows why, keeps the sheet open and lets the member try again', async () => {
  result = { ok: false, reason: 'rate-limited' };
  const calls = open();
  pickEmoji('😊');
  fireEvent.click(save());
  assert.equal((await screen.findByRole('alert')).textContent, 'problem:rate-limited');
  assert.equal(calls.published.length, 0);
  result = { ok: true, vibe: vibe() };
  fireEvent.click(save());
  await waitFor(() => assert.equal(calls.published.length, 1));
});

test('the visibility choices are the existing three, and the first is the default', () => {
  open();
  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  assert.deepEqual(radios.map((r) => r.getAttribute('aria-label')), ['Everyone who can view my profile', 'Approved connections only', 'Nobody']);
  assert.deepEqual(radios.map((r) => r.checked), [true, false, false]);
  fireEvent.click(radios[1]);
  assert.equal((screen.getAllByRole('radio') as HTMLInputElement[])[1].checked, true);
});

test('editing a status starts from it, says when it clears, and offers Clear', () => {
  open({ existing: vibe({ emoji: '🌱', message: 'one day at a time', visibility: 'connections' }) });
  assert.ok(screen.getByRole('dialog', { name: 'Edit status' }));
  assert.equal(messageBox().value, 'one day at a time');
  assert.ok(screen.getByRole('button', { name: /Emoji: 🌱/ }));
  assert.equal((screen.getAllByRole('radio') as HTMLInputElement[])[1].checked, true);
  assert.ok(screen.getByText(/Clears in 22 hours/));
  assert.ok(screen.getByRole('button', { name: 'Clear' }));
  assert.ok(screen.queryByTestId('emoji-picker') === null, 'the picker stays closed when there is already an emoji');
});

test('Clear removes the status once and tells the page; a failure leaves it and says so', async () => {
  const calls = open({ existing: vibe() });
  removeResult = { ok: false, reason: 'failed' };
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  assert.equal((await screen.findByRole('alert')).textContent, 'problem:failed');
  assert.equal(calls.cleared, 0);
  removeResult = { ok: true, vibe: null };
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() => assert.equal(calls.cleared, 1));
  assert.equal(removed, 2);
});

test('a new status has no Clear button, and says it clears on its own after 24 hours', () => {
  open();
  assert.ok(screen.queryByRole('button', { name: 'Clear' }) === null);
  assert.ok(screen.getByText(/Clears on its own 24 hours after you save it/));
});

// ------------------------------------------------------------------------------------------------------------------ the bubble, pill and chip
test('the bubble is a small pill with the emoji and the message, and no time or heading on it', () => {
  render(<VibeBubble vibe={vibe()} />);
  const bubble = screen.getByTestId('vibe-bubble');
  assert.match(bubble.textContent ?? '', /🌙/);
  assert.match(bubble.textContent ?? '', /taking it slow/);
  assert.doesNotMatch(bubble.textContent ?? '', /Updated|Clears|Expires|hours|Current Vibe/);
  assert.match(bubble.className, /rounded-2xl/);
  assert.match(bubble.getAttribute('title') ?? '', /Clears in 22 hours/, 'the time left is in the tooltip');
  assert.match(bubble.getAttribute('title') ?? '', /Manila time/);
});

test('an emoji-only or words-only status still makes a bubble', () => {
  const { unmount } = render(<VibeBubble vibe={vibe({ message: null })} />);
  assert.equal(screen.getByTestId('vibe-bubble').textContent, '🌙');
  unmount();
  render(<VibeBubble vibe={vibe({ emoji: '' })} />);
  assert.equal(screen.getByTestId('vibe-bubble').textContent, 'taking it slow');
});

test('on your own profile a tap on the bubble edits the status', () => {
  const taps: string[] = [];
  render(<VibeBubble vibe={vibe()} self onEdit={() => taps.push('edit')} />);
  const bubble = screen.getByTestId('vibe-bubble');
  assert.match(bubble.getAttribute('aria-label') ?? '', /Edit status/);
  fireEvent.click(bubble);
  assert.deepEqual(taps, ['edit']);
});

test('on someone else\'s a tap spreads a long message over a few lines instead of cutting it with an ellipsis, and back', () => {
  render(<VibeBubble vibe={vibe({ message: 'x'.repeat(60) })} />);
  const bubble = screen.getByTestId('vibe-bubble');
  const text = bubble.querySelector('span:last-child') as HTMLElement;
  assert.match(text.className, /truncate/);
  assert.equal(bubble.getAttribute('aria-expanded'), 'false');
  fireEvent.click(bubble);
  assert.equal(bubble.getAttribute('aria-expanded'), 'true');
  assert.doesNotMatch(text.className, /truncate/);
  assert.match(text.className, /\[overflow-wrap:anywhere\]/);
  fireEvent.click(bubble);
  assert.match(text.className, /truncate/);
});

test('the Add status pill is one quiet button', () => {
  let taps = 0;
  render(<AddStatusPill onClick={() => { taps++; }} />);
  fireEvent.click(screen.getByRole('button', { name: /Add status/ }));
  assert.equal(taps, 1);
  assert.match(screen.getByTestId('add-status').className, /border-dashed/);
});

test('the header chip shows the emoji and a cut-off message, never a long one in full', () => {
  render(<VibeChip vibe={vibe({ message: 'x'.repeat(60) })} />);
  const chip = screen.getByTestId('vibe-chip');
  assert.match(chip.className, /max-w-\[9\.5rem\]/);
  assert.match(chip.querySelector('span:last-child')!.className, /truncate/);
  assert.match(chip.getAttribute('title') ?? '', /x{60}/, 'the whole message is in the tooltip');
});

// ------------------------------------------------------------------------------------------------------------------ themes and layout
const css = fs.readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n');
const tokens = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]));
};
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

for (const [name, t] of [['dark', tokens('@theme')], ['light', tokens("html[data-theme='light']")]] as const) {
  test(`${name} theme: the bubble text and the Add status pill are 4.5:1 or better, even over the lightest or darkest cover image`, () => {
    const ink = rgb(t.ink);
    for (const cover of [[0, 0, 0], [255, 255, 255], rgb(t.plum), rgb(t.berry)]) {
      assert.ok(ratio(rgb(t.fg), over(ink, 0.9, cover)) >= 4.5, `bubble text over cover ${cover}: ${ratio(rgb(t.fg), over(ink, 0.9, cover)).toFixed(2)}`);
      assert.ok(ratio(rgb(t.lavender), over(ink, 0.9, cover)) >= 4.5, `pill text over cover ${cover}: ${ratio(rgb(t.lavender), over(ink, 0.9, cover)).toFixed(2)}`);
    }
    assert.ok(ratio(rgb(t.fg), over(rgb(t.plum), 0.25, ink)) >= 4.5, 'the header chip text on its tint');
    assert.ok(ratio(rgb(t.fg), rgb(t.raised)) >= 4.5 && ratio(rgb(t.muted), rgb(t.raised)) >= 4.5, 'the editor text');
  });
}

test('layout: theme tokens only, one line with an ellipsis, a bigger touch area than the pill, and 44px controls in the editor', () => {
  const src = fs.readFileSync('src/components/CurrentVibe.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b|rgb\(|\bw-\[\d+px\]/, 'no fixed colours or widths');
  assert.match(src, /after:-inset-y-2/, 'the pill is small but the tap area is not');
  assert.match(src, /h-11 w-11 shrink-0/, 'the emoji button is 44px');
  assert.match(src, /grid grid-cols-6 gap-1/, 'six emoji across: 44px cells even on a 320px phone');
  assert.match(src, /flex h-11 items-center justify-center rounded-xl text-xl/, 'every emoji is 44px tall');
  assert.equal((src.match(/min-h-11/g) || []).length >= 4, true);
  assert.doesNotMatch(src, />\s*Current Vibe\s*</i, 'no section heading or card title on the profile');
});
