// Comfort Cards for Signals: a curated list of conversation starters. The app only ever sends a card's id; the question text comes
// from this list on the server, so nobody can send a card with words of their own. Keep the list in step with
// src/utils/comfortCards.ts (a test checks that the two are identical).
//
// Underscore-prefixed files in api/ are not deployed as separate functions.

export const CARD_CATEGORIES = [
  { id: 'soft', label: 'Soft & Sweet' },
  { id: 'know', label: 'Get to Know Me' },
  { id: 'deep', label: 'Deep Talks' },
  { id: 'love', label: 'Love & Sapphic' },
  { id: 'fun', label: 'Random & Fun' },
  { id: 'comfort', label: 'Comfort Corner' },
];

const SOFT = [
  'What is something small that made you smile today?',
  'What is your favorite way to spend a slow, cozy evening?',
  'What song makes you feel instantly warm?',
  'What is a comfort food that feels like a hug?',
  'What is the nicest compliment you have ever received?',
  'What does your perfect lazy Sunday look like?',
  'Which little everyday thing are you most grateful for lately?',
  'What is a scent that takes you somewhere happy?',
  'If you could send a warm hug to anyone right now, who would it be?',
  'What is your favorite kind of weather, and why?',
  'What small ritual makes your mornings better?',
  'What is something kind someone did for you that you still remember?',
];

const KNOW = [
  'What are three things you could talk about for hours?',
  'What is something you are really proud of that you rarely mention?',
  'What do people usually get wrong about you at first?',
  'What is a skill you would love to learn this year?',
  'Are you a morning person, a night owl, or somewhere in between?',
  'What was your favorite thing to do as a kid?',
  'What is a hobby that makes you lose track of time?',
  'Which book, show or game do you recommend to everyone?',
  'What is a place you would love to visit one day?',
  'What does a really good day look like for you?',
  'What is something on your bucket list?',
  'What are you looking forward to right now?',
];

const DEEP = [
  'What is something you have outgrown that you are glad to leave behind?',
  'When do you feel most like yourself?',
  'What is something you are still learning to accept about yourself?',
  'What is a lesson that took you a long time to learn?',
  'What does feeling safe with someone mean to you?',
  'What is a fear you have faced, even a little?',
  'What would you tell your younger self if you could?',
  'What does home mean to you?',
  'What is something you wish more people asked you about?',
  'How have you changed in the last few years?',
  'What makes a friendship feel real to you?',
  'What is one thing you hope never changes about you?',
];

const LOVE = [
  'What does a love that feels safe and calm look like to you?',
  'What is your idea of a perfect low-key date?',
  'What is a green flag you always look for?',
  'What is the smallest gesture that makes you feel cared for?',
  'What do you love most about sapphic stories, songs or films?',
  'How do you like to show someone you care?',
  'What is your love language, and how did you find out?',
  'What is something you want more of in your relationships?',
  'What is a sweet memory of connecting with another woman?',
  'What makes a connection feel like it could grow into something?',
  'What does being seen and accepted by someone mean to you?',
  'What is your favorite thing about the sapphic community?',
];

const FUN = [
  'If your life had a theme song, what would it be?',
  'What is your most harmless unpopular opinion?',
  'Which fictional character do you secretly relate to?',
  'If you could have any superpower for a day, what would you pick?',
  'What is the most oddly specific thing that comforts you?',
  'What is your go-to karaoke song?',
  'Would you rather live by the sea or in the mountains?',
  'What is your current little obsession?',
  'What would your dream pet be called?',
  'If you opened a cafe, what would it be called and what would be on the menu?',
  'What is the best piece of random advice you have ever got?',
  'If you could instantly master one thing, what would it be?',
];

const COMFORT = [
  'What do you do when everything feels like too much?',
  'What is one thing that always helps you feel calmer?',
  'What is something you are working through right now, if you want to share?',
  'What would feel like a kind thing to hear today?',
  'What is one thing you are proud of yourself for this week?',
  'Who or what makes you feel less alone?',
  'What is a gentle thing you can do for yourself today?',
  'What helps you through a tough day?',
  'What is something you need less of in your life right now?',
  'What is one small win you could celebrate today?',
  'What is something you forgive yourself for?',
  'What would you like someone to remind you of right now?',
];

const BY_CATEGORY = { soft: SOFT, know: KNOW, deep: DEEP, love: LOVE, fun: FUN, comfort: COMFORT };

/** Every card: a stable id such as "soft-01", its category and its question. Ids never change once published. */
export const COMFORT_CARDS = CARD_CATEGORIES.flatMap(({ id: category }) =>
  BY_CATEGORY[category].map((question, index) => ({ id: `${category}-${String(index + 1).padStart(2, '0')}`, category, question }))
);

const BY_ID = new Map(COMFORT_CARDS.map(card => [card.id, card]));

/** True for an id in the list. Anything else (including non-strings) is refused before it reaches the database. */
export const isCardId = value => typeof value === 'string' && BY_ID.has(value);

export const cardById = id => (isCardId(id) ? BY_ID.get(id) : null);

/**
 * Reads a stored message's card back into the shape the app renders. Only the id is trusted: the category and question always
 * come from this list, so a bad record in the database cannot show words that were never approved.
 */
export function shapeStoredCard(stored) {
  const card = cardById(stored?.id);
  return card ? { id: card.id, category: card.category, question: card.question } : null;
}
