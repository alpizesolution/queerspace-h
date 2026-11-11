import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GAME_TEXT, INTRO_MAX, STATEMENT_MAX, challengeProblems, gameProblemText, parseGame, resultLine, toChallenge, type GameCard } from './twoTruths.ts';
import { checkedGame, mergeMessages, visibleThread, type ThreadMessage } from './signalsThread.ts';
import * as server from '../../api/_game.js';

const ok = { statements: ['I climbed a volcano', 'I own a snake', 'I can juggle'], lie: 1, intro: '' };

test('a valid challenge can be sent, with the text tidied', () => {
  assert.equal(challengeProblems(ok), null);
  assert.deepEqual(toChallenge({ ...ok, statements: ['  I  climbed a volcano ', 'I own a snake', 'I can juggle'], intro: '  Try   me ' }), { statements: ['I climbed a volcano', 'I own a snake', 'I can juggle'], lie: 1, intro: 'Try me' });
});

test('empty, blank, over-long and duplicate statements are refused, each with its own message', () => {
  assert.ok(challengeProblems({ ...ok, statements: ['', 'b', 'c'] })?.statements[0]);
  assert.ok(challengeProblems({ ...ok, statements: ['a', '   ', 'c'] })?.statements[1]);
  assert.ok(challengeProblems({ ...ok, statements: ['a', 'b', 'x'.repeat(STATEMENT_MAX + 1)] })?.statements[2]);
  const dup = challengeProblems({ ...ok, statements: ['I love cats', 'i LOVE cats!', 'other'] });
  assert.ok(dup?.statements[0] && dup.statements[1] && !dup.statements[2], 'both copies are flagged, ignoring case and end punctuation');
  assert.equal(toChallenge({ ...ok, statements: ['same', 'same', 'other'] }), null);
});

test('exactly one answer must be chosen', () => {
  assert.ok(challengeProblems({ ...ok, lie: null })?.lie);
  assert.ok(challengeProblems({ ...ok, lie: 3 })?.lie);
  assert.equal(toChallenge({ ...ok, lie: null }), null);
  for (const lie of [0, 1, 2]) assert.equal(challengeProblems({ ...ok, lie }), null);
});

test('the note is optional and limited', () => {
  assert.equal(challengeProblems({ ...ok, intro: '' }), null);
  assert.ok(challengeProblems({ ...ok, intro: 'x'.repeat(INTRO_MAX + 1) })?.intro);
});

test('the app and the server agree on the limits, the title and what is refused', () => {
  assert.equal(GAME_TEXT, server.GAME_TEXT);
  assert.equal(STATEMENT_MAX, server.STATEMENT_MAX);
  assert.equal(INTRO_MAX, server.INTRO_MAX);
  const cases: [Parameters<typeof challengeProblems>[0], boolean][] = [
    [ok, true],
    [{ ...ok, statements: ['', 'b', 'c'] }, false],
    [{ ...ok, statements: ['a', 'A.', 'c'] }, false],
    [{ ...ok, statements: ['a', 'b', 'x'.repeat(STATEMENT_MAX)] }, true],
    [{ ...ok, statements: ['a', 'b', 'x'.repeat(STATEMENT_MAX + 1)] }, false],
    [{ ...ok, lie: null }, false],
    [{ ...ok, intro: 'x'.repeat(INTRO_MAX) }, true],
    [{ ...ok, intro: 'x'.repeat(INTRO_MAX + 1) }, false],
  ];
  for (const [draft, valid] of cases) {
    const there = server.parseChallenge({ statements: draft.statements, lie: draft.lie, intro: draft.intro });
    assert.equal(toChallenge(draft) !== null, valid, JSON.stringify(draft));
    assert.equal(there.ok, valid, `server: ${JSON.stringify(draft)}`);
  }
});

test('the server never gives an answer for a game that is not complete, and only completes from a recorded guess', () => {
  const open = { statements: ['a', 'b', 'c'], intro: '', status: 'open', lie: 1, guess: 1 };
  assert.deepEqual(server.shapeStoredGame(open, 'bob', 'alice'), { statements: ['a', 'b', 'c'], intro: '', status: 'open', canGuess: true });
  assert.equal(server.shapeStoredGame(open, 'alice', 'alice')?.canGuess, false, 'the sender never gets a guess');
  const done = server.shapeStoredGame({ ...open, status: 'complete', guess: 0, lie: 1 }, 'alice', 'alice');
  assert.deepEqual(done, { statements: ['a', 'b', 'c'], intro: '', status: 'complete', canGuess: false, guess: 0, lie: 1, correct: false });
  assert.equal(server.shapeStoredGame({ statements: ['a'], status: 'open' }, 'bob', 'alice'), null);
  assert.equal(server.shapeStoredGame({ ...open, status: 'complete', guess: 7 }, 'bob', 'alice')?.status, 'open', 'a half-written completion is not a result');
});

