/**
 * Two Truths and a Lie in Signals: what the app checks before sending a challenge, how a card from the server is read, and the
 * words shown for each state. The server (api/_game.js) checks all of it again and is the only place that knows the answer
 * before a guess; keep the limits here in step with it (a test checks that they agree).
 */

export const GAME_TEXT = '✨ Two Truths and a Lie';
export const STATEMENT_COUNT = 3;
export const STATEMENT_MAX = 140;
export const INTRO_MAX = 140;

export type ChallengeDraft = { statements: string[]; lie: number | null; intro: string };

/** A challenge as it is sent: statements tidied, the answer a whole number. */
export type Challenge = { statements: string[]; lie: number; intro: string };

/** A game card as the server returns it. `lie`, `guess` and `correct` exist only once the game is complete. */
export type GameCard = {
  statements: string[];
  intro: string;
  status: 'open' | 'complete';
  canGuess: boolean;
  guess?: number;
  lie?: number;
  correct?: boolean;
};

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const sameKey = (value: string) => clean(value).toLowerCase().replace(/[\s.!?,;:'"’“”…-]+$/g, '');

export type ChallengeProblem = {
  /** One message per statement (null when fine), in order. */
  statements: (string | null)[];
  lie: string | null;
  intro: string | null;
};

/** What is wrong with a draft, in words for the member, or null when it can be sent. */
export function challengeProblems(draft: ChallengeDraft): ChallengeProblem | null {
  const tidy = draft.statements.map(clean);
  const keys = tidy.map(sameKey);
  const statements = tidy.map((text, index) => {
    if (!text) return 'Write a statement.';
    if (text.length > STATEMENT_MAX) return `Keep it under ${STATEMENT_MAX} characters.`;
    if (keys.some((key, other) => other !== index && key === keys[index])) return 'Each statement needs to be different.';
    return null;
  });
  const lie = draft.lie === null || draft.lie < 0 || draft.lie >= STATEMENT_COUNT ? 'Choose which statement is the lie.' : null;
  const intro = clean(draft.intro).length > INTRO_MAX ? `Keep it under ${INTRO_MAX} characters.` : null;
  return statements.some(Boolean) || lie || intro ? { statements, lie, intro } : null;
}

/** The challenge to send, or null while the draft has a problem. */
export function toChallenge(draft: ChallengeDraft): Challenge | null {
  if (challengeProblems(draft) || draft.lie === null) return null;
  return { statements: draft.statements.map(clean), lie: draft.lie, intro: clean(draft.intro) };
}

const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < STATEMENT_COUNT;

/**
 * Reads a card from the server. Anything that is not a well-formed card gives null and the message is shown as plain text; the
 * answer is only taken from a card that is complete, and `correct` is worked out here from the two numbers, never trusted.
 */
export function parseGame(value: unknown): GameCard | null {
  const raw = value as Partial<GameCard> | null;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.statements) || raw.statements.length !== STATEMENT_COUNT
    || !raw.statements.every((s) => typeof s === 'string')) return null;
  const base = { statements: raw.statements as string[], intro: typeof raw.intro === 'string' ? raw.intro : '' };
  if (raw.status === 'complete' && isIndex(raw.guess) && isIndex(raw.lie)) {
    return { ...base, status: 'complete', canGuess: false, guess: raw.guess, lie: raw.lie, correct: raw.guess === raw.lie };
  }
  return { ...base, status: 'open', canGuess: raw.canGuess === true };
}

/** The result line shown to both members once a game is complete. */
export function resultLine(game: GameCard, viewerIsGuesser: boolean, partnerName: string): { title: string; detail: string } {
  const lieNumber = (game.lie ?? 0) + 1;
  if (viewerIsGuesser) {
    return game.correct
      ? { title: 'You got it right! ✨', detail: `Statement ${lieNumber} was the lie.` }
      : { title: `Not quite! The lie was Statement ${lieNumber}.`, detail: `You guessed Statement ${(game.guess ?? 0) + 1}.` };
  }
  return game.correct
    ? { title: `${partnerName} got it right! ✨`, detail: `Statement ${lieNumber} was the lie.` }
    : { title: `${partnerName} guessed Statement ${(game.guess ?? 0) + 1}.`, detail: `The lie was Statement ${lieNumber}.` };
}

/** Words for a problem the server reports while sending or guessing. */
export function gameProblemText(code: string | undefined): string | null {
  switch (code) {
    case 'invalid_game': return 'That challenge couldn’t be sent. Check the three statements and the lie.';
    case 'duplicate_statements': return 'Each statement needs to be different.';
    case 'invalid_guess': return 'That guess couldn’t be sent. Please try again.';
    case 'game_already_answered': return 'This game has already been answered.';
    case 'game_not_found': return 'This challenge could not be found.';
    default: return null;
  }
}
