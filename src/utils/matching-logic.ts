import { GenderExpressionOption, Intention, PartnerProfile, UserPreferences } from '../types.ts';
import { isLocationCompatible } from './philippines-locations.ts';
import { generatePseudonym } from './pseudonyms.ts';

export const INTENTION_LABELS: Record<Intention, string> = {
  friendship: 'Friendship & Bonding',
  dating: 'Dating & Romance',
  casual: 'Casual Chitchat',
  deep_talk: 'Heart-to-Heart',
  open: 'Open to Anything',
};

export const AVAILABLE_TOPICS: string[] = [
  'WLW Books & Poetry',
  'Chappell Roan & Music',
  'Anime & Cozy Games',
  'Plants & Coffee',
  'Queer History & Art',
  'Late Bloomer Stories',
  'Cats & Dogs',
  'Creative Writing',
  'Baking & Cooking',
  'Astrology & Tarot',
  'Tech & Work Life',
  'Venting & Comfort',
];

export const REGIONS: string[] = [
  'Anywhere in the Philippines',
  'Luzon',
  'Visayas',
  'Mindanao',
  'National Capital Region (NCR), Metro Manila',
  'Cebu Province / Cebu City',
  'Davao Region / Davao City',
  'Cordillera (Baguio City)',
  'Western Visayas (Iloilo / Bacolod)',
  'CALABARZON',
];

/** Personality and interests, intentionally distinct from SOGIE identity labels. */
export const MY_VIBE_OPTIONS = [
  'Soft & Sweet',
  'Introvert',
  'Adventurous',
  'Book Lover',
  'Gamer',
  'Creative',
  'Cozy Homebody',
  'Night Owl',
] as const;

/** Public aesthetic label for how someone likes to dress; not SOGIE and never a matching criterion. */
export const PERSONAL_STYLE_OPTIONS = [
  'Soft & Feminine',
  'Androgynous',
  'Tomboy',
  'Sporty',
  'Streetwear',
  'Vintage',
  'Alt & Edgy',
  'Cozy Casual',
  'Minimalist',
  'Always Changing',
] as const;

/**
 * Inclusive predefined gender-expression and presentation labels.
 * This is a profile self-description list, not a matching or eligibility rule.
 */
export const GENDER_EXPRESSIONS: GenderExpressionOption[] = [
  // Feminine
  'Femme',
  'High Femme',
  'Hyperfemme',
  'Soft Femme',
  'Feminine',
  'Ultra-Feminine',
  'Girly',
  'Chapstick Femme',
  'Lipstick Lesbian',
  // Masculine
  'Masc',
  'Soft Masc',
  'Softmasc',
  'Hard Masc',
  'Butch',
  'Stone Butch',
  'Stud',
  'Stem',
  'Tomboy',
  'Masculine',
  'Ultra-Masculine',
  'Chapstick',
  'Gentle Masc',
  // Androgynous and mixed
  'Androgynous',
  'Andro',
  'Futch',
  'Femme-Masc Mix',
  'Soft Androgynous',
  'Masc-Femme',
  'Gender-Neutral Presentation',
  'Balanced Expression',
  'Mixed Expression',
  // Fluid and gender-diverse expression
  'Gender-Fluid Expression',
  'Gender-Nonconforming',
  'Gender-Expansive',
  'Gender-Ambiguous',
  'Fluid Presentation',
  'Nonbinary Expression',
  'Neutral Expression',
  'Unisex Style',
  'Changing Expression',
  // Self-description
  'No Label',
  'No label / Other',
  'Still Exploring',
  'Prefer not to say',
];

export const SEXUAL_ORIENTATIONS: string[] = [
  'Lesbian',
  'Sapphic',
  'Bisexual',
  'Pansexual',
  'Queer',
  'Questioning',
  'Self-described',
  'Prefer not to say',
];

export const GENDER_IDENTITIES: string[] = [
  'Cisgender Woman',
  'Transgender Woman',
  'Non-binary',
  'Genderfluid',
  'Agender',
  'Demigirl',
  'Self-described',
  'Prefer not to say',
];

export const PRONOUN_OPTIONS: string[] = [
  'she/her',
  'they/she',
  'they/them',
  'she/they',
  'any pronouns',
  'Self-described',
  'Prefer not to say',
];

export const DISCOVERY_FILTER_OPTIONS: string[] = [
  'Any / No preference',
  ...MY_VIBE_OPTIONS,
  'Soft Masc',
  'Hard Masc',
  'No label / Other',
];

/**
 * Handles multi-selection of gender expressions with mutual exclusivity for "Prefer not to say".
 */
export function toggleGenderExpression(
  current: GenderExpressionOption[] = [],
  selected: GenderExpressionOption
): GenderExpressionOption[] {
  if (selected === 'Prefer not to say') {
    // If already selected, allow clearing; otherwise make mutually exclusive
    return current.includes('Prefer not to say') ? [] : ['Prefer not to say'];
  }

  // If selecting a specific expression, remove 'Prefer not to say'
  const withoutPreferNot = current.filter((item) => item !== 'Prefer not to say');
  if (withoutPreferNot.includes(selected)) {
    return withoutPreferNot.filter((item) => item !== selected);
  }
  return [...withoutPreferNot, selected];
}

/**
 * Handles discovery filter preferences. "Any / No preference" is mutually exclusive with specific filters.
 */
