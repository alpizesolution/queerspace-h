import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNewIncomingMessage } from './incomingMessage.ts';

const m = (id: string, isSelf = false) => ({ id, isSelf });

test('no chime for the first load or an empty list', () => {
  assert.equal(hasNewIncomingMessage(null, [m('a'), m('b')]), false);
  assert.equal(hasNewIncomingMessage('a', []), false);
});

test('chimes when someone else posts a new latest message', () => {
  assert.equal(hasNewIncomingMessage('a', [m('a'), m('b')]), true);
});

test('does not chime for your own message or when nothing changed', () => {
  assert.equal(hasNewIncomingMessage('a', [m('a'), m('b', true)]), false);
  assert.equal(hasNewIncomingMessage('b', [m('a'), m('b')]), false);
});

test('still chimes when the feed is capped and its length does not grow', () => {
  const before = Array.from({ length: 15 }, (_, i) => m(`m${i}`));
  const after = [...before.slice(1), m('m15')];
  assert.equal(after.length, before.length);
  assert.equal(hasNewIncomingMessage('m14', after), true);
});
