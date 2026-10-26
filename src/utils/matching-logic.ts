import { GenderExpressionOption, Intention, PartnerProfile, UserPreferences } from '../types.ts';
import { isLocationCompatible } from './philippines-locations.ts';

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

export const GENDER_EXPRESSIONS: GenderExpressionOption[] = [
  'Femme',
  'Soft Masc',
  'Hard Masc',
  'Andro',
  'Hyperfemme',
  'Butch',
  'Stem',
  'No label / Other',
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
  'Femme',
  'Soft Masc',
  'Hard Masc',
  'Andro',
  'Hyperfemme',
  'Butch',
  'Stem',
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

// Reddit-style usernames (Adjective_Noun) without the trailing numbers, queer-coded.
// Generated names stay within the 25-character display name limit (see generateSapphicPseudonym).
export const PSEUDONYM_MAX_LENGTH = 25;

export const PSEUDONYM_FIRST_WORDS = [
  // Existing favorites
  'Chaotic', 'Cozy', 'Soft', 'Feral', 'Sapphic', 'Bisexual', 'Lesbian', 'Tender', 'Moody', 'Sleepy',
  'Butch', 'Femme', 'Thrifted', 'Lovesick', 'Kilig', 'Marupok', 'Flannel', 'Tarot', 'Lavender',
  'Overthinking', 'Dreamy', 'Clumsy', 'Witty', 'Gentle', 'Spicy', 'Mossy', 'Velvet', 'Starry',
  // Sapphic chaos
  'DownBad', 'Yearning', 'Pining', 'Simping', 'Delulu', 'Clingy',
  'Hopeless', 'Flustered', 'Jealous', 'Thirsty', 'Whipped', 'Obsessed',
  // Soft sapphic energy
  'Blushing', 'Lovestruck', 'Starcrossed', 'Moonstruck', 'Giddy',
  'Dreaming', 'Shy', 'Secretly', 'Tenderhearted', 'Heartbroken',
  // WLW-coded aesthetics
  'Cottagecore', 'Goth', 'Punk', 'Golden', 'Midnight', 'Rosy',
  'Cosmic', 'Angelic', 'Enchanted', 'Moonlit', 'Ethereal', 'Blooming',
  // Filipino-coded
  'Marites', 'Torpe', 'KiligOverload', 'Baka', 'SanaAll',
  'Tampo', 'Lambing', 'Ligaw', 'Harana', 'Paasa',
  // Lesbian humor
  'Useless', 'Unhinged', 'Dramatic', 'Delusional',
  'TouchStarved', 'Emotionally', 'Accidentally', 'Chronically',
  'Unavailable', 'Hopelessly', 'Questionably',
];

export const PSEUDONYM_SECOND_WORDS = [
  // Existing favorites
  'Carabiner', 'Cardigan', 'Gremlin', 'Frog', 'Moth', 'Raccoon', 'Witch', 'Poet', 'Heartthrob',
  'Mushroom', 'Bookworm', 'Beshie', 'PlantMom', 'CatLady', 'Stargazer', 'Daydreamer', 'Romantic',
  'Sweetheart', 'Sunflower', 'Otter', 'Capybara', 'Tulip', 'Mango', 'Ube', 'Siopao', 'Pandesal',
  // Sapphic stereotypes and inside jokes
  'UHaul', 'Situationship', 'Girlfriend', 'WifeMaterial',
  'ExGirlfriend', 'Crush', 'Heartbreaker', 'SoftMasc',
  'PillowPrincess', 'GoldenRetriever', 'BlackCat',
  'FemmeFatale', 'BabyGay', 'LesbianPanic',
  // Flirting and yearning
  'EyeContact', 'LoveLetter', 'LoveSong', 'SlowBurn',
  'FirstKiss', 'SecretCrush', 'AlmostGirlfriend',
  'MutualCrush', 'MissedConnection', 'LoveConfession',
  'WeddingPlanner', 'FutureWife', 'HandHolder',
  // Queer-coded objects and aesthetics
  'Flannel', 'DocMartens', 'SilverRing', 'ToteBag',
  'VinylRecord', 'PoetryBook', 'Lipstick', 'LavenderField',
  'MatchaLatte', 'FilmCamera', 'Moonstone', 'PaperMoon',
  // Filipino humor
  'Marites', 'Chismosa', 'Bestie', 'Ate',
  'Tita', 'Tambay', 'Harana', 'Kundiman',
  'Jeepney', 'HaloHalo', 'Sampaguita', 'Bibingka',
  // Cute chaos
  'Menace', 'Disaster', 'MenaceToSociety', 'Catastrophe',
  'EmotionalSupport', 'WalkingRedFlag', 'GreenFlag',
  'PlotTwist', 'GayPanic', 'Daydream', 'LoveBug',
];

// Hand-picked names that don't fit the two-part pattern.
export const PSEUDONYM_SPECIALS = [
  'UHaul_Enthusiast', 'Carabiner_Collector', 'Certified_Pining_Expert', 'Kilig_Professional',
  'Marupok_Era', 'Ate_Of_The_GroupChat', 'Beshie_With_Feelings', 'Two_Cats_One_Cardigan',
  'ToteBag_Philosopher', 'PlantMom_Energy', 'SadGirl_Hours', 'Disaster_Bisexual',
  'Useless_Lesbian', 'Mutual_Pining', 'Situationship_Survivor', 'MainCharacter_Energy',
];

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function generateSapphicPseudonym(): { name: string; pronouns: string } {
  let name: string;
  if (Math.random() < 0.2) {
    name = pick(PSEUDONYM_SPECIALS);
  } else {
    const first = pick(PSEUDONYM_FIRST_WORDS);
    // Only second words that keep the whole name within the display name limit, and never a repeat.
    const room = PSEUDONYM_MAX_LENGTH - first.length - 1;
    name = `${first}_${pick(PSEUDONYM_SECOND_WORDS.filter((w) => w.length <= room && w !== first))}`;
  }
  const pronouns = Math.random() > 0.35 ? 'she/her' : (Math.random() > 0.5 ? 'they/she' : 'they/them');
  return { name, pronouns };
}

/**
 * Calculates a match score between 0 and 100 based on shared intention and topics.
 * When applyGenderExpressionFilter is enabled, matches preferred expressions.
 * IMPORTANT: Never automatically ranks, excludes, or penalizes users based on SOGIE
 * or gender expression when filters are not explicitly activated by the user.
 * "Prefer not to say" is never penalized.
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

  // Optional Gender Expression Filter (used ONLY when explicitly enabled by user)
  if (
    userPrefs.applyGenderExpressionFilter &&
    userPrefs.preferredGenderExpressions &&
    userPrefs.preferredGenderExpressions.length > 0 &&
    !userPrefs.preferredGenderExpressions.includes('Any / No preference')
  ) {
    const preferredSet = new Set(userPrefs.preferredGenderExpressions);
    const partnerExpressions = partner.genderExpression || [];

    // "Prefer not to say" or unset does not exclude or penalize (inclusive privacy protection)
    const hasPreferNotToSay =
      partnerExpressions.length === 0 || partnerExpressions.includes('Prefer not to say');

    if (!hasPreferNotToSay) {
      const hasMatch = partnerExpressions.some((expr) => preferredSet.has(expr));
      if (hasMatch) {
        score += 25; // boost partner matching chosen filter
      } else {
        score -= 20; // lower priority relative to matched partners
      }
    }
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

  if (prefs.age !== undefined) {
    if (!Number.isInteger(prefs.age) || prefs.age < 18) {
      errors.age = 'QUEERSPACE PH is for people 18 and older.';
    } else if (prefs.age > 99) {
      errors.age = 'Please enter an age between 18 and 99.';
    }
  }

  if (prefs.applyAgeFilter) {
    const { ageMin, ageMax } = prefs;
    if (
      !Number.isInteger(ageMin) || !Number.isInteger(ageMax) ||
      ageMin! < 18 || ageMax! > 99 || ageMin! > ageMax!
    ) {
      errors.ageRange = 'Choose an age range between 18 and 99, with the lower age first.';
    } else if (prefs.age === undefined) {
      errors.ageRange = 'Add your own age to use the age filter.';
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
