import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCompatibilityScore,
  validateSetupProfile,
  sanitizeMessageText,
  generateSapphicPseudonym,
  PSEUDONYM_FIRST_WORDS,
  PSEUDONYM_SECOND_WORDS,
  PSEUDONYM_SPECIALS,
  toggleGenderExpression,
  togglePreferredFilter,
} from './matching-logic.ts';
import { isLocationCompatible, formatLocationSummary } from './philippines-locations.ts';
import { PartnerProfile, UserPreferences } from '../types.ts';

test('generateSapphicPseudonym produces two-word name and valid pronouns', () => {
  const result = generateSapphicPseudonym();
  assert.ok(result.name.includes(' '));
  assert.ok(['she/her', 'they/she', 'they/them'].includes(result.pronouns));
});

test('every possible pseudonym fits the 25-character display name limit', () => {
  const all = [
    ...PSEUDONYM_SPECIALS,
    ...PSEUDONYM_FIRST_WORDS.flatMap((a) => PSEUDONYM_SECOND_WORDS.map((b) => `${a} ${b}`)),
  ];
  for (const name of all) assert.ok(name.length <= 25 && name.includes(' '), name);
});

test('validateSetupProfile accepts valid display name', () => {
  const result = validateSetupProfile({
    displayName: 'Lavender Moon',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry'],
    region: 'Anywhere / Worldwide',
  });
  assert.equal(result.isValid, true);
  assert.equal(Object.keys(result.errors).length, 0);
});

test('validateSetupProfile rejects empty display name', () => {
  const result = validateSetupProfile({
    displayName: '   ',
    topics: [],
  });
  assert.equal(result.isValid, false);
  assert.ok(result.errors.displayName);
});

test('validateSetupProfile rejects over 8 topics', () => {
  const result = validateSetupProfile({
    displayName: 'Sapphic Reader',
    topics: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  });
  assert.equal(result.isValid, false);
  assert.ok(result.errors.topics);
});

test('validateSetupProfile enforces 18+ policy confirmation', () => {
  const result = validateSetupProfile(
    {
      displayName: 'Sapphic Guest',
      topics: [],
    },
    false // age not confirmed
  );
  assert.equal(result.isValid, false);
  assert.ok(result.errors.ageConfirmation);
});

test('calculateCompatibilityScore awards points for same intent and shared topics', () => {
  const user: UserPreferences = {
    displayName: 'Ivy',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry', 'Plants & Coffee'],
    region: 'North America',
  };

  const highMatchPartner: PartnerProfile = {
    id: 'p1',
    displayName: 'Aster',
    pronouns: 'they/she',
    intention: 'friendship',
    topics: ['WLW Books & Poetry', 'Plants & Coffee'],
    region: 'North America',
    avatarColor: '#8D426B',
  };

  const diffMatchPartner: PartnerProfile = {
    id: 'p2',
    displayName: 'Dahlia',
    pronouns: 'she/her',
    intention: 'dating',
    topics: ['Astrology & Tarot'],
    region: 'Europe & UK',
    avatarColor: '#382038',
  };

  const scoreHigh = calculateCompatibilityScore(user, highMatchPartner);
  const scoreLow = calculateCompatibilityScore(user, diffMatchPartner);

  assert.ok(scoreHigh > scoreLow);
  assert.ok(scoreHigh >= 85);
});

test('sanitizeMessageText blocks harmful content and allows clean text', () => {
  const clean = sanitizeMessageText('Hello! Have you read The Seven Husbands of Evelyn Hugo?');
  assert.equal(clean.isBlocked, false);
  assert.equal(clean.cleanText, 'Hello! Have you read The Seven Husbands of Evelyn Hugo?');

  const blocked = sanitizeMessageText('go kys right now');
  assert.equal(blocked.isBlocked, true);

  const empty = sanitizeMessageText('   ');
  assert.equal(empty.isBlocked, true);
});

test('toggleGenderExpression enforces mutual exclusivity for Prefer not to say', () => {
  // Selecting "Prefer not to say" clears any existing expressions
  const fromMultiple = toggleGenderExpression(['Femme', 'Stem'], 'Prefer not to say');
  assert.deepEqual(fromMultiple, ['Prefer not to say']);

  // Selecting a specific expression clears "Prefer not to say"
  const fromPreferNot = toggleGenderExpression(['Prefer not to say'], 'Soft Masc');
  assert.deepEqual(fromPreferNot, ['Soft Masc']);

  // Multi-selection of multiple valid expressions
  const withAnother = toggleGenderExpression(['Soft Masc'], 'Andro');
  assert.deepEqual(withAnother, ['Soft Masc', 'Andro']);

  // Toggling an active expression removes it
  const removed = toggleGenderExpression(['Soft Masc', 'Andro'], 'Soft Masc');
  assert.deepEqual(removed, ['Andro']);
});

