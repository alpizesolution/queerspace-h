import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NSFW_CARDS, nsfwCardById } from '../utils/nsfwCards.ts';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';

/**
 * NSFW Cards on the real components: the picker's second deck, the card in a conversation, the member's own NSFW setting deciding what
 * is rendered, and the conversation sending a card by id with the neutral text. With "Always hide" no question text may exist in the
 * page at all.
 */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent() {}, playMessageReceived() {} } } });
const { ComfortCardPicker } = await import('./ComfortCards.tsx');
const { NsfwCardBubble, NSFW_LOOK, NSFW_SURFACE } = await import('./NsfwCards.tsx');
const { SignalsConversation } = await import('./SignalsConversation.tsx');

const noop = () => {};
const allQuestions = NSFW_CARDS.map((c) => c.question);
const page = () => document.body.textContent ?? '';
const leaks = () => allQuestions.filter((q) => page().includes(q));

afterEach(cleanup);

// ------------------------------------------------------------------ the picker

const picker = (pref: NsfwPreference | undefined, sent: unknown[] = [], sentNsfw: unknown[] = [], settings: string[] = []) =>
  render(
    <ComfortCardPicker
      onSend={(c) => sent.push(c)}
      onClose={noop}
      {...(pref !== undefined ? { nsfwPreference: pref, onSendNsfw: (c: unknown) => sentNsfw.push(c), onOpenSettings: () => settings.push('settings') } : {})}
    />
  );

test('without NSFW support (the Seek chat) the picker is exactly the Comfort Cards picker: no deck tabs, no NSFW', () => {
  picker(undefined);
  assert.equal(screen.queryByRole('tablist', { name: 'Card decks' }) === null, true);
  assert.ok(screen.getByRole('dialog', { name: /Comfort Cards/ }));
  assert.equal(page().includes('NSFW'), false);
  assert.equal(screen.getAllByRole('tab').length, 6, 'the six Comfort categories');
});

test('in Signals the picker has Comfort and NSFW decks, and Comfort is the one that opens, unchanged', () => {
  picker('confirm');
  const decks = screen.getByRole('tablist', { name: 'Card decks' });
  assert.deepEqual(within(decks).getAllByRole('tab').map((t) => t.textContent?.trim()), ['Comfort', 'NSFW']);
  assert.equal(within(decks).getByRole('tab', { name: 'Comfort' }).getAttribute('aria-selected'), 'true');
  assert.equal(screen.getByRole('tablist', { name: 'Card categories' }).querySelectorAll('[role=tab]').length, 6);
  assert.equal(leaks().length, 0, 'no NSFW question is on the page while the Comfort deck is open');
});

test('with "Always hide" the NSFW deck is a locked panel: no card, no question, no Send, and a way to the setting', () => {
  const settings: string[] = [];
  picker('hide', [], [], settings);
  fireEvent.click(screen.getByRole('tab', { name: /NSFW/ }));
  const locked = screen.getByTestId('nsfw-deck-locked');
  assert.match(locked.textContent ?? '', /NSFW Cards are off/);
  assert.equal(leaks().length, 0);
  assert.equal(screen.queryAllByRole('button', { name: /Send this card/ }).length, 0);
  assert.equal(screen.queryAllByRole('list').length, 0, 'no card list at all');
  fireEvent.click(within(locked).getByRole('button', { name: 'Change setting' }));
  assert.deepEqual(settings, ['settings']);
});

