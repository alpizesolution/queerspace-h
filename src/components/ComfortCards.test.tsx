import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ComfortCardBubble, ComfortCardPicker } from './ComfortCards.tsx';
import { CARD_CATEGORIES, cardsInCategory, type ComfortCard } from '../utils/comfortCards.ts';

afterEach(cleanup);

const picker = () => {
  const sent: ComfortCard[] = [];
  let closed = 0;
  render(<ComfortCardPicker onSend={(c) => sent.push(c)} onClose={() => { closed++; }} />);
  return { sent, closed: () => closed };
};

test('the picker opens on the first category with all six categories to browse', () => {
  picker();
  assert.ok(screen.getByRole('dialog'));
  const tabs = screen.getAllByRole('tab');
  assert.deepEqual(tabs.map((t) => t.textContent), CARD_CATEGORIES.map((c) => c.label));
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(within(screen.getByRole('list')).getAllByRole('listitem').length, cardsInCategory('soft').length);
});

test('browsing: choosing a category shows its questions', () => {
  picker();
  fireEvent.click(screen.getByRole('tab', { name: 'Comfort Corner' }));
  const first = cardsInCategory('comfort')[0];
  assert.ok(screen.getByText(first.question));
  assert.equal(screen.queryByText(cardsInCategory('soft')[0].question), null);
});

test('choosing a question previews it first; nothing is sent until Send card', () => {
  const { sent } = picker();
  const card = cardsInCategory('deep')[2];
  fireEvent.click(screen.getByRole('tab', { name: 'Deep Talks' }));
  fireEvent.click(screen.getByText(card.question));
  const preview = screen.getByTestId('card-preview');
  assert.ok(within(preview).getByText(card.question));
  assert.ok(within(preview).getByText('Deep Talks'));
  assert.equal(sent.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Send card' }));
  assert.deepEqual(sent.map((c) => c.id), [card.id]);
});

test('Cancel in the preview goes back to browsing without sending', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByText(cardsInCategory('soft')[0].question));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByTestId('card-preview'), null);
  assert.ok(screen.getByRole('tablist'));
  assert.equal(sent.length, 0);
});

test('closing the picker sends nothing', () => {
  const { sent, closed } = picker();
  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  assert.equal(closed(), 1);
  assert.equal(sent.length, 0);
});

test('Random question previews a real card, and another random one is a different card', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByRole('button', { name: /Random question/ }));
  const preview = screen.getByTestId('card-preview');
  const first = screen.getAllByText(/\?$/)[0].textContent;
  assert.ok(first);
  fireEvent.click(within(preview).getByRole('button', { name: /Another random one/ }));
  assert.notEqual(screen.getAllByText(/\?$/)[0].textContent, first);
  assert.equal(sent.length, 0);
});

test('a double tap on Send card sends once', () => {
  const { sent } = picker();
  fireEvent.click(screen.getByText(cardsInCategory('soft')[0].question));
  const send = screen.getByRole('button', { name: 'Send card' });
  fireEvent.click(send);
  fireEvent.click(send);
  assert.equal(sent.length, 1);
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
  assert.match(convo, /h-10 w-10 shrink-0 items-center justify-center rounded-full border border-lavender\/30/, 'same size as its neighbours, with a lavender accent');
  assert.match(convo, /\{cardsOpen && !ended && <ComfortCardPicker onSend=\{sendCard\}/);
});

test('a card is sent by its id alone through the same outbox, and an answer is an ordinary reply', () => {
  assert.match(convo, /item\.cardId \? \{ kind: 'card', cardId: item\.cardId \}/);
  assert.equal(/kind: 'card'[^}]*text/.test(convo), false, 'no free text goes with a card');
  const answers = convo.match(/onAnswer=\{\(\) => \{ setReplyingTo\(message\);/g) || [];
  assert.equal(answers.length, 1);
  assert.match(convo, /enqueue\(item\)/);
});

test('GIF, photo and text sending are untouched', () => {
  assert.match(convo, /item\.gif \? \{ kind: 'gif', gifId: item\.gif\.id \} : \{ text: item\.text \}/);
  assert.match(convo, /<GifPicker onSend=\{sendGif\}/);
  assert.match(convo, /aria-label="Send a timed photo"/);
});
