import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The real Signals conversation against a stand-in server: the guess request, the answer arriving for the sender, the instant refresh
 * when the member's own inbox listener reports activity, and marking the guess read. Nothing here proves the server's rules (the
 * emulator tests do); it proves what the screen does with what the server says.
 */
let me = 'alice';
const chimes: string[] = [];
mock.module('../lib/firebase.ts', { namedExports: { auth: { get currentUser() { return { uid: me, getIdToken: async () => 'token' }; } }, db: null } });
mock.module('../utils/sound.ts', { namedExports: { soundEffects: { playMessageSent: () => chimes.push('sent'), playMessageReceived: () => chimes.push('received') } } });
const { SignalsConversation } = await import('./SignalsConversation.tsx');

type Call = { method: string; url: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let messages: Record<string, unknown>[] = [];
let guessResult: Record<string, unknown> | null = null;
let cursor = 0;

const open = { statements: ['I climbed a volcano', 'I own a snake', 'I can juggle'], intro: '', status: 'open' as const };
const game = (extra: Record<string, unknown> = {}) => ({ id: 'g1', senderId: 'alice', text: '✨ Two Truths and a Lie', kind: 'game', createdAt: '2026-01-01T10:00:00.000Z', replyTo: null, reactions: [], ...extra });

beforeEach(() => {
  calls = []; chimes.length = 0; cursor = 0; guessResult = null; me = 'alice';
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  (window as unknown as { matchMedia: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: String(url), body });
    const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
    if (body?.action === 'guess-game') return guessResult ? json(guessResult) : json({ error: 'game_already_answered' }, 409);
    if (body?.action === 'mark-read') return json({ unread: 0 });
    if (String(url).includes('view=messages')) return json({ messages, cursor: new Date(++cursor * 1000).toISOString() });
    return json({});
  }) as typeof fetch;
});
afterEach(cleanup);

const show = () => render(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} />);
const loads = () => calls.filter((c) => c.url.includes('view=messages'));
const marks = () => calls.filter((c) => c.body?.action === 'mark-read');
const guesses = () => calls.filter((c) => c.body?.action === 'guess-game');

test('the recipient guesses: one request with only the id and the chosen number, the answer then shows, and a second tap does nothing', async () => {
  me = 'bob';
  messages = [game({ game: { ...open, canGuess: true } })];
  guessResult = { ...game({ game: { ...open, status: 'complete', canGuess: false, guess: 0, lie: 1 } }) };
  show();
  await screen.findByTestId('two-truths-card');
  fireEvent.click(screen.getAllByRole('radio')[0]);
  const submit = screen.getByRole('button', { name: 'Submit Guess' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await screen.findByText('Not quite! The lie was Statement 2.');
  assert.equal(guesses().length, 1, 'one guess request, not two');
  assert.deepEqual(guesses()[0].body, { action: 'guess-game', pairId: 'pair-12345678', messageId: 'g1', guess: 0 });
  assert.equal(screen.queryByRole('button', { name: 'Submit Guess' }), null, 'locked once answered');
});

test('a guess the server says was already answered refreshes the card from the server instead of failing', async () => {
  me = 'bob';
  messages = [game({ game: { ...open, canGuess: true } })];
  guessResult = null; // the server answers 409 game_already_answered
  show();
  await screen.findByTestId('two-truths-card');
  const before = loads().length;
  fireEvent.click(screen.getAllByRole('radio')[2]);
  fireEvent.click(screen.getByRole('button', { name: 'Submit Guess' }));
  await screen.findByText('This game has already been answered.');
  await waitFor(() => assert.ok(loads().length > before, 'it read the conversation again'));
});

test('the sender: a guess that arrives shows the result on the same card (no second card), chimes once, and is marked read', async () => {
  messages = [game({ game: { ...open, canGuess: false } })];
  show();
  await screen.findByText('Waiting for Luna to guess…');
  assert.equal(marks().length, 0, 'nothing to mark read before a guess');
  messages = [game({ game: { ...open, status: 'complete', canGuess: false, guess: 2, lie: 1 } })];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
  await screen.findByText('Luna guessed Statement 3.');
  assert.equal(screen.getAllByTestId('two-truths-card').length, 1);
  assert.deepEqual(chimes.filter((c) => c === 'received'), ['received']);
  await waitFor(() => assert.equal(marks().length, 1));
  assert.equal(marks()[0].body?.throughMessageId, 'g1', 'marked through the newest message even though Luna never wrote');
});

test('a game that was already answered when the conversation opened is silent and not re-announced', async () => {
  messages = [game({ game: { ...open, status: 'complete', canGuess: false, guess: 1, lie: 1 } })];
  show();
  await screen.findByText('Luna got it right! ✨', {}, { timeout: 5000 });
  assert.deepEqual(chimes, []);
});

test('activity from the other member reported by the inbox listener reads the conversation at once, once per change', async () => {
  messages = [game({ game: { ...open, canGuess: false } })];
  const view = show();
  await screen.findByTestId('two-truths-card');
  const before = loads().length;
  messages = [game({ game: { ...open, status: 'complete', canGuess: false, guess: 0, lie: 0 } })];
  view.rerender(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} liveAt={1000} />);
  await screen.findByText('Luna got it right! ✨');
  assert.equal(loads().length, before + 1, 'one extra read, no waiting for the four-second poll');
  assert.match(loads().at(-1)!.url, /after=/, 'a small update read, not the whole history');
  view.rerender(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} liveAt={1000} />);
  assert.equal(loads().length, before + 1, 'the same value again reads nothing');
  assert.equal(screen.getAllByTestId('two-truths-card').length, 1);
});

test('the inbox listener is not used when the latest line is the member’s own (null)', async () => {
  messages = [game({ game: { ...open, canGuess: false } })];
  const view = show();
  await screen.findByTestId('two-truths-card');
  const before = loads().length;
  view.rerender(<SignalsConversation pairId="pair-12345678" partner={{ displayName: 'Luna', avatar: null }} onBack={() => {}} liveAt={null} />);
  await act(async () => { await Promise.resolve(); });
  assert.equal(loads().length, before);
});
