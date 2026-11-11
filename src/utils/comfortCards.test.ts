import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_CATEGORIES as SERVER_CATEGORIES, COMFORT_CARDS as SERVER_CARDS, cardById as serverCard, isCardId, shapeStoredCard } from '../../api/_cards.js';
import { CARD_CATEGORIES, COMFORT_CARDS, cardById, cardsInCategory, categoryLabel, parseCard, randomCard } from './comfortCards.ts';
import { checkedCard, mergeMessages, visibleThread, type PendingMessage, type ThreadMessage } from './signalsThread.ts';

test('six categories with the approved names, in order', () => {
  assert.deepEqual(CARD_CATEGORIES.map((c) => c.label), ['Soft & Sweet', 'Get to Know Me', 'Deep Talks', 'Love & Sapphic', 'Random & Fun', 'Comfort Corner']);
});

test('every category has a good number of cards, with unique ids and no repeated question', () => {
  for (const c of CARD_CATEGORIES) assert.ok(cardsInCategory(c.id).length >= 10, `${c.label} has plenty`);
  assert.equal(new Set(COMFORT_CARDS.map((c) => c.id)).size, COMFORT_CARDS.length);
  assert.equal(new Set(COMFORT_CARDS.map((c) => c.question.toLowerCase())).size, COMFORT_CARDS.length);
  for (const c of COMFORT_CARDS) assert.ok(c.question.length > 10 && c.question.length <= 160 && /[?]$/.test(c.question), c.id);
});

test('the app list and the server list are identical (the server owns the wording)', () => {
  assert.deepEqual(SERVER_CATEGORIES, CARD_CATEGORIES.map((c) => ({ ...c })));
  assert.deepEqual(SERVER_CARDS, COMFORT_CARDS.map((c) => ({ ...c })));
});

test('random picks stay inside the list, can be limited to a category, and avoid the card just shown', () => {
  assert.equal(randomCard({ random: () => 0 }).id, COMFORT_CARDS[0].id);
  assert.equal(randomCard({ random: () => 0.9999 }).id, COMFORT_CARDS.at(-1)!.id);
  for (let i = 0; i < 100; i++) assert.equal(randomCard({ category: 'comfort' }).category, 'comfort');
  const first = COMFORT_CARDS[0];
  for (let i = 0; i < 100; i++) assert.notEqual(randomCard({ not: first.id }).id, first.id);
});

test('only an id on the list is a card; words, other ids and non-strings are not', () => {
  assert.equal(cardById('soft-01')?.category, 'soft');
  for (const bad of ['', 'soft-99', 'SOFT-01', 'x', undefined, null, 5, {}, ['soft-01']]) {
    assert.equal(cardById(bad), null, String(bad));
    assert.equal(isCardId(bad), false, String(bad));
  }
  assert.equal(parseCard({ id: 'love-03', question: 'Anything I like' })?.question, cardById('love-03')!.question, 'the words always come from the list');
  assert.equal(parseCard({ question: 'no id' }), null);
  assert.equal(serverCard('soft-01')!.question, cardById('soft-01')!.question);
  assert.equal(shapeStoredCard({ id: 'soft-01', question: 'forged text' })!.question, cardById('soft-01')!.question);
  assert.equal(shapeStoredCard({ id: 'nope' }), null);
  assert.equal(categoryLabel('deep'), 'Deep Talks');
});

const msg = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({ id: 'm1', senderId: 'a', text: 'hi', createdAt: '2026-01-01T00:00:00Z', ...over });

test('a card message shows as a card with the approved words; a bad record shows as plain text', () => {
  const ok = checkedCard(msg({ kind: 'card', card: { id: 'deep-02', category: 'deep' }, text: 'forged' }));
  assert.equal(ok.kind, 'card');
  assert.equal(ok.text, cardById('deep-02')!.question);
  const bad = checkedCard(msg({ kind: 'card', card: { id: 'made-up', category: 'deep' }, text: 'whatever' }));
  assert.equal(bad.kind, undefined);
  assert.equal(bad.card, undefined);
  assert.equal(bad.text, 'whatever');
  assert.equal(checkedCard(msg()).kind, undefined, 'ordinary messages are untouched');
  assert.equal(mergeMessages([], [msg({ kind: 'card', card: { id: 'soft-01', category: 'soft' } })])[0].kind, 'card');
});

test('a card still being sent shows as the card; older messages and other kinds are unaffected', () => {
  const pending: PendingMessage = { id: 'p1', text: cardById('fun-01')!.question, cardId: 'fun-01', replyTo: null, status: 'sending', retryable: true, createdAt: 1 };
  const shown = visibleThread([msg({ id: 'old' })], [pending], 'a');
  assert.equal(shown[0].kind, undefined);
  assert.equal(shown[1].kind, 'card');
  assert.deepEqual(shown[1].card, { id: 'fun-01', category: 'fun' });
  assert.equal(visibleThread([], [{ ...pending, cardId: 'bogus' }], 'a')[0].kind, undefined);
});