export function togglePreferredFilter(
  current: string[] = ['Any / No preference'],
  selected: string
): string[] {
  if (selected === 'Any / No preference') {
    return ['Any / No preference'];
  }

  const withoutAny = current.filter((item) => item !== 'Any / No preference');
  let next: string[];
  if (withoutAny.includes(selected)) {
    next = withoutAny.filter((item) => item !== selected);
  } else {
    next = [...withoutAny, selected];
  }

  // If user unselects everything, fallback to "Any / No preference"
  return next.length > 0 ? next : ['Any / No preference'];
}

// Pseudonyms are FirstSecond names (VelvetMuse) built from the curated vocabulary in pseudonyms.ts. This keeps the
// call sites that also need pronouns; the name itself is only a proposal until the server reserves it (api/pseudonym.js).
export function generateSapphicPseudonym(): { name: string; pronouns: string } {
  const pronouns = Math.random() > 0.35 ? 'she/her' : (Math.random() > 0.5 ? 'they/she' : 'they/them');
  return { name: generatePseudonym(), pronouns };
}

/**
 * Calculates a match score between 0 and 100 based on shared intention and topics.
 * My Type is based on a member's optional public My Vibe label, never SOGIE fields.
 */
export function calculateCompatibilityScore(
  userPrefs: UserPreferences,
  partner: PartnerProfile
): number {
  let score = 50; // base score for two sapphic community members

  // Intention compatibility
  if (userPrefs.intention === 'open' || partner.intention === 'open') {
    score += 20;
  } else if (userPrefs.intention === partner.intention) {
    score += 25;
  } else if (
    (userPrefs.intention === 'friendship' && partner.intention === 'casual') ||
    (userPrefs.intention === 'casual' && partner.intention === 'friendship')
  ) {
    score += 15;
  } else {
    score -= 10;
  }

  // Topic overlap
  if (userPrefs.topics.length > 0 && partner.topics.length > 0) {
    const userTopicsSet = new Set(userPrefs.topics.map((t) => t.toLowerCase()));
    const sharedTopics = partner.topics.filter((t) => userTopicsSet.has(t.toLowerCase()));
    score += Math.min(sharedTopics.length * 10, 25);
  }

  // Location affinity
  const userLocations = userPrefs.locationSelection || [userPrefs.region || 'Anywhere in the Philippines'];
  const partnerLoc = partner.location || partner.region || '';
  if (isLocationCompatible(userLocations, partnerLoc)) {
    score += 10;
  }

  // My Type compares only with the person's optional public My Vibe label.
  // SOGIE identity fields never rank, exclude, or penalize anyone.
  if (
    userPrefs.applyGenderExpressionFilter &&
    userPrefs.preferredGenderExpressions?.length &&
    !userPrefs.preferredGenderExpressions.includes('Any / No preference') &&
    partner.myVibe
  ) {
    if (userPrefs.preferredGenderExpressions.includes(partner.myVibe)) score += 25;
    else score -= 20;
  }

  return Math.min(Math.max(score, 10), 100);
}

/**
 * Validates user preferences for matching setup.
 */
export function validateSetupProfile(
  prefs: Partial<UserPreferences>,
  isAgeConfirmed: boolean = true
): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!prefs.displayName || prefs.displayName.trim().length === 0) {
    errors.displayName = 'Please choose a display name or use the random generator.';
  } else if (prefs.displayName.trim().length > 25) {
    errors.displayName = 'Display name must be 25 characters or fewer.';
  }

  if (prefs.topics && prefs.topics.length > 8) {
    errors.topics = 'You can select up to 8 topics.';
  }

  if (!isAgeConfirmed) {
    errors.ageConfirmation = 'You must affirm that you are at least 18 years old to enter.';
  }

  if (prefs.applyAgeFilter) {
    const { ageMin, ageMax } = prefs;
    if (
      !Number.isInteger(ageMin) || !Number.isInteger(ageMax) ||
      ageMin! < 18 || ageMax! > 99 || ageMin! > ageMax!
    ) {
      errors.ageRange = 'Choose an age range between 18 and 99, with the lower age first.';
    }
  }

  // Mutual exclusivity check: "Prefer not to say" must be alone if present
  if (
    prefs.genderExpression &&
    prefs.genderExpression.includes('Prefer not to say') &&
    prefs.genderExpression.length > 1
  ) {
    errors.genderExpression =
      '"Prefer not to say" cannot be combined with specific gender expressions.';
  }

  // Custom text lengths
  if (prefs.sexualOrientationCustom && prefs.sexualOrientationCustom.trim().length > 40) {
    errors.sexualOrientationCustom = 'Self-described orientation must be 40 characters or fewer.';
  }

  if (prefs.genderIdentityCustom && prefs.genderIdentityCustom.trim().length > 40) {
    errors.genderIdentityCustom = 'Self-described gender identity must be 40 characters or fewer.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Basic content moderation filter for respectful conversations.
 */
const BLOCKED_PATTERNS = [
  /\b(kill yourself|kys)\b/i,
  /\b(nazi|hitler|faggot|dyke bitch)\b/i,
  /\b(send nudes|selling content|telegram @)\b/i,
];

export function sanitizeMessageText(text: string): {
  cleanText: string;
  isBlocked: boolean;
  warning?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { cleanText: '', isBlocked: true, warning: 'Message cannot be empty.' };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        cleanText: '',
        isBlocked: true,
        warning: 'Message violates community safety guidelines.',
      };
    }
  }

  return {
    cleanText: trimmed,
    isBlocked: false,
  };
}

export function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