test('the app reads a card defensively: no answer unless complete, and "correct" is worked out, not trusted', () => {
  const open = parseGame({ statements: ['a', 'b', 'c'], intro: 'hi', status: 'open', canGuess: true, lie: 2, guess: 2, correct: true });
  assert.deepEqual(open, { statements: ['a', 'b', 'c'], intro: 'hi', status: 'open', canGuess: true });
  const done = parseGame({ statements: ['a', 'b', 'c'], status: 'complete', guess: 0, lie: 2, correct: true, canGuess: true });
  assert.deepEqual(done, { statements: ['a', 'b', 'c'], intro: '', status: 'complete', canGuess: false, guess: 0, lie: 2, correct: false });
  for (const bad of [null, 'x', {}, { statements: ['a', 'b'] }, { statements: ['a', 'b', 3] }]) assert.equal(parseGame(bad), null);
});

test('the result words: right or wrong, for the one who guessed and for the one who set it', () => {
  const right = parseGame({ statements: ['a', 'b', 'c'], status: 'complete', guess: 1, lie: 1 }) as GameCard;
  const wrong = parseGame({ statements: ['a', 'b', 'c'], status: 'complete', guess: 0, lie: 1 }) as GameCard;
  assert.equal(resultLine(right, true, 'Luna').title, 'You got it right! ✨');
  assert.equal(resultLine(wrong, true, 'Luna').title, 'Not quite! The lie was Statement 2.');
  assert.match(resultLine(right, false, 'Luna').title, /Luna got it right/);
  assert.match(resultLine(wrong, false, 'Luna').detail, /The lie was Statement 2/);
});

test('problems from the server have words, and unknown ones fall through to the general message', () => {
  assert.ok(gameProblemText('invalid_game') && gameProblemText('duplicate_statements') && gameProblemText('invalid_guess') && gameProblemText('game_already_answered'));
  assert.equal(gameProblemText('something_else'), null);
});

// ---- the conversation thread: real-time updates, reopening, duplicates, several games
const card = (id: string, extra: Partial<ThreadMessage> = {}, game: unknown = { statements: ['a', 'b', 'c'], intro: '', status: 'open', canGuess: true }): ThreadMessage =>
  ({ id, senderId: 'alice', text: GAME_TEXT, createdAt: `2026-01-01T10:0${id.length}:00.000Z`, kind: 'game', game: game as never, reactions: [], ...extra });

test('a poll that brings the answer replaces the card in place: no second card, and the reactions and neighbours are untouched', () => {
  const open = card('g1');
  const hello: ThreadMessage = { id: 'm0', senderId: 'bob', text: 'hi', createdAt: '2026-01-01T09:00:00.000Z', reactions: [{ emoji: '💜', count: 1, userReacted: true }] };
  const start = mergeMessages([], [hello, open]);
  const after = mergeMessages(start, [card('g1', {}, { statements: ['a', 'b', 'c'], intro: '', status: 'complete', canGuess: false, guess: 0, lie: 1, correct: false })]);
  assert.equal(after.length, 2);
  assert.equal(after[1].game?.status, 'complete');
  assert.equal(after[1].game?.lie, 1);
  assert.deepEqual(after[0], hello);
  // The same poll arriving twice (a refresh, a reconnect) changes nothing.
  assert.equal(mergeMessages(after, [after[1]]).length, 2);
});

test('reopening restores each game from the server, and several games keep their own state', () => {
  const thread = mergeMessages([], [
    card('g1', {}, { statements: ['a', 'b', 'c'], status: 'complete', guess: 2, lie: 2 }),
    card('gg2', {}, { statements: ['d', 'e', 'f'], status: 'open', canGuess: true, lie: 0 }),
    card('ggg3', { senderId: 'bob' }, { statements: ['g', 'h', 'i'], status: 'open', canGuess: false }),
  ]);
  assert.deepEqual(thread.map((m) => m.game?.status), ['complete', 'open', 'open']);
  assert.equal(thread[0].game?.correct, true);
  assert.equal(thread[1].game?.lie, undefined, 'an open game never carries an answer, even if the server wrongly sent one');
});

test('a badly formed game is shown as plain text, never as a card', () => {
  const shown = checkedGame({ id: 'x', senderId: 'a', text: 'whatever', createdAt: null, kind: 'game', game: { statements: ['only one'] } as never });
  assert.equal(shown.kind, undefined);
  assert.equal(shown.game, undefined);
});

test('a challenge being sent shows as an open card for its sender, and disappears from the pending list when the server confirms it', () => {
  const pending = { id: 'p1', text: GAME_TEXT, challenge: { statements: ['a', 'b', 'c'], lie: 2, intro: '' }, replyTo: null, status: 'sending' as const, retryable: true, createdAt: Date.parse('2026-01-01T10:00:00Z') };
  const mine = visibleThread([], [pending], 'alice');
  assert.equal(mine[0].kind, 'game');
  assert.equal(mine[0].game?.canGuess, false);
  assert.equal(JSON.stringify(mine[0].game).includes('"lie"'), false, 'the card never shows the answer while open');
  const confirmed = visibleThread([card('p1', { senderId: 'alice' }, { statements: ['a', 'b', 'c'], status: 'open', canGuess: false })], [pending], 'alice');
  assert.equal(confirmed.length, 1, 'one card, not a card and its pending copy');
});
