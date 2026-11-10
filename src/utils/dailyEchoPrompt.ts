/**
 * Today's Echo: one optional writing prompt per day, the same for everyone.
 *
 * No database, no per-browser randomness. The prompt is a pure function of the calendar date in
 * Asia/Manila, so every member (and every deploy and refresh) agrees on it:
 *   - Days are counted from the Unix epoch in Manila time (UTC+8, which has no daylight saving).
 *   - Every 100 days is one cycle. Each cycle plays all 100 prompts once, in a shuffled order.
 *   - The shuffle is seeded by the cycle number, so the order is fixed in the code: "random", but
 *     never changing between deploys. A new cycle is therefore a fresh reshuffle.
 *   - The first prompt of a cycle is never the last prompt of the cycle before it.
 */

export const DAILY_ECHO_PROMPTS: readonly string[] = [
  // A. Self-Discovery
  "What's something about yourself that you're still learning to accept?",
  'When do you feel most like yourself?',
  'What\'s one thing you wish people understood about you?',
  'What version of yourself are you slowly becoming?',
  "What's something you used to be insecure about but now appreciate?",
  'What makes you feel genuinely confident?',
  "What's one thing you're proud of but rarely talk about?",
  'What do you wish you could tell your younger self?',
  "What's a part of your personality that you hope never changes?",
  'What does being comfortable in your own skin mean to you?',
  // B. Healing & Emotions
  "What's something you're still trying to make peace with?",
  'When was the last time you felt truly understood?',
  "What's one thing you're learning to let go of?",
  'What does healing look like for you right now?',
  "What's something you wish you could say without being afraid?",
  'What do you do when everything feels overwhelming?',
  "What's a pain you don't talk about often?",
  'What does emotional safety mean to you?',
  "What's something you forgive yourself for today?",
  'If your heart could speak right now, what would it say?',
  // C. Love & Relationships
  "What's your definition of a love that feels safe?",
  "What's the smallest gesture that makes you feel loved?",
  "What's something you've learned from a past relationship?",
  'Do you believe love should feel peaceful or exciting, or both?',
  "What's one green flag you will never overlook?",
  "What's something you wish people understood about the way you love?",
  'Have you ever met someone who felt like home?',
  "What's your favorite kind of affection?",
  'What does choosing someone every day mean to you?',
  "What's one thing you hope to experience in your next relationship?",
  // D. Sapphic & WLW Experiences
  "What's a sapphic experience you'll never forget?",
  'When did you first realize your feelings for another girl were different?',
  "What's something about being WLW that makes you feel seen?",
  "What's your favorite thing about sapphic love stories?",
  "Have you ever had a crush you couldn't tell anyone about?",
  "What's a small moment with a woman that you still remember?",
  'What does feeling accepted in the WLW community mean to you?',
  'What\'s one thing you wish every sapphic person could experience?',
  "What's your ideal low-key date with a woman?",
  "What's something you want more of in the sapphic community?",
  // E. Memories & Nostalgia
  "What's a memory that instantly makes you smile?",
  'If you could relive one ordinary day, which would it be?',
  "What's a song that reminds you of someone special?",
  'Who made a difference in your life without realizing it?',
  "What's a childhood memory you wish you could revisit?",
  "What's a goodbye that changed you?",
  "What's a moment you wish you had captured in a photograph?",
  "What's something you miss but wouldn't necessarily want back?",
  'What place will always feel like home to you?',
  "What's a memory that still gives you butterflies?",
  // F. Gratitude & Little Wins
  "What's one small thing that made your day better?",
  "What's something you're grateful for but often take for granted?",
  "What's a personal victory nobody else knows about?",
  "What's something you're looking forward to this week?",
  'Who made you feel appreciated recently?',
  "What's one thing your past self would be proud of today?",
  "What's a simple pleasure you never get tired of?",
  "What's something good that happened unexpectedly?",
  "What's one reason you're thankful you kept going?",
  'What deserves a little celebration in your life right now?',
  // G. Dreams & Future
  "If fear wasn't holding you back, what would you do?",
  "What's a dream you're not ready to give up on?",
  'Where do you imagine yourself five years from now?',
  "What's one experience you want to have at least once?",
  'What kind of life are you quietly working toward?',
  'If you could start over somewhere new, where would you go?',
  "What's something you hope your future partner gets to experience with you?",
  "What's one promise you want to make to your future self?",
  'What does your ideal peaceful life look like?',
  "What's a dream you've never told anyone about?",
  // H. Random Thoughts & Fun
  "What's a random thought that has been living in your head lately?",
  "What's your most oddly specific comfort?",
  'If today had a soundtrack, what song would be playing?',
  "What's something completely ordinary that makes you ridiculously happy?",
  "What's your most harmless unpopular opinion?",
  'If you could disappear for a weekend, where would you go?',
  "What's a fictional character you secretly relate to?",
  "What's one thing you could talk about for hours?",
  "What's your current little obsession?",
  'If your life were a movie, what would its title be?',
  // I. Connection & Community
  "What's something someone once said that you still carry with you?",
  "What's one thing you wish people asked you more often?",
  'When do you feel most connected to other people?',
  "What's your favorite way to comfort someone?",
  "What's something that instantly makes you trust a person?",
  "What's one kind thing you wish someone would tell you today?",
  "What's a conversation you've always wanted to have?",
  'What makes an online community feel like a safe space?',
  'What\'s one thing you want to remind someone who might be struggling?',
  'If someone feels alone today, what would you want them to know?',
  // J. Deep & Thought-Provoking
  'Do you think people meet for a reason, or do we give encounters meaning?',
  "What's something you've outgrown without realizing it?",
  "Can you miss someone and still know they aren't good for you?",
  "What's the difference between being alone and feeling lonely?",
  'What does happiness look like when nobody is watching?',
  "What's one truth about life you've learned the hard way?",
  'If you could ask the universe one question, what would it be?',
  'What does a meaningful life mean to you?',
  "What's something you hope never becomes ordinary?",
  'If you could leave one sentence for someone who needs it today, what would it say?',
];

