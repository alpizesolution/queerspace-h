import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TwoTruthsCard, TwoTruthsCreator } from './TwoTruthsGame.tsx';
import type { Challenge, GameCard } from '../utils/twoTruths.ts';

afterEach(cleanup);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- the creator
const fill = (a: string, b: string, c: string) => {
  fireEvent.change(screen.getByLabelText('Statement 1'), { target: { value: a } });
  fireEvent.change(screen.getByLabelText('Statement 2'), { target: { value: b } });
  fireEvent.change(screen.getByLabelText('Statement 3'), { target: { value: c } });
};
const open = (onSend: (c: Challenge) => void = () => {}, onClose = () => {}) => render(<TwoTruthsCreator onSend={onSend} onClose={onClose} />);

test('the sheet has the three statements, one lie choice each, an optional note, and Cancel and Preview', () => {
  open();
  assert.ok(screen.getByRole('dialog', { name: 'Two Truths and a Lie' }));
  for (const n of [1, 2, 3]) {
    assert.ok(screen.getByLabelText(`Statement ${n}`));
    assert.ok(screen.getByRole('radio', { name: `Statement ${n} is the lie` }));
  }
  assert.ok(screen.getByLabelText(/A short note/));
  assert.ok(screen.getByRole('button', { name: 'Cancel' }));
  assert.ok(screen.getByRole('button', { name: 'Preview' }));
  assert.equal(screen.queryAllByRole('radio').filter((r) => (r as HTMLInputElement).checked).length, 0, 'no answer is pre-selected');
});

test('Preview is refused with a message for each problem: empty statements, no lie chosen', () => {
  const sent: Challenge[] = [];
  open((c) => sent.push(c));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  assert.equal(screen.getAllByText('Write a statement.').length, 3);
  assert.ok(screen.getByText('Choose which statement is the lie.'));
  assert.ok(screen.queryByTestId('two-truths-preview') === null);
  assert.equal(sent.length, 0);
});

