import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuggestion, SUGGESTION_MAX_LENGTH } from './suggestionService.ts';

test('normalizeSuggestion trims text and rejects anything too short', () => {
  assert.equal(normalizeSuggestion('  Dark mode for the public room  '), 'Dark mode for the public room');
  assert.equal(normalizeSuggestion('  hi '), null);
  assert.equal(normalizeSuggestion(''), null);
});

test('normalizeSuggestion caps text at the maximum length', () => {
  const long = 'a'.repeat(SUGGESTION_MAX_LENGTH + 50);
  assert.equal(normalizeSuggestion(long)?.length, SUGGESTION_MAX_LENGTH);
});