test('with the setting on, the NSFW deck has the four categories, the cards, a shuffle, and sends the chosen card once', () => {
  const sentNsfw: unknown[] = [];
  const sentComfort: unknown[] = [];
  picker('confirm', sentComfort, sentNsfw);
  fireEvent.click(screen.getByRole('tab', { name: /NSFW/ }));
  assert.ok(screen.getByRole('dialog', { name: /NSFW Cards/ }));
  const categories = screen.getByRole('tablist', { name: 'NSFW card categories' });
  assert.deepEqual(within(categories).getAllByRole('tab').map((t) => t.textContent?.trim()), ['💋Flirty', '🔥Spicy', '🌙Intimate', '🖤Boundaries']);
  assert.match(page(), /Adults only · 18\+/);
  fireEvent.click(within(categories).getByRole('tab', { name: /Boundaries/ }));
  assert.match(page(), /Consent, limits and personal preferences/);
  const card = nsfwCardById('nsfw-boundaries-03')!;
  fireEvent.click(screen.getByRole('button', { name: card.question }));
  assert.equal(screen.getByRole('button', { name: card.question }).getAttribute('aria-pressed'), 'true');
  const send = screen.getByRole('button', { name: /Send this card/ });
  fireEvent.click(send);
  fireEvent.click(send);
  assert.equal(sentNsfw.length, 1, 'one tap, one send');
  assert.equal((sentNsfw[0] as { id: string }).id, 'nsfw-boundaries-03');
  assert.equal(sentComfort.length, 0);
});

test('shuffle opens a random NSFW card in its own category and selects it', () => {
  picker('ask');
  fireEvent.click(screen.getByRole('tab', { name: /NSFW/ }));
  fireEvent.click(screen.getByRole('button', { name: /Shuffle question/ }));
  assert.equal(document.querySelectorAll('[aria-pressed="true"]').length, 1);
  assert.ok(screen.getByRole('button', { name: /Send this card/ }));
});

// ------------------------------------------------------------------ the card in a conversation

const bubble = (pref: NsfwPreference, over: Partial<React.ComponentProps<typeof NsfwCardBubble>> = {}) =>
  render(<NsfwCardBubble card={{ id: 'nsfw-spicy-01', category: 'spicy' }} preference={pref} mine={false} canAnswer onAnswer={noop} time="9:41 AM" {...over} />);
const QUESTION = nsfwCardById('nsfw-spicy-01')!.question;

test('"Always hide": the card is covered and the page holds none of its words, with a way to the setting', () => {
  const settings: string[] = [];
  bubble('hide', { onOpenSettings: () => settings.push('s') });
  const card = screen.getByTestId('nsfw-card');
  assert.equal(card.getAttribute('data-state'), 'blocked');
  assert.match(card.textContent ?? '', /Mature card · Spicy/);
  assert.match(card.textContent ?? '', /Hidden by your content setting/);
  assert.equal(leaks().length, 0);
  assert.equal(screen.queryAllByRole('button', { name: /Answer/ }).length, 0, 'nothing to answer while hidden');
  fireEvent.click(screen.getByRole('button', { name: 'Change setting' }));
  assert.deepEqual(settings, ['s']);
  assert.match(card.textContent ?? '', /9:41 AM/, 'the time stays');
});

test('"Show after confirmation": a received card is covered; the Reveal tap is the confirmation; then it shows with Answer', () => {
  const answered: string[] = [];
  bubble('confirm', { onAnswer: () => answered.push('a') });
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'covered');
  assert.equal(leaks().length, 0, 'covered cards hold no words');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal card' }));
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'open');
  assert.ok(page().includes(QUESTION));
  fireEvent.click(screen.getByRole('button', { name: /Answer this card/ }));
  assert.deepEqual(answered, ['a']);
});

test('"Ask before revealing": Reveal opens a confirmation first, Cancel keeps it covered, confirming shows it', () => {
  bubble('ask');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal card' }));
  const dialog = screen.getByRole('dialog', { name: /Show this mature card\?/ });
  assert.equal(leaks().length, 0, 'still covered behind the question');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'covered');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal card' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: /Show this mature card\?/ })).getByRole('button', { name: 'Show card' }));
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'open');
  assert.ok(page().includes(QUESTION));
});