export const DAILY_ECHO_TIME_ZONE = 'Asia/Manila';
const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000; // UTC+8 all year; the Philippines has no daylight saving.

/** Whole days since 1970-01-01 on the calendar in Manila at this moment. */
export function manilaDayNumber(at: Date | number = Date.now()): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  return Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS);
}

/** The Manila calendar date, as YYYY-MM-DD (handy for labels and tests). */
export function manilaDateKey(at: Date | number = Date.now()): string {
  return new Date(manilaDayNumber(at) * DAY_MS).toISOString().slice(0, 10);
}

/** A small, well-known seeded generator (mulberry32): same seed, same numbers, on every device. */
function seededRandom(seed: number): () => number {
  let a = (seed + 0x6d2b79f5) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The order the prompts play in for one cycle, before the boundary rule below is applied. */
function shuffledCycle(cycle: number): number[] {
  const order = DAILY_ECHO_PROMPTS.map((_, i) => i);
  const random = seededRandom(cycle * 7919 + 104729);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Indexes (into DAILY_ECHO_PROMPTS) in the order one cycle plays them. */
export function cycleOrder(cycle: number): number[] {
  const order = shuffledCycle(cycle);
  if (cycle > 0) {
    // The last prompt of a cycle is never moved by this rule, so the raw shuffle of the previous cycle is enough to know it.
    const previousLast = shuffledCycle(cycle - 1)[order.length - 1];
    if (order[0] === previousLast) [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

/** Today's prompt for a given Manila day number. */
export function dailyEchoPromptForDay(dayNumber: number): { index: number; text: string; cycle: number } {
  const n = DAILY_ECHO_PROMPTS.length;
  const day = Math.max(0, Math.floor(dayNumber));
  const cycle = Math.floor(day / n);
  const index = cycleOrder(cycle)[day % n];
  return { index, text: DAILY_ECHO_PROMPTS[index], cycle };
}

/** Today's prompt, the same for everyone, until midnight in Manila. */
export function dailyEchoPrompt(at: Date | number = Date.now()) {
  return dailyEchoPromptForDay(manilaDayNumber(at));
}
