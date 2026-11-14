import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ComfortCardBubble, ComfortCardPicker } from './ComfortCards.tsx';
import { CARD_CATEGORIES, COMFORT_CARDS, cardsInCategory, type ComfortCard } from '../utils/comfortCards.ts';

afterEach(cleanup);

const picker = () => {
  const sent: ComfortCard[] = [];
  let closed = 0;
  render(<ComfortCardPicker onSend={(c) => sent.push(c)} onClose={() => { closed++; }} />);
  return { sent, closed: () => closed };
};

const labels = CARD_CATEGORIES.map((c) => c.label);
const pressed = () => screen.queryAllByRole('button', { pressed: true }).filter((b) => b.id.startsWith('card-'));

test('the picker opens on the first category, with the tagline, the featured icebreaker and all six categories', () => {
  picker();
  assert.ok(screen.getByRole('dialog'));
  assert.ok(screen.getByText(/Little questions, meaningful connections\./));
  const featured = screen.getByRole('region', { name: 'Daily icebreaker' });
  assert.ok(within(featured).getByText('Daily icebreaker'));
  assert.ok(within(featured).getByRole('heading', { name: 'Let’s make a little connection.' }));
  assert.ok(within(featured).getByRole('button', { name: /Shuffle question/ }));
  const tabs = screen.getAllByRole('tab');
  assert.deepEqual(tabs.map((t) => t.textContent?.replace(/^\p{Extended_Pictographic}️?/u, '')), labels);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(within(screen.getByRole('list')).getAllByRole('listitem').length, cardsInCategory('soft').length);
  assert.equal(screen.queryByRole('button', { name: /Send this card/ }), null, 'no Send action until something is chosen');
});

test('every category can be opened and shows exactly its own questions', () => {
  picker();
  for (const c of CARD_CATEGORIES) {
    fireEvent.click(screen.getByRole('tab', { name: c.label }));
    assert.equal(screen.getByRole('tab', { name: c.label }).getAttribute('aria-selected'), 'true');
    assert.equal(screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').length, 1, 'one selected category');
    const shown = within(screen.getByRole('list', { name: `${c.label} questions` })).getAllByRole('listitem').map((li) => li.textContent);
    assert.deepEqual(shown, cardsInCategory(c.id).map((q) => q.question));
  }
});

test('choosing a question marks it, shows the Send action, and sends nothing yet', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByRole('tab', { name: 'Deep Talks' }));
  const card = cardsInCategory('deep')[2];
  fireEvent.click(screen.getByText(card.question));
  assert.deepEqual(pressed().map((b) => b.id), [`card-${card.id}`]);
  assert.ok(screen.getByRole('button', { name: 'Send this card ✨' }));
  assert.equal(sent.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Send this card ✨' }));
  assert.deepEqual(sent.map((c) => c.id), [card.id]);
});

test('the choice can be changed before sending: only the latest is chosen and sent', () => {
  const { sent } = picker();
  const [first, second] = cardsInCategory('soft');
  fireEvent.click(screen.getByText(first.question));
  fireEvent.click(screen.getByText(second.question));
  assert.deepEqual(pressed().map((b) => b.id), [`card-${second.id}`]);
  // Even across categories.
  fireEvent.click(screen.getByRole('tab', { name: 'Random & Fun' }));
  const third = cardsInCategory('fun')[4];
  fireEvent.click(screen.getByText(third.question));
  fireEvent.click(screen.getByRole('tab', { name: 'Soft & Sweet' }));
  assert.equal(pressed().length, 0, 'the earlier choice is no longer in this list');
  fireEvent.click(screen.getByRole('button', { name: 'Send this card ✨' }));
  assert.deepEqual(sent.map((c) => c.id), [third.id]);
});

test('Cancel clears the choice and the Send action, and the list stays', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByText(cardsInCategory('soft')[0].question));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(pressed().length, 0);
  assert.equal(screen.queryByRole('button', { name: /Send this card/ }), null);
  assert.ok(screen.getByRole('tablist'));
  assert.equal(sent.length, 0);
});

test('closing the picker sends nothing', () => {
  const { sent, closed } = picker();
  fireEvent.click(screen.getByText(cardsInCategory('soft')[0].question));
  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  assert.equal(closed(), 1);
  assert.equal(sent.length, 0);
});

test('Shuffle question chooses a real random card from anywhere, opens its category, shows Send, and never repeats the one chosen', () => {
  const { sent } = picker();
  const shuffle = () => fireEvent.click(screen.getByRole('button', { name: /Shuffle question/ }));
  let previous = '';
  const seenCategories = new Set<string>();
  for (let i = 0; i < 40; i++) {
    shuffle();
    const chosen = pressed();
    assert.equal(chosen.length, 1, 'exactly one question is chosen and visible');
    const id = chosen[0].id.replace('card-', '');
    assert.ok(COMFORT_CARDS.some((c) => c.id === id));
    assert.notEqual(id, previous, 'a different card each time');
    previous = id;
    const category = COMFORT_CARDS.find((c) => c.id === id)!.category;
    seenCategories.add(category);
    assert.equal(screen.getByRole('tab', { selected: true }).textContent?.endsWith(CARD_CATEGORIES.find((c) => c.id === category)!.label), true, 'its category is open');
    assert.ok(screen.getByRole('button', { name: 'Send this card ✨' }));
  }
  assert.ok(seenCategories.size > 1, 'random picks reach more than one category');
  assert.equal(sent.length, 0, 'shuffling never sends');
});

