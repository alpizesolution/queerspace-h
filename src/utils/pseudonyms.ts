// Pseudonym vocabulary and generator: FirstWord + SecondWord (for example VelvetMuse, SmittenSiren).
//
// The lists are the curated vocabulary exactly as supplied, with repeats removed (first occurrence wins, original order
// kept). First words are adjectives and verb forms, second words are nouns. A pair is only used if it passes
// isNaturalPair, because not all ~40,000 combinations read well. Uniqueness across accounts is NOT decided here: the
// server reserves every name (api/pseudonym.js), this module only proposes good-sounding candidates.

/** Same limit as the display name field in the profile editor. */
export const PSEUDONYM_MAX_LENGTH = 25;

const RAW_FIRST_WORDS = [
  'Lovestruck', 'Smitten', 'Blushing', 'Yearning', 'Adoring',
  'Flirty', 'Tender', 'Darling', 'Amorous', 'Devoted',
  'Longing', 'Dreamy', 'Rosy', 'Heartbroken', 'Hopeless',
  'Enamored', 'Bewitched', 'Woozy', 'Passionate', 'Affectionate',
  'Kissing', 'Craving', 'Swooning', 'Pining', 'Whispering',
  'Moonlit', 'Starlit', 'Lunar', 'Cosmic', 'Ethereal',
  'Mystic', 'Enchanted', 'Secret', 'Hidden', 'Midnight',
  'Celestial', 'Astral', 'Nebulous', 'Dreaming', 'Wandering',
  'Floating', 'Drifting', 'Haunting', 'Glowing', 'Shimmering',
  'Radiant', 'Twilight', 'Distant', 'Spellbound', 'Otherworldly',
  'Cheeky', 'Sassy', 'Chaotic', 'Clumsy', 'Giddy',
  'Silly', 'Mischievous', 'Quirky', 'Goofy', 'Witty',
  'Sneaky', 'Nosy', 'Dramatic', 'Reckless', 'Bubbly',
  'Spicy', 'Feisty', 'Zesty', 'Curious', 'Bold',
  'Teasing', 'Winking', 'Plotting', 'Simping', 'Overthinking',
  'Velvet', 'Silky', 'Honeyed', 'Gentle', 'Delicate',
  'Dainty', 'Graceful', 'Lovely', 'Sweet', 'Soft',
  'Golden', 'Blithe', 'Angelic', 'Elegant', 'Petal',
  'Fluffy', 'Cozy', 'Warm', 'Serene', 'Lush',
  'Blooming', 'Dreamlike', 'Radiating', 'Fierce', 'Fearless',
  'Wild', 'Untamed', 'Daring', 'Sultry', 'Magnetic',
  'Electric', 'Rebellious', 'Defiant', 'Untouchable', 'Unbothered',
  'Sizzling', 'Fiery', 'Savage', 'Fearsome', 'Powerful',
  'Flawless', 'Alluring', 'Tempting', 'Seductive', 'Audacious',
  'Unapologetic', 'Thriving', 'Irresistible', 'Chasing', 'Falling',
  'Missing', 'Loving', 'Flirting', 'Hugging', 'Holding',
  'Melting', 'Yearning', 'Dreaming', 'Confessing', 'Adoring',
  'Embracing', 'Surrendering', 'Wooing', 'Swooning', 'Craving',
  'Kissing', 'Longing', 'Pining', 'Blushing', 'Cuddling',
  'Whispering', 'Seducing', 'Wandering', 'Exploring', 'Escaping',
  'Searching', 'Hiding', 'Haunting', 'Floating', 'Drifting',
  'Orbiting', 'Stargazing', 'Summoning', 'Following', 'Disappearing',
  'Roaming', 'Glowing', 'Shimmering', 'Blooming', 'Unfolding',
  'Traveling', 'Discovering', 'Dreamwalking', 'Teleporting', 'Hovering',
  'Transcending', 'Stealing', 'Sneaking', 'Plotting', 'Teasing',
  'Simping', 'Stalking', 'Overthinking', 'Daydreaming', 'Collecting',
  'Dancing', 'Winking', 'Laughing', 'Pretending', 'Confusing',
  'Crashing', 'Spilling', 'Scheming', 'Snooping', 'Pranking',
  'Flirting', 'Romancing', 'Bothering', 'Eavesdropping',
];

