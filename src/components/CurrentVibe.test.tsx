import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VIBE_MOODS, parseVibe, type VibeView } from '../utils/currentVibe.ts';

/**
 * The Current Vibe screens, rendered and used. Only the service that reaches the server is replaced, so every check here is about
 * what the screen does with what it is given and what it sends; the server's rules are proved by the emulator tests.
 */
type Published = { moodId: string; message: string; visibility: string };
const published: Published[] = [];
let result: { ok: true; vibe: VibeView } | { ok: false; reason: 'invalid' | 'not-allowed' | 'rate-limited' | 'failed' } | null = null;
let gate: Promise<void> | null = null;
mock.module('../services/currentVibeService.ts', {
  namedExports: {
    publishCurrentVibe: async (input: Published) => { published.push(input); if (gate) await gate; return result!; },
    removeCurrentVibe: async () => ({ ok: true, vibe: null }),
    fetchMemberVibe: async () => null,
    clearVibeCache: () => {},
    vibeProblemText: (reason: string) => `problem:${reason}`,
  },
});
const { CurrentVibeCard, CurrentVibeSheet, SetVibePrompt, VibeChip } = await import('./CurrentVibe.tsx');

const NOW = Date.now();
const vibe = (over: Record<string, unknown> = {}): VibeView =>
  parseVibe({ moodId: 'healing', message: 'Taking life one day at a time.', updatedAt: new Date(NOW - 2 * 3_600_000).toISOString(), expiresAt: new Date(NOW + 22 * 3_600_000).toISOString(), visibility: 'everyone', ...over })!;

beforeEach(() => { published.length = 0; gate = null; result = { ok: true, vibe: vibe() }; });
afterEach(cleanup);

const open = (props: Partial<React.ComponentProps<typeof CurrentVibeSheet>> = {}) => {
  const calls = { published: [] as VibeView[], closed: 0 };
  render(<CurrentVibeSheet onPublished={(v) => calls.published.push(v)} onClose={() => { calls.closed++; }} {...props} />);
  return calls;
};
const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(label) });
const preview = () => screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement;