test('togglePreferredFilter manages discovery filter selections', () => {
  // Selecting "Any / No preference" clears specific expressions
  const resetToAny = togglePreferredFilter(['Femme', 'Butch'], 'Any / No preference');
  assert.deepEqual(resetToAny, ['Any / No preference']);

  // Selecting a specific expression removes "Any / No preference"
  const selectFemme = togglePreferredFilter(['Any / No preference'], 'Femme');
  assert.deepEqual(selectFemme, ['Femme']);

  // Selecting additional expressions
  const multiFilter = togglePreferredFilter(['Femme'], 'Hyperfemme');
  assert.deepEqual(multiFilter, ['Femme', 'Hyperfemme']);

  // Unselecting all expressions falls back to "Any / No preference"
  const unselectedAll = togglePreferredFilter(['Femme'], 'Femme');
  assert.deepEqual(unselectedAll, ['Any / No preference']);
});

test('validateSetupProfile validates SOGIE and gender expression rules', () => {
  // Valid profile with SOGIE & gender expression
  const valid = validateSetupProfile({
    displayName: 'Wren Lark',
    pronouns: 'they/she',
    genderExpression: ['Femme', 'Stem'],
    sexualOrientation: 'Lesbian',
    genderIdentity: 'Cisgender Woman',
  });
  assert.equal(valid.isValid, true);

  // Rejects Prefer not to say combined with other expressions
  const invalidCombo = validateSetupProfile({
    displayName: 'Wren Lark',
    genderExpression: ['Prefer not to say', 'Femme'],
  });
  assert.equal(invalidCombo.isValid, false);
  assert.ok(invalidCombo.errors.genderExpression);

  // Rejects excessively long self-described SOGIE text
  const longCustom = validateSetupProfile({
    displayName: 'Wren Lark',
    sexualOrientationCustom: 'A'.repeat(45),
  });
  assert.equal(longCustom.isValid, false);
  assert.ok(longCustom.errors.sexualOrientationCustom);
});

test('calculateCompatibilityScore respects discovery filters and never penalizes unapplied or prefer-not-to-say', () => {
  const baseUser: UserPreferences = {
    displayName: 'Ivy',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry'],
    region: 'Anywhere / Worldwide',
    applyGenderExpressionFilter: false,
  };

  const femmePartner: PartnerProfile = {
    id: 'p-femme',
    displayName: 'Maya',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry'],
    region: 'Anywhere / Worldwide',
    avatarColor: '#8D426B',
    genderExpression: ['Femme'],
  };

  const mascPartner: PartnerProfile = {
    id: 'p-masc',
    displayName: 'Sol',
    pronouns: 'they/them',
    intention: 'friendship',
    topics: ['WLW Books & Poetry'],
    region: 'Anywhere / Worldwide',
    avatarColor: '#7a3159',
    genderExpression: ['Hard Masc'],
  };

  const neutralPartner: PartnerProfile = {
    id: 'p-neutral',
    displayName: 'Rowan',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry'],
    region: 'Anywhere / Worldwide',
    avatarColor: '#5a2548',
    genderExpression: ['Prefer not to say'],
  };

  // 1. When filter is NOT enabled: SOGIE / expression does NOT alter scores
  const scoreFemmeWithoutFilter = calculateCompatibilityScore(baseUser, femmePartner);
  const scoreMascWithoutFilter = calculateCompatibilityScore(baseUser, mascPartner);
  const scoreNeutralWithoutFilter = calculateCompatibilityScore(baseUser, neutralPartner);
  assert.equal(scoreFemmeWithoutFilter, scoreMascWithoutFilter);
  assert.equal(scoreFemmeWithoutFilter, scoreNeutralWithoutFilter);

  // 2. When filter IS enabled for 'Femme':
  const userWithFilter: UserPreferences = {
    ...baseUser,
    applyGenderExpressionFilter: true,
    preferredGenderExpressions: ['Femme'],
  };

  const scoreFemmeWithFilter = calculateCompatibilityScore(userWithFilter, femmePartner);
  const scoreMascWithFilter = calculateCompatibilityScore(userWithFilter, mascPartner);
  const scoreNeutralWithFilter = calculateCompatibilityScore(userWithFilter, neutralPartner);

  // Filter-matched partner receives bonus
  assert.ok(scoreFemmeWithFilter > scoreMascWithFilter);
  // Partner with 'Prefer not to say' is never penalized relative to baseline
  assert.equal(scoreNeutralWithFilter, scoreNeutralWithoutFilter);
});

test('Philippine location matching and formatting rules work correctly', () => {
  assert.equal(isLocationCompatible(['Anywhere in the Philippines'], 'Cebu City'), true);
  assert.equal(isLocationCompatible(['Luzon'], 'Quezon City, Metro Manila'), true);
  assert.equal(isLocationCompatible(['Visayas'], 'Davao City'), false);
  assert.equal(isLocationCompatible(['Visayas'], 'Cebu City, Cebu'), true);

  assert.equal(formatLocationSummary(['Anywhere in the Philippines']), 'Anywhere in the Philippines');
  assert.equal(formatLocationSummary(['Luzon', 'Visayas']), 'Luzon, Visayas');
  assert.equal(formatLocationSummary(['NCR', 'Cebu', 'Davao', 'Baguio']), 'NCR, Cebu +2 more');
});
