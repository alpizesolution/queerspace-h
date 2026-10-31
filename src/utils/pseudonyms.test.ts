import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PSEUDONYM_FIRST_WORDS,
  PSEUDONYM_MAX_LENGTH,
  PSEUDONYM_SECOND_WORDS,
  countNaturalPairs,
  dedupeWords,
  generatePseudonym,
  generatePseudonymCandidates,
  isNaturalPair,
} from './pseudonyms.ts';

const hasRepeats = (words: readonly string[]) => new Set(words.map((w) => w.toLowerCase())).size !== words.length;

test('both lists are free of repeats, spelled as plain words, and keep the curated vocabulary', () => {
  assert.equal(hasRepeats(PSEUDONYM_FIRST_WORDS), false);
  assert.equal(hasRepeats(PSEUDONYM_SECOND_WORDS), false);
  for (const word of [...PSEUDONYM_FIRST_WORDS, ...PSEUDONYM_SECOND_WORDS]) assert.match(word, /^[A-Z][A-Za-z]+$/, word);
  // Supplied: 194 first words (23 are repeats of earlier entries) and 196 second words (none repeated).
  assert.equal(PSEUDONYM_FIRST_WORDS.length, 171);
  assert.equal(PSEUDONYM_SECOND_WORDS.length, 196);
  for (const kept of ['Lovestruck', 'Eavesdropping', 'Velvet', 'Unapologetic']) assert.ok(PSEUDONYM_FIRST_WORDS.includes(kept), kept);
  for (const kept of ['Muse', 'Wildling', 'HopelessRomantic', 'Marupok']) assert.ok(PSEUDONYM_SECOND_WORDS.includes(kept), kept);
});

test('dedupeWords keeps the first spelling and the original order, ignoring case', () => {
  assert.deepEqual(dedupeWords(['Soft', 'Cozy', 'soft', 'Warm', 'COZY']), ['Soft', 'Cozy', 'Warm']);
});

test('every example name from the brief is allowed', () => {
  const examples: [string, string][] = [
    ['Velvet', 'Muse'], ['Smitten', 'Siren'], ['Chasing', 'Venus'], ['Dreamy', 'Fox'], ['Chaotic', 'Cupid'],
    ['Moonlit', 'Bunny'], ['Blushing', 'Orchid'], ['Stealing', 'Kiss'], ['Flirty', 'Firefly'], ['Wandering', 'Witch'],
  ];
  for (const [a, b] of examples) assert.equal(isNaturalPair(a, b), true, `${a}${b}`);
});

test('awkward, repeated and unsuitable pairs are refused', () => {
  const refused: [string, string][] = [
    ['Darling', 'Darling'], ['Kissing', 'Kiss'], ['Dreaming', 'Daydreamer'], ['Wandering', 'Wanderer'], ['Starlit', 'Star'],
    ['Moonlit', 'Moonbeam'], ['Hopeless', 'HopelessRomantic'], ['Stalking', 'Crush'], ['Stalking', 'Sunshine'],
    ['Snooping', 'Girlfriend'], ['Seducing', 'Puppy'], ['Seductive', 'Kitten'], ['Sultry', 'Cupcake'],
    ['Unapologetic', 'HopelessRomantic'],
  ];
  for (const [a, b] of refused) assert.equal(isNaturalPair(a, b), false, `${a}${b}`);
});

test('every first word still has plenty of partners, and every allowed name fits the limit', () => {
  let total = 0;
  for (const first of PSEUDONYM_FIRST_WORDS.filter((w) => w !== 'Stalking')) {
    const partners = PSEUDONYM_SECOND_WORDS.filter((second) => isNaturalPair(first, second));
    assert.ok(partners.length >= 50, `${first} has ${partners.length}`);
    for (const second of partners) assert.ok(`${first}${second}`.length <= PSEUDONYM_MAX_LENGTH, `${first}${second}`);
    total += partners.length;
  }
  assert.equal(total, countNaturalPairs());
  assert.ok(total > 25_000, `only ${total} allowed names`);
});

test('generated names are FirstSecond with no spaces or symbols, and always pass the rules', () => {
  for (let i = 0; i < 20_000; i++) {
    const name = generatePseudonym();
    assert.match(name, /^[A-Za-z]+$/);
    assert.ok(name.length <= PSEUDONYM_MAX_LENGTH, name);
    const first = PSEUDONYM_FIRST_WORDS.find((w) => name.startsWith(w) && PSEUDONYM_SECOND_WORDS.includes(name.slice(w.length)) && isNaturalPair(w, name.slice(w.length)));
    assert.ok(first, name);
  }
});

test('candidates are distinct and the generator accepts a seeded random', () => {
  const names = generatePseudonymCandidates(12);
  assert.equal(names.length, 12);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 12);
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const a = generatePseudonym(random);
  seed = 1;
  assert.equal(generatePseudonym(random), a);
});