test('a card you sent shows at once when the setting allows it, and is covered if the setting is "Always hide"', () => {
  bubble('ask', { mine: true });
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'open');
  assert.ok(page().includes(QUESTION));
  cleanup();
  bubble('hide', { mine: true });
  assert.equal(screen.getByTestId('nsfw-card').getAttribute('data-state'), 'blocked');
  assert.equal(leaks().length, 0);
});

test('while a card is still sending its Answer is disabled, and after the connection ends there is no Answer', () => {
  bubble('confirm', { mine: true, pending: true });
  assert.equal((screen.getByRole('button', { name: /Answer this card/ }) as HTMLButtonElement).disabled, true);
  cleanup();
  bubble('confirm', { mine: true, canAnswer: false });
  assert.equal(screen.queryAllByRole('button', { name: /Answer/ }).length, 0);
});

test('an id that is not on the list can never be shown: it stays covered with no Reveal', () => {
  bubble('confirm', { card: { id: 'nsfw-nope-99', category: 'spicy' } });
  assert.equal(screen.queryAllByRole('button', { name: 'Reveal card' }).length, 0);
  assert.match(page(), /can’t be shown/);
});

// ------------------------------------------------------------------ the conversation

const msg = (id: string, senderId: string, extra: Record<string, unknown> = {}) => ({ id, senderId, text: 'hi', createdAt: `2026-01-01T10:0${id.length % 10}:00.000Z`, replyTo: null, reactions: [], ...extra });
let served: Record<string, unknown>[] = [];
let posts: Record<string, unknown>[] = [];