test('a double tap on Send this card sends once', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByText(cardsInCategory('soft')[0].question));
  const send = screen.getByRole('button', { name: 'Send this card ✨' });
  fireEvent.click(send);
  fireEvent.click(send);
  assert.equal(sent.length, 1);
});

test('long questions are never clipped: the text wraps, with no truncation or line clamp in the list', () => {
  const src = fs.readFileSync('src/components/ComfortCards.tsx', 'utf8');
  const list = src.slice(src.indexOf('<ul aria-label'), src.indexOf('</ul>'));
  assert.doesNotMatch(list, /truncate|line-clamp|text-ellipsis|whitespace-nowrap/);
  assert.match(list, /\[overflow-wrap:anywhere\]/);
  // And nothing in the picker can push the page sideways, and the list scrolls on its own.
  assert.match(src, /flex min-w-0 flex-col gap-3/);
  assert.match(src, /max-h-\[40dvh\]/);
});

test('the card in a conversation shows its category and question, and Answer is offered to either person', () => {
  let answered = 0;
  const card = cardsInCategory('love')[0];
  render(<ComfortCardBubble card={card} canAnswer onAnswer={() => { answered++; }} />);
  const bubble = screen.getByTestId('comfort-card');
  assert.ok(within(bubble).getByText('Love & Sapphic'));
  assert.ok(within(bubble).getByText(card.question));
  fireEvent.click(within(bubble).getByRole('button', { name: /Answer this card/ }));
  assert.equal(answered, 1);
});

test('no Answer button when the connection has ended or the card is still sending', () => {
  render(<ComfortCardBubble card={cardsInCategory('fun')[0]} canAnswer={false} onAnswer={() => {}} />);
  assert.equal(screen.queryByRole('button', { name: /Answer/ }), null);
});

// ---- wiring in the Signals composer (source checks: the conversation itself needs the whole API to render)
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const convo = read('src/components/SignalsConversation.tsx');

test('the Comfort Cards button sits beside the photo and GIF buttons with a label, and opens only the picker', () => {
  const photo = convo.indexOf('aria-label="Send a timed photo"');
  const gif = convo.indexOf('aria-label="Send a GIF"');
  const cards = convo.indexOf('aria-label="Comfort Cards"');
  assert.ok(photo > 0 && gif > photo && cards > gif, 'photo, GIF, then Comfort Cards');
  assert.match(convo, /title="Comfort Cards"/);
  assert.match(convo, /onClick=\{\(\) => setCardsOpen\(true\)\}/);
  assert.match(convo, /h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lavender/, 'same size as its neighbours, with a lavender accent');
  assert.match(convo, /\{cardsOpen && !ended && <ComfortCardPicker onSend=\{sendCard\}/);
});

test('a card is sent by its id alone through the same outbox, and an answer is an ordinary reply', () => {
  assert.match(convo, /item\.cardId \? \{ kind: 'card', cardId: item\.cardId \}/);
  assert.equal(/kind: 'card'[^}]*text/.test(convo), false, 'no free text goes with a card');
  const answers = convo.match(/onAnswer=\{\(\) => \{ setReplyingTo\(message\);/g) || [];
  assert.equal(answers.length, 2, 'one for the Comfort card bubble and one for the NSFW card bubble: each answer is an ordinary reply');
  assert.match(convo, /enqueue\(item\)/);
});

test('GIF, photo and text sending are untouched', () => {
  assert.match(convo, /item\.gif \? \{ kind: 'gif', gifId: item\.gif\.id \} : \{ text: item\.text \}/);
  assert.match(convo, /<GifPicker onSend=\{sendGif\}/);
  assert.match(convo, /aria-label="Send a timed photo"/);
});

// ---- wiring in Seek chat (the anonymous live chat)
const chat = read('src/components/ChatView.tsx');

test('Seek chat has the Comfort Cards button and picker, and sends a card by id through the chat service', () => {
  assert.match(chat, /aria-label="Comfort Cards"/);
  assert.match(chat, /title="Comfort Cards"/);
  assert.match(chat, /onClick=\{\(\) => setCardsOpen\(true\)\}/);
  assert.match(chat, /\{cardsOpen && !partnerLeft && <ComfortCardPicker onSend=\{handleSendCard\}/);
  assert.match(chat, /card\.question,[\s\S]{0,260}wasTyping,\s*card\.id/, 'by id, through the same service as text');
  assert.match(chat, /onAnswer=\{\(\) => startReply\(msg\)\}/, 'an answer is an ordinary reply');
  assert.match(chat, /canAnswer=\{!partnerLeft\}/);
});

test('Seek chat text sending, reactions and the emoji picker are untouched', () => {
  assert.match(chat, /aria-label="Emoji"/);
  assert.match(chat, /handleSendMessage\(\)/);
  assert.match(chat, /aria-label="Send message"/);
});
