// NSFW Cards for Signals: a second, separate deck next to the Comfort Cards (api/_cards.js), for adults who have chosen to see mature
// content. They travel exactly like Comfort Cards: the app sends only a card's id, the wording lives with the app's own list (and
// this one), and a message stores only `{ kind: 'card', card: { id } }`.
//
// One difference matters for privacy: the question is NEVER put in a message's `text`, in the inbox preview or anywhere else the
// server hands out. Whether a member may see mature content is a setting on their own device, which the server cannot read, so the
// server only ever sends the neutral line below and the card's id. The app puts the question on screen only when that member's own
// setting allows it.
//
// Keep the list in step with src/utils/nsfwCards.ts (a test checks that the two are identical).
// Underscore-prefixed files in api/ are not deployed as separate functions.

/** What every message, preview and quote says in place of the question. */
export const NSFW_CARD_TEXT = 'Mature card';

export const NSFW_CATEGORIES = [
  { id: 'flirty', label: 'Flirty' },
  { id: 'spicy', label: 'Spicy' },
  { id: 'intimate', label: 'Intimate' },
  { id: 'boundaries', label: 'Boundaries' },
];

const FLIRTY = [
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
];

const SPICY = [
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
];

const INTIMATE = [
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
];

const BOUNDARIES = [
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
];

const BY_CATEGORY = { flirty: FLIRTY, spicy: SPICY, intimate: INTIMATE, boundaries: BOUNDARIES };

/** Every NSFW card: a stable id such as "nsfw-flirty-01", its category and its question. Ids never change once published. */
export const NSFW_CARDS = NSFW_CATEGORIES.flatMap(({ id: category }) =>
  BY_CATEGORY[category].map((question, index) => ({ id: `nsfw-${category}-${String(index + 1).padStart(2, '0')}`, category, question }))
);

const BY_ID = new Map(NSFW_CARDS.map(card => [card.id, card]));

/** True for an id in this deck. Anything else (including non-strings) is refused. */
export const isNsfwCardId = value => typeof value === 'string' && BY_ID.has(value);

export const nsfwCardById = id => (isNsfwCardId(id) ? BY_ID.get(id) : null);

/**
 * Reads a stored message's card back, for a viewer. Only the id is trusted, and the question is deliberately NOT included: the
 * category comes from this list and the app supplies the words itself, when the member's own setting allows it.
 */
export function shapeStoredNsfwCard(stored) {
  const card = nsfwCardById(stored?.id);
  return card ? { id: card.id, category: card.category, deck: 'nsfw' } : null;
}