test('duplicate statements are refused', () => {
  open();
  fill('I love cats', 'i love CATS.', 'I can juggle');
  fireEvent.click(screen.getByRole('radio', { name: 'Statement 3 is the lie' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  assert.equal(screen.getAllByText('Each statement needs to be different.').length, 2);
  assert.ok(screen.queryByTestId('two-truths-preview') === null);
});

test('exactly one statement can be the lie', () => {
  open();
  fireEvent.click(screen.getByRole('radio', { name: 'Statement 1 is the lie' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Statement 3 is the lie' }));
  const checked = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].getAttribute('aria-label'), 'Statement 3 is the lie');
});

test('a valid challenge: preview shows the card, Edit goes back with the text kept, Send Challenge sends it once with the answer', () => {
  const sent: Challenge[] = [];
  open((c) => sent.push(c));
  fill('I climbed a volcano', 'I own a snake', 'I can juggle');
  fireEvent.click(screen.getByRole('radio', { name: 'Statement 2 is the lie' }));
  fireEvent.change(screen.getByLabelText(/A short note/), { target: { value: 'Try me!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  const preview = screen.getByTestId('two-truths-preview');
  assert.ok(within(preview).getByText('I own a snake'));
  assert.ok(within(preview).getByText('Try me!'));
  assert.ok(within(preview).getByText('Which one do you think is the lie?'));
  assert.ok(within(preview).getByText('Your lie'), 'the sender can check their own answer');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  assert.equal((screen.getByLabelText('Statement 1') as HTMLInputElement).value, 'I climbed a volcano');
  assert.equal((screen.getByRole('radio', { name: 'Statement 2 is the lie' }) as HTMLInputElement).checked, true);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  const send = screen.getByRole('button', { name: /Send Challenge/ });
  fireEvent.click(send);
  fireEvent.click(send);
  assert.deepEqual(sent, [{ statements: ['I climbed a volcano', 'I own a snake', 'I can juggle'], lie: 1, intro: 'Try me!' }], 'sent exactly once');
});

test('Cancel closes without sending', () => {
  let closed = 0;
  const sent: Challenge[] = [];
  open((c) => sent.push(c), () => { closed++; });
  fill('a', 'b', 'c');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(closed, 1);
  assert.equal(sent.length, 0);
});

test('a long statement is capped at the limit as it is typed', () => {
  open();
  fireEvent.change(screen.getByLabelText('Statement 1'), { target: { value: 'x'.repeat(500) } });
  assert.equal((screen.getByLabelText('Statement 1') as HTMLInputElement).value.length, 140);
});

// ---------------------------------------------------------------- the card
const STATEMENTS = ['I climbed a volcano', 'I own a snake', 'I can juggle'];
const base: GameCard = { statements: STATEMENTS, intro: 'Try me!', status: 'open', canGuess: true };
const done = (guess: number, lie: number): GameCard => ({ ...base, status: 'complete', canGuess: false, guess, lie, correct: guess === lie });
const card = (game: GameCard, extra: Partial<React.ComponentProps<typeof TwoTruthsCard>> = {}) =>
  render(<TwoTruthsCard game={game} mine={false} partnerName="Luna" onGuess={() => {}} {...extra} />);

test('the recipient sees the three statements, the instruction and the status, but not an answer', () => {
  card(base);
  const c = screen.getByTestId('two-truths-card');
  for (const s of STATEMENTS) assert.ok(within(c).getByText(s));
  assert.ok(within(c).getAllByText('Which one do you think is the lie?').length >= 1);
  assert.ok(within(c).getByText('✨ Two Truths and a Lie'));
  assert.match(screen.getByTestId('two-truths-status').textContent ?? '', /Your turn/);
  assert.ok(c.querySelector('[data-lie]') === null);
  assert.doesNotMatch(c.textContent ?? '', /The lie|Truth\b|You got it right|Not quite/);
  assert.equal(c.getAttribute('data-status'), 'open');
});

test('selecting highlights one statement, enables Submit Guess, and the choice can be changed before submitting', () => {
  const guesses: number[] = [];
  card(base, { onGuess: (i) => guesses.push(i) });
  const submit = screen.getByRole('button', { name: 'Submit Guess' }) as HTMLButtonElement;
  assert.equal(submit.disabled, true, 'nothing chosen yet');
  const radios = screen.getAllByRole('radio');
  fireEvent.click(radios[0]);
  assert.equal(radios[0].getAttribute('aria-checked'), 'true');
  assert.equal(submit.disabled, false);
  fireEvent.click(radios[2]);
  assert.deepEqual(radios.map((r) => r.getAttribute('aria-checked')), ['false', 'false', 'true'], 'exactly one is selected');
  fireEvent.click(submit);
  assert.deepEqual(guesses, [2]);
});

test('while a guess is on its way the choices and the button are locked, so it cannot be submitted twice', () => {
  const guesses: number[] = [];
  const { rerender } = card(base, { onGuess: (i) => guesses.push(i) });
  fireEvent.click(screen.getAllByRole('radio')[1]);
  rerender(<TwoTruthsCard game={base} mine={false} partnerName="Luna" guessing onGuess={(i) => guesses.push(i)} />);
  const submit = screen.getByRole('button', { name: /Checking/ }) as HTMLButtonElement;
  assert.equal(submit.disabled, true);
  fireEvent.click(submit);
  assert.equal(guesses.length, 0);
  for (const r of screen.getAllByRole('radio')) assert.equal((r as HTMLButtonElement).disabled, true);
});

test('a card that is still being sent cannot be guessed', () => {
  card(base, { pending: true });
  assert.ok(screen.queryByRole('button', { name: 'Submit Guess' }) === null);
});

test('the sender sees their card waiting, with no way to guess their own challenge', () => {
  card({ ...base, canGuess: false }, { mine: true });
  assert.ok(screen.queryByRole('radio') === null);
  assert.ok(screen.queryByRole('button', { name: 'Submit Guess' }) === null);
  assert.ok(screen.getByText('Waiting for Luna to guess…'));
  assert.match(screen.getByTestId('two-truths-status').textContent ?? '', /Waiting/);
});

test('answered: the guess is locked (no choices, no button) and the lie is shown', () => {
  card(done(0, 1));
  assert.ok(screen.queryByRole('radio') === null);
  assert.ok(screen.queryByRole('button', { name: 'Submit Guess' }) === null);
  const lie = screen.getByTestId('two-truths-card').querySelector('[data-lie="true"]');
  assert.ok(lie && /I own a snake/.test(lie.textContent ?? ''));
  assert.match(screen.getByTestId('two-truths-status').textContent ?? '', /Answered/);
  assert.equal(screen.getByTestId('two-truths-card').getAttribute('data-status'), 'complete');
});

test('a right guess says so, a wrong guess names the lie, and the sender sees the same outcome', () => {
  const right = card(done(1, 1));
  assert.ok(screen.getByText('You got it right! ✨'));
  right.unmount();
  const wrong = card(done(0, 1));
  assert.ok(screen.getByText('Not quite! The lie was Statement 2.'));
  assert.ok(screen.getByText('Your guess'));
  wrong.unmount();
  card(done(0, 1), { mine: true });
  assert.ok(screen.getByText('Luna guessed Statement 1.'));
  assert.ok(screen.getByText('The lie was Statement 2.'));
  assert.ok(screen.getByText('Luna’s guess'));
  assert.ok(screen.getByText('The lie'), 'the sender’s original answer is shown');
});

test('the reveal animates only when the answer arrives while the card is on screen, not when a finished game is opened later', () => {
  const live = card(base);
  live.rerender(<TwoTruthsCard game={done(0, 1)} mine={false} partnerName="Luna" onGuess={() => {}} />);
  assert.ok(screen.getByRole('status').className.includes('anim-reveal'));
  live.unmount();
  card(done(0, 1));
  assert.equal(screen.getByRole('status').className.includes('anim-reveal'), false);
});

test('a failed guess shows why and leaves the card open to try again', () => {
  card(base, { error: 'Could not send your guess. Please try again.' });
  assert.equal(screen.getByRole('alert').textContent, 'Could not send your guess. Please try again.');
  assert.equal(screen.getAllByRole('radio').length, 3);
});

test('guess buttons do not trigger the message behind them (tapping a message opens its actions)', () => {
  let bubbleClicks = 0;
  render(<div onClick={() => { bubbleClicks++; }}><TwoTruthsCard game={base} mine={false} partnerName="Luna" onGuess={() => {}} /></div>);
  fireEvent.click(screen.getAllByRole('radio')[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Submit Guess' }));
  assert.equal(bubbleClicks, 0);
});

// ---------------------------------------------------------------- layout and themes
test('long statements wrap inside the card instead of overflowing, and the card fits the chat width', () => {
  const src = read('src/components/TwoTruthsGame.tsx');
  assert.ok((src.match(/\[overflow-wrap:anywhere\]/g) || []).length >= 5, 'every statement wraps anywhere');
  assert.match(src, /w-full min-w-0 overflow-hidden/);
  assert.doesNotMatch(src, /whitespace-nowrap[^"]*\{statement|\bw-\[\d+px\]|min-w-\[\d+/, 'no fixed widths');
  const convo = read('src/components/SignalsConversation.tsx');
  assert.match(convo, /w-full max-w-\[min\(22rem,96%\)\]/);
});

test('touch targets are at least 44px: every statement, Submit Guess, and the sheet buttons', () => {
  const src = read('src/components/TwoTruthsGame.tsx');
  const has = (needle: RegExp) => assert.match(src, needle);
  has(/const BUTTON =\s+'inline-flex min-h-11/);
  has(/const field = 'block min-h-11/);
  has(/flex min-h-11 shrink-0 cursor-pointer/);
  has(/role="radio"[\s\S]{0,400}flex min-h-11 w-full/);
  has(/inline-flex min-h-11 items-center gap-1\.5 rounded-full border border-\[var\(--card-btn-border\)\]/);
  const group = read('src/components/SignalsConversation.tsx');
  assert.match(group, /aria-label="Two Truths and a Lie"[^>]*h-10 w-10/, 'the toolbar button matches the other 40px attachment buttons');
});

const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const css = read('src/index.css');
const tokens = (selector: string) => {
  const start = css.indexOf(`${selector} {`, css.indexOf('Comfort Cards get their own surface'));
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--(card-[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]));
};
for (const [name, t] of [['dark', tokens(':root')], ['light', tokens("html[data-theme='light']")]] as const) {
  test(`${name} theme: statements, labels, the result and the selected or revealed row are all 4.5:1 or better`, () => {
    for (const surface of ['card-bg', 'card-btn-bg']) {
      for (const text of ['card-text', 'card-label']) assert.ok(ratio(t[text], t[surface]) >= 4.5, `${text} on ${surface} ${ratio(t[text], t[surface]).toFixed(2)}`);
    }
    assert.ok(ratio(t['card-meta'], t['card-bg']) >= 4.5, 'status, time and waiting line');
    assert.ok(ratio(t['card-focus'], t['card-bg']) >= 3, 'the selected edge');
    assert.ok(ratio(t['card-border'], t['card-bg']) >= 3, 'the card edge');
  });
}

test('the game uses the existing Signals infrastructure: no new inbox, route, page, post type or listener', () => {
  const convo = read('src/components/SignalsConversation.tsx');
  assert.match(convo, /action: 'guess-game'/);
  assert.match(convo, /action: 'send-message'/);
  assert.doesNotMatch(read('src/components/TwoTruthsGame.tsx') + read('src/utils/twoTruths.ts'), /firebase|firestore|onSnapshot|fetch\(/i);
  const community = read('src/services/communityService.ts');
  assert.doesNotMatch(community, /twoTruths|two-truths/i, 'not a Cosmos post');
});

test('the server code never sends the stored answer except through the completed-card shape, and keeps it in its own document', () => {
  const api = read('api/signals.js');
  assert.match(api, /pairRef\.collection\('gameSecrets'\)/);
  assert.match(api, /shapeStoredGame\(data\.game, uid, data\.senderId\)/);
  assert.doesNotMatch(api, /game: \{[^}]*lie: challenge\.lie[^}]*status: 'open'/, 'the visible card never gets the answer');
  assert.match(read('firestore.rules'), /signalsPairs\/\{pairId\}\/gameSecrets\/\{gameId\} \{\s+allow read, write: if false;/);
});