beforeEach(() => {
  posts = [];
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}'));
      posts.push(body);
      if (body.action === 'send-message' && body.kind === 'card') {
        const card = nsfwCardById(body.cardId)!;
        return { ok: true, status: 201, json: async () => ({ id: body.messageId, senderId: 'alice', text: 'Mature card', kind: 'card', card: { id: card.id, category: card.category, deck: 'nsfw' }, createdAt: new Date().toISOString(), replyTo: null, reactions: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (String(url).includes('view=messages')) return { ok: true, status: 200, json: async () => ({ messages: String(url).includes('after=') ? [] : served, cursor: new Date().toISOString(), olderCursor: null }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

const conversation = (pref: NsfwPreference, settings: string[] = []) =>
  render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} nsfwPreference={pref} onOpenSettings={() => settings.push('settings')} onBack={noop} />);

test('a received NSFW card (as the server sends it: id, category, neutral text) is covered with "Always hide" and no question reaches the page', async () => {
  served = [msg('m1', 'bob', { kind: 'card', text: 'Mature card', card: { id: 'nsfw-intimate-05', category: 'intimate', deck: 'nsfw' } })];
  conversation('hide');
  const card = await screen.findByTestId('nsfw-card');
  assert.equal(card.getAttribute('data-state'), 'blocked');
  assert.equal(leaks().length, 0);
  assert.ok(await screen.findByLabelText(/message: Mature card. Show actions/), 'its accessible name is the neutral line');
});

test('with "Show after confirmation" the received card is revealed by the tap and can be answered with an ordinary reply', async () => {
  served = [msg('m1', 'bob', { kind: 'card', text: 'Mature card', card: { id: 'nsfw-intimate-05', category: 'intimate', deck: 'nsfw' } })];
  conversation('confirm');
  fireEvent.click(await screen.findByRole('button', { name: 'Reveal card' }));
  const question = nsfwCardById('nsfw-intimate-05')!.question;
  assert.ok(page().includes(question));
  fireEvent.click(screen.getByRole('button', { name: /Answer this card/ }));
  const quote = await screen.findByText('Mature card', { selector: 'p, span' }).catch(() => null);
  assert.ok(quote !== null || page().includes('Replying'), 'the answer is an ordinary reply to the card');
  fireEvent.change(screen.getByPlaceholderText('Message...'), { target: { value: 'I like slow teasing.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => assert.ok(posts.some((p) => p.action === 'send-message' && p.text === 'I like slow teasing.')));
  const reply = posts.find((p) => p.text === 'I like slow teasing.') as { replyTo: { text: string } };
  assert.equal(reply.replyTo.text, 'Mature card', 'the quote sent to the server never carries the question');
});

test('sending: Comfort Cards, then the NSFW tab, choose a card, Send: the message goes by id alone with no text of its own', async () => {
  served = [];
  conversation('confirm');
  fireEvent.click(await screen.findByRole('button', { name: 'Comfort Cards' }));
  fireEvent.click(screen.getByRole('tab', { name: /NSFW/ }));
  fireEvent.click(screen.getByRole('button', { name: nsfwCardById('nsfw-flirty-02')!.question }));
  fireEvent.click(screen.getByRole('button', { name: /Send this card/ }));
  await waitFor(() => assert.ok(posts.some((p) => p.kind === 'card')));
  const sent = posts.find((p) => p.kind === 'card')!;
  assert.equal(sent.cardId, 'nsfw-flirty-02');
  assert.equal(sent.action, 'send-message');
  for (const forbidden of ['text', 'question', 'card', 'category']) assert.equal(forbidden in sent, false, `${forbidden} is not sent`);
  const card = await screen.findByTestId('nsfw-card');
  assert.equal(card.getAttribute('data-state'), 'open', 'your own card shows at once');
  assert.equal(screen.queryAllByRole('dialog').length, 0, 'the picker closed');
});

test('with "Always hide" the conversation cannot send an NSFW card at all, and its locked deck leads to the setting', async () => {
  served = [];
  const settings: string[] = [];
  conversation('hide', settings);
  fireEvent.click(await screen.findByRole('button', { name: 'Comfort Cards' }));
  fireEvent.click(screen.getByRole('tab', { name: /NSFW/ }));
  assert.ok(screen.getByTestId('nsfw-deck-locked'));
  assert.equal(leaks().length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Change setting' }));
  assert.deepEqual(settings, ['settings']);
  assert.equal(posts.filter((p) => p.kind === 'card').length, 0);
});

test('Comfort Cards in the same conversation still work as before (the question is the text, and no mature cover)', async () => {
  served = [msg('m1', 'bob', { kind: 'card', text: 'What is something small that made you smile today?', card: { id: 'soft-01', category: 'soft' } })];
  conversation('hide');
  assert.ok(await screen.findByTestId('comfort-card'));
  assert.equal(screen.queryAllByTestId('nsfw-card').length, 0);
  assert.ok(page().includes('smile today'));
});

// ------------------------------------------------------------------ design

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the mature surface is readable: text, labels and every category accent keep at least 4.5:1 on all of the card\'s colours', () => {
  for (const background of [NSFW_SURFACE.from, NSFW_SURFACE.via, NSFW_SURFACE.to]) {
    for (const [name, colour] of [['text', NSFW_SURFACE.text], ['meta', NSFW_SURFACE.meta], ['label', NSFW_SURFACE.label], ...Object.entries(NSFW_LOOK).map(([k, v]) => [k, v.accent])]) {
      assert.ok(ratio(colour as string, background) >= 4.5, `${name} ${colour} on ${background} is ${ratio(colour as string, background).toFixed(2)}`);
    }
  }
  for (const accent of Object.values(NSFW_LOOK).map((v) => v.accent)) assert.ok(ratio('#1a0712', accent) >= 4.5, `dark text on the ${accent} button`);
});

test('the four accents are distinct from each other, and the surface is not the Comfort card surface', () => {
  assert.equal(new Set(Object.values(NSFW_LOOK).map((v) => v.accent)).size, 4);
  const css = fs.readFileSync('src/index.css', 'utf8');
  assert.equal(css.includes(NSFW_SURFACE.from), false, 'a separate identity: the Comfort card colours are not reused');
});
