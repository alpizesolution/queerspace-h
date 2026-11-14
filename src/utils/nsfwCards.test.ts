import test from 'node:test';
import assert from 'node:assert/strict';
import { NSFW_CARD_TEXT as SERVER_TEXT, NSFW_CARDS as SERVER_CARDS, NSFW_CATEGORIES as SERVER_CATEGORIES, nsfwCardById as serverCard, shapeStoredNsfwCard } from '../../api/_nsfwCards.js';
import { previewText } from '../../api/_inbox.js';
import { COMFORT_CARDS } from './comfortCards.ts';
import { NSFW_CARDS, NSFW_CARD_TEXT, NSFW_CATEGORIES, isNsfwCardId, nsfwCardById, nsfwCardsInCategory, parseNsfwCard, randomNsfwCard } from './nsfwCards.ts';
import { checkedCard, mergeMessages, visibleThread, type PendingMessage, type ThreadMessage } from './signalsThread.ts';

test('four categories with the approved names and emoji, in order', () => {
  assert.deepEqual(NSFW_CATEGORIES.map((c) => `${c.emoji} ${c.label}`), ['💋 Flirty', '🔥 Spicy', '🌙 Intimate', '🖤 Boundaries']);
});

test('every category has plenty of cards, with unique ids, unique questions, and none borrowed from the Comfort deck', () => {
  for (const c of NSFW_CATEGORIES) assert.ok(nsfwCardsInCategory(c.id).length >= 10, `${c.label} has plenty`);
  assert.equal(new Set(NSFW_CARDS.map((c) => c.id)).size, NSFW_CARDS.length);
  assert.equal(new Set(NSFW_CARDS.map((c) => c.question.toLowerCase())).size, NSFW_CARDS.length);
  const comfort = new Set(COMFORT_CARDS.map((c) => c.question.toLowerCase()));
  for (const c of NSFW_CARDS) {
    assert.ok(c.question.length > 10 && c.question.length <= 160 && /[?.]$/.test(c.question), c.id);
    assert.ok(c.id.startsWith('nsfw-'), 'NSFW ids can never collide with Comfort ids');
    assert.equal(comfort.has(c.question.toLowerCase()), false);
  }
  assert.equal(COMFORT_CARDS.some((c) => c.id.startsWith('nsfw-')), false);
});

test('the content is suggestive and consent-minded, never explicit: no explicit terms, and Boundaries is about consent and limits', () => {
  const explicit = /\b(sex|sexual|naked|nude|porn|orgasm|genital|penetrat|fuck|cum|dick|pussy|boob|breast|strip|bdsm|kink|fetish|masturbat|oral)\b/i;
  for (const c of NSFW_CARDS) assert.equal(explicit.test(c.question), false, `${c.id}: ${c.question}`);
  const boundaries = nsfwCardsInCategory('boundaries').map((c) => c.question.toLowerCase()).join(' ');
  for (const word of ['consent', 'boundary', 'limit', 'safe', 'no']) assert.ok(boundaries.includes(word), `Boundaries mentions "${word}"`);
});

test('the app list and the server list are identical (the server validates the ids)', () => {
  assert.deepEqual(SERVER_CATEGORIES, NSFW_CATEGORIES.map((c) => ({ id: c.id, label: c.label })));
  assert.deepEqual(SERVER_CARDS, NSFW_CARDS.map((c) => ({ ...c })));
  assert.equal(SERVER_TEXT, NSFW_CARD_TEXT);
});

test('only an id on the list is an NSFW card, and the parsed card never contains the question', () => {
  assert.equal(nsfwCardById('nsfw-flirty-01')?.category, 'flirty');
  for (const bad of ['', 'nsfw-flirty-99', 'NSFW-FLIRTY-01', 'soft-01', undefined, null, 5, {}, ['nsfw-flirty-01']]) {
    assert.equal(nsfwCardById(bad), null, String(bad));
    assert.equal(isNsfwCardId(bad), false, String(bad));
    assert.equal(serverCard(bad), null, String(bad));
  }
  const parsed = parseNsfwCard({ id: 'nsfw-spicy-02', question: 'forged' });
  assert.deepEqual(parsed, { id: 'nsfw-spicy-02', category: 'spicy', deck: 'nsfw' });
  assert.equal(JSON.stringify(parsed).includes('forged'), false);
  assert.deepEqual(shapeStoredNsfwCard({ id: 'nsfw-spicy-02', question: 'forged' }), { id: 'nsfw-spicy-02', category: 'spicy', deck: 'nsfw' });
  assert.equal(shapeStoredNsfwCard({ id: 'soft-01' }), null);
});

test('random picks stay inside the deck, can be limited to a category, and avoid the card just shown', () => {
  assert.equal(randomNsfwCard({ random: () => 0 }).id, NSFW_CARDS[0].id);
  assert.equal(randomNsfwCard({ random: () => 0.9999 }).id, NSFW_CARDS.at(-1)!.id);
  for (let i = 0; i < 100; i++) assert.equal(randomNsfwCard({ category: 'boundaries' }).category, 'boundaries');
  for (let i = 0; i < 100; i++) assert.notEqual(randomNsfwCard({ not: NSFW_CARDS[0].id }).id, NSFW_CARDS[0].id);
});

test('an NSFW message keeps the neutral line as its text, whatever the record says, so no quote or preview can carry the question', () => {
  const question = nsfwCardById('nsfw-flirty-02')!.question;
  const received = checkedCard({ id: 'm1', senderId: 'b', text: question, kind: 'card', card: { id: 'nsfw-flirty-02', category: 'flirty' }, createdAt: '2026-01-01T00:00:00Z' } as ThreadMessage);
  assert.equal(received.text, 'Mature card');
  assert.deepEqual(received.card, { id: 'nsfw-flirty-02', category: 'flirty', deck: 'nsfw' });
  const forged = checkedCard({ id: 'm2', senderId: 'b', text: 'anything', kind: 'card', card: { id: 'nsfw-nope-01', category: 'flirty' }, createdAt: '2026-01-01T00:00:00Z' } as ThreadMessage);
  assert.equal(forged.kind, undefined, 'an unknown id is shown as plain text');
  assert.equal(forged.card, undefined);
  const comfort = checkedCard({ id: 'm3', senderId: 'b', text: 'x', kind: 'card', card: { id: 'soft-01', category: 'soft' }, createdAt: '2026-01-01T00:00:00Z' } as ThreadMessage);
  assert.match(comfort.text, /smile today/, 'Comfort Cards are untouched');
  assert.equal(comfort.card?.deck, undefined);
  assert.equal(mergeMessages([], [received])[0].text, 'Mature card');
});

test('an NSFW card that is still being sent shows as an NSFW card with the neutral line', () => {
  const pending: PendingMessage = { id: 'p1', text: 'Mature card', cardId: 'nsfw-intimate-04', replyTo: null, status: 'sending', retryable: true, createdAt: Date.now() };
  const [shown] = visibleThread([], [pending], 'me');
  assert.equal(shown.kind, 'card');
  assert.equal(shown.text, 'Mature card');
  assert.deepEqual(shown.card, { id: 'nsfw-intimate-04', category: 'intimate', deck: 'nsfw' });
});

test('the inbox preview for an NSFW card is neutral, and a Comfort Card preview is unchanged', () => {
  assert.equal(previewText('Mature card', 'nsfw-card'), '🖤 Mature Card');
  assert.match(previewText('What is something small?', 'card'), /^Comfort Card: /);
  for (const c of NSFW_CARDS) assert.equal(previewText('Mature card', 'nsfw-card').includes(c.question), false);
});
