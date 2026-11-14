/**
 * NSFW Cards for the Signals composer: a second deck beside the Comfort Cards, for adults who have chosen to see mature content.
 * The app sends only a card's id (api/_nsfwCards.js holds the same list, and a test checks that they are identical).
 *
 * Privacy: the question is never part of a message's text, a preview or a reply quote; those only ever say "Mature card". The words
 * come from this list, on the device, and are shown only when that member's own NSFW setting allows it (see NsfwCards.tsx).
 */

/** What a message, a preview and a reply quote say in place of the question. */
export const NSFW_CARD_TEXT = 'Mature card';

export const NSFW_CATEGORIES = [
  { id: 'flirty', label: 'Flirty', emoji: '💋', blurb: 'Attraction, flirting and chemistry' },
  { id: 'spicy', label: 'Spicy', emoji: '🔥', blurb: 'Mature and suggestive questions' },
  { id: 'intimate', label: 'Intimate', emoji: '🌙', blurb: 'Intimacy, desires and closeness' },
  { id: 'boundaries', label: 'Boundaries', emoji: '🖤', blurb: 'Consent, limits and personal preferences' },
] as const;

export type NsfwCategoryId = (typeof NSFW_CATEGORIES)[number]['id'];

export interface NsfwCard {
  id: string;
  category: NsfwCategoryId;
  question: string;
}

const QUESTIONS: Record<NsfwCategoryId, string[]> = {
  flirty: [
    'What is the first thing you notice when someone catches your eye?',
    'What kind of flirting makes you smile instead of cringe?',
    'Describe the perfect first-date spark in three words.',
    'What is the most charming thing someone has ever said to you?',
    'Do you prefer playful teasing or heartfelt compliments?',
    'What is your signature move when you like someone?',
    'What does great chemistry feel like to you?',
    'What is a small gesture that instantly makes your heart race?',
    'Would you rather flirt first, or be swept off your feet?',
    'What outfit makes you feel most irresistible?',
    'What song would be playing in your ideal flirty moment?',
    'What is the boldest thing you have done to show someone you were interested?',
  ],
  spicy: [
    'What kind of tension do you find the most exciting?',
    'What does a perfectly slow, teasing evening look like to you?',
    'What turns up the heat for you, besides touch?',
    'What is the most attractive thing someone could whisper to you?',
    'Do you prefer to take the lead, follow, or trade back and forth?',
    'What makes confidence so attractive?',
    'What setting do you find the most captivating, with the details kept to yourself?',
    'How do you feel about building anticipation for a long time?',
    'What is a kiss you still think about?',
    'What would you love to hear after a really good night?',
    'What is your favorite way to be teased, and where is your line?',
    'What do you find sexier than most people expect?',
  ],
  intimate: [
    'What makes you feel truly close to someone?',
    'What does being vulnerable with a partner look like for you?',
    'What kind of embrace makes you feel safest?',
    'What do you want more of in intimate moments?',
    'What is the most comforting kind of closeness after a long day?',
    'When do you feel most desired?',
    'What does emotional closeness add to physical closeness for you?',
    'What is a desire you have found hard to put into words?',
    'What helps you relax and be fully present with someone?',
    'What tender moment would you love to recreate?',
    'How do you like to reconnect after a distant week?',
    'What makes you feel wanted, not just attractive?',
  ],
  boundaries: [
    'How do you like someone to check in with you when things get closer?',
    'What is a boundary that helps you feel relaxed rather than restricted?',
    'What does enthusiastic consent look like to you?',
    'How do you like to say no, or not yet, without it feeling awkward?',
    'What pace feels right to you when getting to know someone?',
    'What do you need in order to feel safe before getting intimate?',
    'How would you like a partner to respond when you change your mind?',
    'Which topics are you comfortable talking about here, and which are off the table?',
    'What is a green flag you look for in how someone handles limits?',
    'How do you like to talk openly about protection and health?',
    'What helps you feel comfortable asking for what you want?',
    'What is a limit you have learned to protect, and how did you learn it?',
  ],
};

/** Every NSFW card, with a stable id such as "nsfw-flirty-01". */
export const NSFW_CARDS: readonly NsfwCard[] = NSFW_CATEGORIES.flatMap(({ id: category }) =>
  QUESTIONS[category].map((question, index) => ({ id: `nsfw-${category}-${String(index + 1).padStart(2, '0')}`, category, question }))
);

const BY_ID = new Map(NSFW_CARDS.map((card) => [card.id, card]));

export const nsfwCardById = (id: unknown): NsfwCard | null => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);

export const nsfwCardsInCategory = (category: NsfwCategoryId): NsfwCard[] => NSFW_CARDS.filter((c) => c.category === category);

export const nsfwCategoryLabel = (category: string): string => NSFW_CATEGORIES.find((c) => c.id === category)?.label ?? '';

/** A random NSFW card, avoiding `not` when there is more than one to choose from. `random` is injectable for tests. */
export function randomNsfwCard(options: { category?: NsfwCategoryId; not?: string; random?: () => number } = {}): NsfwCard {
  const pool = options.category ? nsfwCardsInCategory(options.category) : [...NSFW_CARDS];
  const choices = pool.length > 1 ? pool.filter((c) => c.id !== options.not) : pool;
  const random = options.random ?? Math.random;
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}

/** What a stored or received NSFW card is worth: only an id in the list counts. The question is NOT part of the result. */
export function parseNsfwCard(value: unknown): { id: string; category: NsfwCategoryId; deck: 'nsfw' } | null {
  const id = value && typeof value === 'object' ? (value as { id?: unknown }).id : undefined;
  const card = nsfwCardById(id);
  return card ? { id: card.id, category: card.category, deck: 'nsfw' } : null;
}

export const isNsfwCardId = (id: unknown): boolean => nsfwCardById(id) !== null;
