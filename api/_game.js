// Two Truths and a Lie for Signals: a private two-person challenge sent inside a conversation.
//
// Where things live (see api/signals.js):
//  - signalsPairs/{pairId}/messages/{id}            the visible card: the three statements, the optional note, and the status.
//                                                   It never holds the answer until the recipient has guessed.
//  - signalsPairs/{pairId}/gameSecrets/{id}          the answer (which statement is the lie) and who set it. Same id as the message.
//                                                   Clients have no access to it (Firestore rules deny it); only this server reads it.
//
// Keep the limits in step with src/utils/twoTruths.ts (a test checks that the two agree).
//
// Underscore-prefixed files in api/ are not deployed as separate functions.

export const GAME_TEXT = '✨ Two Truths and a Lie';
export const STATEMENT_COUNT = 3;
export const STATEMENT_MAX = 140;
export const INTRO_MAX = 140;

const clean = value => String(value).replace(/\s+/g, ' ').trim();
/** What "the same statement" means: ignoring case, spacing and surrounding punctuation. */
const sameKey = value => clean(value).toLowerCase().replace(/[\s.!?,;:'"’“”…-]+$/g, '');

/**
 * Checks a challenge from the app. Returns { ok: true, statements, lie, intro } with the text tidied, or { ok: false, error }.
 * Nothing about the answer is ever taken from anywhere but here: `lie` must be a whole number 0, 1 or 2.
 */
export function parseChallenge(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_game' };
  const { statements, lie, intro } = input;
  if (Object.keys(input).some(key => !['statements', 'lie', 'intro'].includes(key))) return { ok: false, error: 'invalid_game' };
  if (!Array.isArray(statements) || statements.length !== STATEMENT_COUNT || !statements.every(s => typeof s === 'string')) return { ok: false, error: 'invalid_game' };
  const tidy = statements.map(clean);
  if (tidy.some(s => !s || s.length > STATEMENT_MAX)) return { ok: false, error: 'invalid_game' };
  if (new Set(tidy.map(sameKey)).size !== STATEMENT_COUNT) return { ok: false, error: 'duplicate_statements' };
  if (!Number.isInteger(lie) || lie < 0 || lie >= STATEMENT_COUNT) return { ok: false, error: 'invalid_game' };
  if (intro !== undefined && intro !== null && typeof intro !== 'string') return { ok: false, error: 'invalid_game' };
  const note = typeof intro === 'string' ? clean(intro) : '';
  if (note.length > INTRO_MAX) return { ok: false, error: 'invalid_game' };
  return { ok: true, statements: tidy, lie, intro: note };
}

/** True for a guess the app may send: a whole number 0, 1 or 2. */
export const isGuess = value => Number.isInteger(value) && value >= 0 && value < STATEMENT_COUNT;

/**
 * The card as a member sees it. The answer (`lie`, `correct`) is included only once the game is complete, which only the
 * recipient's recorded guess can cause. `canGuess` is true for the recipient while the game is open, never for the sender.
 * A record that is not a well-formed game gives null, and the message is shown as plain text.
 */
export function shapeStoredGame(stored, viewerId, senderId) {
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.statements) || stored.statements.length !== STATEMENT_COUNT
    || !stored.statements.every(s => typeof s === 'string')) return null;
  const complete = stored.status === 'complete' && isGuess(stored.guess) && isGuess(stored.lie);
  return {
    statements: stored.statements,
    intro: typeof stored.intro === 'string' ? stored.intro : '',
    status: complete ? 'complete' : 'open',
    canGuess: !complete && viewerId !== senderId,
    ...(complete ? { guess: stored.guess, lie: stored.lie, correct: stored.guess === stored.lie } : {}),
  };
}