const RAW_SECOND_WORDS = [
  'Muse', 'Lover', 'Crush', 'Sweetheart', 'Valentine',
  'Soulmate', 'Girlfriend', 'Heartbeat', 'Lovebug', 'Cupid',
  'Venus', 'Aphrodite', 'Princess', 'Queen', 'Goddess',
  'Duchess', 'Darling', 'Angel', 'Siren', 'Heartthrob',
  'Beloved', 'Daydream', 'Romance', 'Kiss', 'Confession',
  'Rose', 'Orchid', 'Blossom', 'Peony', 'Dahlia',
  'Magnolia', 'Jasmine', 'Lavender', 'Petal', 'Pearl',
  'Diamond', 'Sapphire', 'Ruby', 'Opal', 'Emerald',
  'Swan', 'Ballerina', 'Heiress', 'Empress', 'Belle',
  'Jewel', 'Ribbon', 'Tiara', 'Moon', 'Star',
  'Comet', 'Nova', 'Eclipse', 'Galaxy', 'Nebula',
  'Stardust', 'Cosmos', 'Aurora', 'Solstice', 'Equinox',
  'Meteor', 'Orbit', 'Constellation', 'Supernova', 'Milkyway',
  'Moonbeam', 'Starlight', 'Asteroid', 'Satellite', 'Planet',
  'Universe', 'Meteorite', 'Crescent', 'Witch', 'Wizard',
  'Pixie', 'Fairy', 'Nymph', 'Oracle', 'Enchantress',
  'Phantom', 'Spirit', 'Ghost', 'Spell', 'Potion',
  'Charm', 'Crystal', 'Amulet', 'Talisman', 'Phoenix',
  'Dragon', 'Unicorn', 'Mermaid', 'Sorceress', 'Familiar',
  'Alchemist', 'Moonchild', 'Stardancer', 'Fox', 'Bunny',
  'Kitten', 'Puppy', 'Moth', 'Butterfly', 'Dove',
  'Raven', 'Owl', 'Otter', 'Panda', 'Koala',
  'Deer', 'Fawn', 'Wolf', 'Lynx', 'Leopard',
  'Tiger', 'Panther', 'Bear', 'Hamster', 'Hedgehog',
  'Axolotl', 'Firefly', 'Willow', 'Clover', 'Fern',
  'Meadow', 'Forest', 'Garden', 'Ocean', 'River',
  'Waterfall', 'Rain', 'Raindrop', 'Cloud', 'Thunder',
  'Breeze', 'Sunshine', 'Sunset', 'Sunrise', 'Wildflower',
  'Moonflower', 'Seaglass', 'Seashell', 'Coral', 'Ivy',
  'Evergreen', 'Mochi', 'Noodle', 'Pickle', 'Potato',
  'Jellybean', 'Cupcake', 'Pancake', 'Dumpling', 'Cookie',
  'Brownie', 'Marshmallow', 'Muffin', 'Pudding', 'Waffle',
  'Donut', 'Boba', 'Popcorn', 'Pretzel', 'Tater',
  'Nugget', 'Peanut', 'Cheesecake', 'Bubblegum', 'Lollipop',
  'Sprinkles', 'Femme', 'Butch', 'Sapphic', 'Rainbow',
  'Pride', 'Daydreamer', 'Poet', 'Storyteller', 'Wanderer',
  'Dreamer', 'Troublemaker', 'Heartbreaker', 'HopelessRomantic',
  'Girlie', 'Bestie', 'Beshie', 'Kilig', 'Marupok',
  'Ganda', 'Bebang', 'Confidante', 'Rebel', 'Dreamboat',
  'Firecracker', 'Wildling',
];

/** Removes repeats ignoring case, keeping the first occurrence and the original order. */
export function dedupeWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

export const PSEUDONYM_FIRST_WORDS: readonly string[] = dedupeWords(RAW_FIRST_WORDS);
export const PSEUDONYM_SECOND_WORDS: readonly string[] = dedupeWords(RAW_SECOND_WORDS);

// ---- Compatibility rules -------------------------------------------------------------------------------------------

/** Suggestive or predatory-sounding first words. They never go with a tender or childlike noun. */
const EDGY_FIRST = new Set([
  'Seducing', 'Seductive', 'Sultry', 'Tempting', 'Sizzling', 'Savage', 'Fearsome',
]);
/** Watching, bothering or following words. They never go with a person, a romantic role or a pet name. */
const INTRUSIVE_FIRST = new Set(['Snooping', 'Eavesdropping', 'Bothering']);