// ------------------------------------------------------------------------------------------------------------------ the editor
test('the sheet offers all fourteen moods as selectable cards, none chosen at first, and a visibility choice', () => {
  open();
  assert.ok(screen.getByRole('dialog', { name: 'Current Vibe' }));
  const group = screen.getByRole('radiogroup', { name: 'Choose a mood' });
  assert.equal(within(group).getAllByRole('radio').length, 14);
  for (const mood of VIBE_MOODS) assert.ok(within(group).getByRole('radio', { name: new RegExp(mood.label) }), mood.label);
  assert.equal(within(group).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').length, 0);
  assert.ok(screen.getByText('Who can see my Current Vibe?'));
  assert.equal((screen.getByRole('radio', { name: /Everyone who can view my profile/ }) as HTMLInputElement).checked, true, 'the widest is the default');
  assert.ok(screen.getByRole('button', { name: 'Cancel' }));
});

test('each mood can be selected, and the selected one is obvious (checked, and only one at a time)', () => {
  open();
  for (const mood of VIBE_MOODS) {
    fireEvent.click(radio(mood.label));
    const checked = within(screen.getByRole('radiogroup', { name: 'Choose a mood' })).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    assert.equal(checked.length, 1, mood.label);
    assert.match(checked[0].textContent ?? '', new RegExp(mood.label));
    assert.match(checked[0].className, /border-berry/, 'a visible selected style, not only a checked flag');
  }
});

test('Preview needs a mood and nothing more: a mood alone is enough, with no message', () => {
  open();
  assert.equal(preview().disabled, true, 'no mood yet');
  fireEvent.click(radio('Healing'));
  assert.equal(preview().disabled, false, 'a mood alone is enough');
});

test('the message is optional, counted as you type, and cannot go past 100 characters', () => {
  open();
  fireEvent.click(radio('Happy'));
  const box = screen.getByLabelText(/Add a short note/) as HTMLInputElement;
  assert.ok(screen.getByText('0/100'));
  fireEvent.change(box, { target: { value: 'Feeling good' } });
  assert.ok(screen.getByText('12/100'));
  fireEvent.change(box, { target: { value: 'x'.repeat(100) } });
  assert.ok(screen.getByText('100/100'));
  assert.equal(preview().disabled, false, 'exactly 100 is allowed');
  fireEvent.change(box, { target: { value: 'x'.repeat(101) } });
  assert.ok(screen.getByText('101/100'));
  assert.ok(screen.getByRole('alert'), 'a message says why');
  assert.equal(preview().disabled, true, 'it cannot be previewed or published over the limit');
  fireEvent.change(box, { target: { value: '🌱'.repeat(100) } });
  assert.ok(screen.getByText('100/100'), 'an emoji counts as one');
  assert.equal(preview().disabled, false);
});

test('preview shows exactly the card that will be published, with the lifetime and who can see it; Edit keeps everything', () => {
  open();
  fireEvent.click(radio('Healing'));
  fireEvent.change(screen.getByLabelText(/Add a short note/), { target: { value: '  Taking   it slow ' } });
  fireEvent.click(screen.getByRole('radio', { name: /Approved connections only/ }));
  fireEvent.click(preview());
  const card = within(screen.getByTestId('vibe-preview'));
  assert.ok(card.getByText('Healing'));
  assert.ok(card.getByText('“Taking it slow”'), 'tidied, as it will be saved');
  assert.ok(card.getAllByText(/Expires in 24 hours/).length >= 1);
  assert.ok(card.getByText(/Visible to: Approved connections only/));
  assert.equal(published.length, 0, 'nothing is saved by previewing');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  assert.equal((screen.getByLabelText(/Add a short note/) as HTMLInputElement).value, '  Taking   it slow ');
  assert.equal(radio('Healing').getAttribute('aria-checked'), 'true');
  assert.equal((screen.getByRole('radio', { name: /Approved connections only/ }) as HTMLInputElement).checked, true);
});

test('Cancel closes without saving anything', () => {
  const calls = open();
  fireEvent.click(radio('Sad'));
  fireEvent.change(screen.getByLabelText(/Add a short note/), { target: { value: 'never mind' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(calls.closed, 1);
  assert.equal(published.length, 0);
  assert.equal(calls.published.length, 0);
});

test('Publish sends the mood id, the tidied message and the choice once, even if tapped twice, then hands back the saved status', async () => {
  let release!: () => void;
  gate = new Promise<void>((resolve) => { release = resolve; });
  const calls = open();
  fireEvent.click(radio('Grateful'));
  fireEvent.change(screen.getByLabelText(/Add a short note/), { target: { value: ' Thank you ' } });
  fireEvent.click(screen.getByRole('radio', { name: /Nobody/ }));
  fireEvent.click(preview());
  const publish = screen.getByRole('button', { name: 'Publish' });
  fireEvent.click(publish);
  fireEvent.click(screen.getByRole('button', { name: /Publishing/ }));
  assert.deepEqual(published, [{ moodId: 'grateful', message: ' Thank you ', visibility: 'nobody' }]);
  assert.equal((screen.getByRole('button', { name: /Publishing/ }) as HTMLButtonElement).disabled, true);
  release();
  await waitFor(() => assert.equal(calls.published.length, 1));
  assert.equal(published.length, 1, 'one request');
});

test('a failed publish shows why, keeps the sheet open and lets the member try again', async () => {
  result = { ok: false, reason: 'rate-limited' };
  const calls = open();
  fireEvent.click(radio('Happy'));
  fireEvent.click(preview());
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  assert.equal((await screen.findByRole('alert')).textContent, 'problem:rate-limited');
  assert.equal(calls.published.length, 0);
  assert.ok(screen.getByRole('button', { name: 'Publish' }), 'still there to try again');
  result = { ok: true, vibe: vibe() };
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => assert.equal(calls.published.length, 1));
});

test('editing an existing status starts from it: its mood, message and setting, ready to publish again', () => {
  open({ existing: vibe({ moodId: 'lonely', message: 'quiet night', visibility: 'connections' }) });
  assert.equal(radio('Lonely').getAttribute('aria-checked'), 'true');
  assert.equal((screen.getByLabelText(/Add a short note/) as HTMLInputElement).value, 'quiet night');
  assert.equal((screen.getByRole('radio', { name: /Approved connections only/ }) as HTMLInputElement).checked, true);
  assert.equal(preview().disabled, false);
});

// ------------------------------------------------------------------------------------------------------------------ the card, prompt and chip
test('the card shows the mood, the message and when it was updated and ends', () => {
  render(<CurrentVibeCard vibe={vibe()} />);
  const card = within(screen.getByTestId('current-vibe'));
  assert.ok(card.getByText('Current Vibe'));
  assert.ok(card.getByText('Healing'));
  assert.ok(card.getByText('🌱'));
  assert.ok(card.getByText('“Taking life one day at a time.”'));
  assert.ok(card.getByText('Updated 2 hours ago · Expires in 22 hours'));
});

test('without a message the card is just the mood and the times, with no empty quotes', () => {
  render(<CurrentVibeCard vibe={vibe({ message: null })} />);
  assert.equal(screen.queryByText(/“/), null);
  assert.ok(screen.getByText('Healing'));
});

test('on someone else\'s profile the card has no actions and no setting; on your own it has Edit Mood, Remove Mood and who can see it', () => {
  const edits: string[] = [];
  const { unmount } = render(<CurrentVibeCard vibe={vibe()} />);
  assert.equal(screen.queryByRole('button'), null);
  assert.equal(screen.queryByText(/Visible to/), null);
  unmount();
  render(<CurrentVibeCard vibe={vibe({ visibility: 'connections' })} self onEdit={() => edits.push('edit')} onRemove={() => edits.push('remove')} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit Mood/ }));
  fireEvent.click(screen.getByRole('button', { name: /Remove Mood/ }));
  assert.deepEqual(edits, ['edit', 'remove']);
  assert.ok(screen.getByText(/Visible to: Approved connections only/));
});

test('a long message and a long unbroken word wrap inside the card instead of overflowing', () => {
  render(<CurrentVibeCard vibe={vibe({ message: 'x'.repeat(100) })} />);
  const quote = screen.getByText(/x{100}/);
  assert.match(quote.className, /\[overflow-wrap:anywhere\]/);
  assert.match(screen.getByTestId('current-vibe').className, /rounded-2xl/);
});

test('the prompt is one quiet button, and the chip shows only an emoji and the mood name', () => {
  let taps = 0;
  const { unmount } = render(<SetVibePrompt onClick={() => { taps++; }} />);
  fireEvent.click(screen.getByRole('button', { name: /Set your Current Vibe/ }));
  assert.equal(taps, 1);
  unmount();
  render(<VibeChip vibe={vibe()} />);
  const chip = screen.getByTestId('vibe-chip');
  assert.equal(chip.textContent, '🌱Healing', 'no message in the chip');
  assert.match(chip.getAttribute('title') ?? '', /Taking life one day at a time/, 'the full status is in the tooltip');
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
  test(`${name} theme: the card's text, the time line, the actions and the chip are all 4.5:1 or better`, () => {
    const ink = rgb(t.ink), raised = rgb(t.raised), plum = rgb(t.plum);
    // The darkest/lightest the card background gets: the plum corner of the gradient, and the plain raised panel.
    const surfaces = [over(plum, 0.3, ink), over(raised, 0.5, ink)];
    for (const surface of surfaces) {
      for (const text of ['fg', 'muted', 'berry', 'danger']) assert.ok(ratio(rgb(t[text]), surface) >= 4.5, `${text} on the card ${ratio(rgb(t[text]), surface).toFixed(2)}`);
    }
    assert.ok(ratio(rgb(t.lavender), ink) >= 4.5, 'the Set your Current Vibe prompt on the page');
    assert.ok(ratio(rgb(t.fg), over(plum, 0.25, ink)) >= 4.5, 'the chip text on its tint');
    assert.ok(ratio(rgb(t.fg), rgb(t.raised)) >= 4.5 && ratio(rgb(t.muted), rgb(t.raised)) >= 4.5, 'mood cards in the editor');
  });
}

test('layout: the editor and card use theme tokens only (no fixed colours or widths), and touch targets are at least 44px', () => {
  const src = fs.readFileSync('src/components/CurrentVibe.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b|rgb\(|\bw-\[\d+px\]|min-w-\[\d+/, 'no fixed colours or widths');
  assert.equal((src.match(/min-h-11/g) || []).length >= 6, true, 'Edit, Remove, the prompt, the note, the choices and the buttons are 44px tall');
  assert.match(src, /min-h-\[3\.5rem\]/, 'a mood card is 56px tall');
  assert.match(src, /grid-cols-3 gap-2 sm:grid-cols-4/, 'three across on a phone, four on larger screens');
});
