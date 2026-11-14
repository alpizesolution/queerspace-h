import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CATEGORY_ACCENTS, ComfortCardBubble } from './ComfortCards.tsx';

afterEach(cleanup);

// ---- WCAG contrast, computed here so the colour tokens cannot drift below the targets unnoticed.
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[] | string, b: number[] | string) => { const x = lum(typeof a === 'string' ? rgb(a) : a), y = lum(typeof b === 'string' ? rgb(b) : b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const css = fs.readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n');
const tokens = (selector: string) => {
  const start = css.indexOf(`${selector} {`, css.indexOf('Comfort Cards get their own surface'));
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--(card-[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]));
};
const dark = tokens(':root');
const light = tokens("html[data-theme='light']");

for (const [name, t] of [['dark', dark], ['light', light]] as const) {
  test(`${name} theme: every Comfort Card text colour is 4.5:1 or better on its own surface`, () => {
    assert.equal(Object.keys(t).length, 13, 'all card tokens are defined');
    assert.ok(ratio(t['card-text'], t['card-bg']) >= 4.5, `question text ${ratio(t['card-text'], t['card-bg']).toFixed(2)}`);
    assert.ok(ratio(t['card-label'], t['card-bg']) >= 4.5, `category label ${ratio(t['card-label'], t['card-bg']).toFixed(2)}`);
    assert.ok(ratio(t['card-meta'], t['card-bg']) >= 4.5, `timestamp ${ratio(t['card-meta'], t['card-bg']).toFixed(2)}`);
    for (const fill of ['card-btn-bg', 'card-btn-hover', 'card-btn-active']) {
      assert.ok(ratio(t['card-btn-text'], t[fill]) >= 4.5, `Answer label on ${fill} ${ratio(t['card-btn-text'], t[fill]).toFixed(2)}`);
    }
    assert.ok(ratio(t['card-btn-disabled-text'], t['card-btn-disabled-bg']) >= 4.5, 'disabled Answer stays legible without relying on opacity');
  });

  test(`${name} theme: the Answer button edge, the card edge and the focus ring are 3:1 or better`, () => {
    assert.ok(ratio(t['card-btn-border'], t['card-bg']) >= 3, `button edge on the card ${ratio(t['card-btn-border'], t['card-bg']).toFixed(2)}`);
    assert.ok(ratio(t['card-btn-border'], t['card-btn-bg']) >= 3, 'button edge against its own fill');
    assert.ok(ratio(t['card-focus'], t['card-bg']) >= 3, `focus ring on the card ${ratio(t['card-focus'], t['card-bg']).toFixed(2)}`);
  });
}

test('the card has an edge against every bubble it can sit in, in both themes (by fill or by its edge)', () => {
  const bubbles = { dark: { 'Signals outgoing': '#e07bb8', 'Signals / Seek incoming': '#241829', 'Seek outgoing': '#8e547e' }, light: { 'Signals outgoing': '#a83279', 'Signals / Seek incoming': '#f2edf6', 'Seek outgoing': '#e9d8e8' } };
  for (const [theme, t] of [['dark', dark], ['light', light]] as const) {
    for (const [where, bubble] of Object.entries(bubbles[theme])) {
      const boundary = Math.max(ratio(t['card-bg'], bubble), ratio(t['card-border'], bubble));
      assert.ok(boundary >= 3, `${theme} card in ${where}: ${boundary.toFixed(2)}`);
    }
  }
});

test('category accents: the light-theme shades carry text and a light label, the dark-theme pastels carry dark text, tints included', () => {
  const surface = { dark: rgb('#1a111f'), light: rgb('#ffffff') };
  const ink = { dark: rgb('#120b17'), light: rgb('#fbf9fc') };
  for (const [category, look] of Object.entries(CATEGORY_ACCENTS)) {
    for (const theme of ['dark', 'light'] as const) {
      const accent = look[theme].split(' ').map(Number);
      const selectedChip = over(accent, 0.2, surface[theme]);
      const selectedRow = over(accent, 0.16, surface[theme]);
      assert.ok(ratio(accent, selectedChip) >= 4.5, `${theme} ${category}: selected chip text ${ratio(accent, selectedChip).toFixed(2)}`);
      assert.ok(ratio(ink[theme], accent) >= 4.5, `${theme} ${category}: Send label / check mark on the accent ${ratio(ink[theme], accent).toFixed(2)}`);
      assert.ok(ratio(accent, selectedRow) >= 3, `${theme} ${category}: selected row accent`);
      const edge = over(accent, 0.65, surface[theme]);
      assert.ok(ratio(edge, surface[theme]) >= 3, `${theme} ${category}: unselected chip and row edge ${ratio(edge, surface[theme]).toFixed(2)}`);
    }
  }
});

test('the card carries its own colours: nothing in it inherits text colour from the message bubble or uses opacity for text', () => {
  const src = fs.readFileSync('src/components/ComfortCards.tsx', 'utf8').replace(/\r\n/g, '\n');
  const card = src.slice(src.indexOf('const CardFace'), src.indexOf('interface BubbleProps'));
  assert.match(card, /bg-\[var\(--card-bg\)\]/);
  assert.match(card, /border-\[var\(--card-border\)\]/);
  assert.match(card, /text-\[var\(--card-text\)\]/);
  assert.match(card, /text-\[var\(--card-label\)\]/);
  assert.doesNotMatch(card.replace(/!text-\[rgb\(var\(--accent\)\)\]/, ''), /text-(fg|ink|muted|subtle|lavender)\b|text-\[rgb\(var\(--accent\)\)\]|opacity-/, 'no inherited or faded text colours (the star is decoration)');
  const bubble = src.slice(src.indexOf('export const ComfortCardBubble'));
  assert.match(bubble, /text-\[var\(--card-meta\)\]/, 'timestamp');
  assert.match(bubble, /bg-\[var\(--card-btn-bg\)\]/);
  assert.match(bubble, /text-\[var\(--card-btn-text\)\]/);
  assert.match(bubble, /hover:bg-\[var\(--card-btn-hover\)\]/);
  assert.match(bubble, /active:bg-\[var\(--card-btn-active\)\]/);
  assert.match(bubble, /focus-visible:ring-\[var\(--card-focus\)\]/);
  assert.match(bubble, /disabled:bg-\[var\(--card-btn-disabled-bg\)\]/);
  assert.match(bubble, /disabled:text-\[var\(--card-btn-disabled-text\)\]/);
  assert.match(bubble, /min-h-10/, 'a comfortable touch target (40px)');
  assert.doesNotMatch(bubble, /text-\[rgb\(var\(--accent\)\)\]|text-fg|text-ink/, 'the Answer button never uses the accent or the bubble text colour');
});

test('the timestamp and the Answer button are on the card itself; a card still sending has a disabled Answer', () => {
  const question = { category: 'love' as const, question: 'What is your idea of a perfect low-key date?' };
  const { unmount } = render(<ComfortCardBubble card={question} canAnswer onAnswer={() => {}} time="9:41 PM" />);
  const card = screen.getByTestId('comfort-card');
  assert.ok(within(card).getByText('9:41 PM'));
  const answer = within(card).getByRole('button', { name: /Answer this card/ }) as HTMLButtonElement;
  assert.equal(answer.disabled, false);
  assert.ok(card.contains(answer), 'the button is inside the card surface, not on the bubble');
  unmount();
  render(<ComfortCardBubble card={question} canAnswer pending onAnswer={() => {}} time="9:41 PM" />);
  assert.equal((screen.getByRole('button', { name: /Answer this card/ }) as HTMLButtonElement).disabled, true);
});

test('Signals no longer prints a second timestamp on the bubble for a card: the card shows it on its own surface', () => {
  const convo = fs.readFileSync('src/components/SignalsConversation.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(convo, /time=\{formatTime\(message\.createdAt\)\}/);
  assert.match(convo, /pending=\{unsent\}/);
  assert.match(convo, /\{message\.createdAt && !\(message\.kind === 'card' && message\.card\) && !\(message\.kind === 'test' && message\.test\) && !\(message\.kind === 'game' && message\.game\) && <span/);
});

test('a long question wraps inside the card', () => {
  const long = { category: 'comfort' as const, question: 'What is something you are working through right now, if you want to share it with someone you trust, and what would help most?' };
  render(<ComfortCardBubble card={long} canAnswer onAnswer={() => {}} time="9:41 PM" />);
  const src = fs.readFileSync('src/components/ComfortCards.tsx', 'utf8');
  assert.match(src, /\[overflow-wrap:anywhere\]/);
  assert.ok(screen.getByText(long.question));
});