/** Small animals, sweets, pet names: cute nouns that read badly after an edgy word. */
const TENDER_NOUNS = new Set([
  'Kitten', 'Puppy', 'Bunny', 'Fawn', 'Panda', 'Koala', 'Hamster', 'Hedgehog', 'Axolotl', 'Girlie', 'Bestie', 'Beshie',
  'Lovebug', 'Mochi', 'Noodle', 'Pickle', 'Potato', 'Jellybean', 'Cupcake', 'Pancake', 'Dumpling', 'Cookie', 'Brownie',
  'Marshmallow', 'Muffin', 'Pudding', 'Waffle', 'Donut', 'Boba', 'Popcorn', 'Pretzel', 'Tater', 'Nugget', 'Peanut',
  'Cheesecake', 'Bubblegum', 'Lollipop', 'Sprinkles', 'Butterfly', 'Dove', 'Pixie', 'Fairy', 'Angel', 'Princess',
]);
/** People and romantic roles. "Stalking Crush" is not a name anyone should be given. */
const PERSON_NOUNS = new Set([
  'Muse', 'Lover', 'Crush', 'Sweetheart', 'Valentine', 'Soulmate', 'Girlfriend', 'Darling', 'Beloved', 'Heartthrob',
  'Romance', 'Kiss', 'Confession', 'Confidante', 'Dreamboat', 'Heartbeat', 'Cupid', 'Venus', 'Aphrodite', 'Princess',
  'Queen', 'Goddess', 'Duchess', 'Siren', 'Ballerina', 'Heiress', 'Empress', 'Belle', 'Girlie', 'Bestie', 'Beshie',
  'Poet', 'Wanderer', 'Dreamer', 'Daydreamer', 'Storyteller', 'Femme', 'Butch', 'Sapphic', 'Bebang', 'Ganda', 'Kilig',
  'Marupok', 'Witch', 'Wizard', 'Oracle', 'Enchantress', 'Sorceress', 'Alchemist', 'Moonchild', 'Stardancer', 'Rebel',
  'Troublemaker', 'Heartbreaker', 'HopelessRomantic', 'Firecracker', 'Wildling', 'Mermaid',
]);

/** Never used as a name, with any noun: it reads as a threat in a community space. Kept in the list so the vocabulary stays as supplied. */
const NEVER_PAIRED = new Set(['Stalking']);

/** Roots that make a pair say the same thing twice (Dreaming Daydream, Wandering Wanderer, Kissing Kiss). */
const SHARED_ROOTS = ['dream', 'wander', 'kiss', 'romanc', 'confess', 'flirt'];

const lower = (word: string) => word.toLowerCase();

function repeatsItself(first: string, second: string): boolean {
  const a = lower(first);
  const b = lower(second);
  if (a === b) return true;
  // One word inside the other (Starlit/Star, Daydreaming/Daydream) or the same first four letters (Moonlit/Moonbeam).
  if ((a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))) return true;
  if (a.slice(0, 4) === b.slice(0, 4)) return true;
  return SHARED_ROOTS.some((root) => a.includes(root) && b.includes(root));
}

/** Whether FirstSecond sounds natural, is fitting for a community space, and fits the display name limit. */
export function isNaturalPair(first: string, second: string): boolean {
  if (first.length + second.length > PSEUDONYM_MAX_LENGTH) return false;
  if (NEVER_PAIRED.has(first)) return false;
  if (repeatsItself(first, second)) return false;
  if (EDGY_FIRST.has(first) && TENDER_NOUNS.has(second)) return false;
  if (INTRUSIVE_FIRST.has(first) && (PERSON_NOUNS.has(second) || TENDER_NOUNS.has(second))) return false;
  return true;
}

// ---- Generator -----------------------------------------------------------------------------------------------------

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)];

/** One natural-sounding name. Re-draws until a pair passes the rules, which is almost always the first draw. */
export function generatePseudonym(random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = pick(PSEUDONYM_FIRST_WORDS, random);
    const second = pick(PSEUDONYM_SECOND_WORDS, random);
    if (isNaturalPair(first, second)) return `${first}${second}`;
  }
  // Unreachable with these lists (the tests walk every pair), but a name must always come back.
  return 'SoftMuse';
}

/** Several distinct candidates; the server keeps the first one nobody has taken. */
export function generatePseudonymCandidates(count: number, random: () => number = Math.random): string[] {
  const names = new Set<string>();
  for (let guard = 0; names.size < count && guard < count * 20; guard++) names.add(generatePseudonym(random));
  return [...names];
}

/** How many distinct names the rules allow (used by tests and the audit report). */
export function countNaturalPairs(): number {
  let total = 0;
  for (const first of PSEUDONYM_FIRST_WORDS) for (const second of PSEUDONYM_SECOND_WORDS) if (isNaturalPair(first, second)) total++;
  return total;
}
