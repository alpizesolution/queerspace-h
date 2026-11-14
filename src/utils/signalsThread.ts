/**
 * Pure helpers for the Signals conversation: merging what the server sends, showing messages that are still being
 * sent, and reacting before the server has answered. Kept free of React and the network so they can be tested.
 */

import { parseGifInfo, type GifInfo } from './gif.ts';
import { cardById, parseCard } from './comfortCards.ts';
import { NSFW_CARD_TEXT, nsfwCardById, parseNsfwCard } from './nsfwCards.ts';
import type { PhotoInfo } from './timedPhoto.ts';
import { GAME_TEXT, parseGame, type Challenge, type GameCard } from './twoTruths.ts';

export type Reaction = { emoji: string; count: number; userReacted: boolean };

export type ThreadMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  replyTo?: { messageId: string; senderId: string; text: string } | null;
  reactions?: Reaction[];
  /** A timed photo: its timer and state. The picture itself is never part of the thread. */
  kind?: 'photo' | 'gif' | 'card' | 'game';
  photo?: PhotoInfo;
  /** A Comfort Card: only its id and category; the question is always read from the approved list in the app. */
  card?: { id: string; category: string; /** Set for an NSFW Card: its words are never in `text`. */ deck?: 'nsfw' };
  /** A GIPHY GIF: the approved addresses and size. Sent by id; the server supplies the rest. */
  gif?: GifInfo;
  /** A Two Truths and a Lie challenge. The answer is part of it only once the recipient has guessed. */
  game?: GameCard;
};

export type PendingStatus = 'sending' | 'failed';

/** A message the member has written that the server has not confirmed yet. Its id is what the server will store. */
export type PendingMessage = {
  id: string;
  text: string;
  /** Set for a GIF: it is sent by this GIF's id and shown as the GIF while it sends. */
  gif?: GifInfo;
  /** Set for a Comfort Card: it is sent by this card's id alone and shown as the card while it sends. */
  cardId?: string;
  /** Set for a Two Truths and a Lie challenge being sent: the statements and the sender's own answer. */
  challenge?: Challenge;
  replyTo: { messageId: string; text: string; sender: 'self' | 'partner'; senderId: string } | null;
  status: PendingStatus;
  /** Why it failed, in words for the member. */
  error?: string;
  /** False when retrying cannot help (the connection ended, you can no longer message them). */
  retryable: boolean;
  createdAt: number;
};

export type ShownMessage = ThreadMessage & { pending?: PendingMessage };

const timeOf = (m: { createdAt: string | null }) => (m.createdAt ? Date.parse(m.createdAt) : Number.POSITIVE_INFINITY);

/**
 * A GIF message is shown only if its picture addresses are approved GIPHY ones. Otherwise it is treated as plain text
 * ("GIF"), so a wrong record can never make the app load another site's image.
 */
export function checkedGif(message: ThreadMessage): ThreadMessage {
  if (message.kind !== 'gif') return message;
  const gif = parseGifInfo(message.gif);
  if (gif) return { ...message, gif };
  const { kind: _kind, gif: _gif, ...rest } = message;
  return rest;
}

/**
 * A Comfort Card message is shown as a card only if its id is on the approved list; then its words come from that list. A record
 * that fails the check is shown as ordinary text, so a wrong record can never put unapproved words in a card.
 */
export function checkedCard(message: ThreadMessage): ThreadMessage {
  if (message.kind !== 'card') return message;
  // An NSFW Card keeps the neutral line as its text (so a reply quote or a preview never carries the question); the card itself
  // shows the words only when the member's own setting allows it.
  const mature = parseNsfwCard(message.card);
  if (mature) return { ...message, text: NSFW_CARD_TEXT, card: { id: mature.id, category: mature.category, deck: 'nsfw' } };
  const card = parseCard(message.card);
  if (card) return { ...message, text: card.question, card: { id: card.id, category: card.category } };
  const { kind: _kind, card: _card, ...rest } = message;
  return rest;
}

/**
 * A game message is shown as a game only if it is a well-formed card; otherwise it is plain text. The card is re-read here so an answer
 * is only ever shown from a game that is complete.
 */
export function checkedGame(message: ThreadMessage): ThreadMessage {
  if (message.kind !== 'game') return message;
  const game = parseGame(message.game);
  if (game) return { ...message, text: GAME_TEXT, game };
  const { kind: _kind, game: _game, ...rest } = message;
  return rest;
}

/**
 * Folds messages from the server into the list: a message already shown is replaced in place (a reaction changed),
 * a new one is placed by its time. Nothing is ever dropped, so a slow or out-of-order poll cannot remove a message.
 */
export function mergeMessages(current: ThreadMessage[], received: ThreadMessage[]): ThreadMessage[] {
  if (!received.length) return current;
  const incoming = received.map((m) => checkedGame(checkedCard(checkedGif(m))));
  const next = current.slice();
  const index = new Map(next.map((m, i) => [m.id, i]));
  let changed = false;
  for (const message of incoming) {
    const at = index.get(message.id);
    if (at !== undefined) {
      next[at] = message;
    } else {
      let position = next.length;
      while (position > 0 && timeOf(next[position - 1]) > timeOf(message)) position -= 1;
      next.splice(position, 0, message);
      index.clear();
      next.forEach((m, i) => index.set(m.id, i));
    }
    changed = true;
  }
  return changed ? next : current;
}

/** What the thread shows: the server's messages, then any still-pending ones that have not come back from the server. */
export function visibleThread(server: ThreadMessage[], pending: PendingMessage[], selfId: string): ShownMessage[] {
  const confirmed = new Set(server.map((m) => m.id));
  const waiting: ShownMessage[] = pending
    .filter((p) => !confirmed.has(p.id))
    .map((p) => ({
      id: p.id,
      senderId: selfId,
      text: p.text,
      ...(p.gif ? { kind: 'gif' as const, gif: p.gif } : {}),
      ...(p.challenge ? { kind: 'game' as const, game: { statements: p.challenge.statements, intro: p.challenge.intro, status: 'open' as const, canGuess: false } } : {}),
      ...(p.cardId && cardById(p.cardId) ? { kind: 'card' as const, card: { id: p.cardId, category: cardById(p.cardId)!.category } } : {}),
      ...(p.cardId && nsfwCardById(p.cardId) ? { kind: 'card' as const, text: NSFW_CARD_TEXT, card: { id: p.cardId, category: nsfwCardById(p.cardId)!.category, deck: 'nsfw' as const } } : {}),
      createdAt: new Date(p.createdAt).toISOString(),
      replyTo: p.replyTo ? { messageId: p.replyTo.messageId, senderId: p.replyTo.senderId, text: p.replyTo.text } : null,
      reactions: [],
      pending: p,
    }));
  return [...server, ...waiting];
}

/**
 * One reaction per member per message, the same rule the server applies: the same emoji again removes it,
 * another emoji replaces it. Used to show the change instantly while the server confirms.
 */
export function applyMyReaction(reactions: Reaction[] | undefined, emoji: string): Reaction[] {
  const list = reactions ?? [];
  const mine = list.find((r) => r.userReacted)?.emoji ?? null;
  const without = list
    .map((r) => (r.userReacted ? { ...r, count: r.count - 1, userReacted: false } : r))
    .filter((r) => r.count > 0);
  if (mine === emoji) return without;
  const existing = without.find((r) => r.emoji === emoji);
  return existing
    ? without.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, userReacted: true } : r))
    : [...without, { emoji, count: 1, userReacted: true }];
}

/** How many messages a conversation loads at a time: the newest page on opening, then one older page each time the reader scrolls up. */
export const MESSAGE_PAGE_SIZE = 50;

/** A continuation position ("seconds.nanos.id") from a catch-up that was cut at its page size, as opposed to an ISO time. */
export const isPositionCursor = (value: string): boolean => /^\d+\.\d+\./.test(value);

/**
 * The cursor to keep after a poll. Ordinary cursors are ISO times and only ever move forward. A continuation position always
 * replaces the cursor it continues, and an ordinary cursor replaces a position (it comes from a later, finished catch-up). A
 * response that arrives late can at worst make the next poll repeat messages, which the thread merges by id; it can never skip any.
 */
export function newerCursor(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  if (isPositionCursor(next) || isPositionCursor(current)) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

/** Words for a failed send. Network trouble and slow answers can be retried; the others cannot. */
export function describeSendFailure(error: unknown): { message: string; retryable: boolean } {
  const text = error instanceof Error ? error.message : '';
  const lower = text.toLowerCase();
  if (lower.includes('ended')) return { message: 'This connection has ended.', retryable: false };
  if (lower.includes('no longer message')) return { message: text, retryable: false };
  if (lower.includes('no longer available')) return { message: text, retryable: false };
  if (lower.includes('temporarily unavailable for this account')) return { message: text, retryable: false };
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { message: 'This is taking too long. Check your connection and try again.', retryable: true };
  }
  if (error instanceof TypeError || lower.includes('failed to fetch') || lower.includes('network')) {
    return { message: 'No connection. Your message is saved here, tap Retry when you’re back online.', retryable: true };
  }
  return { message: text || 'Message could not be sent.', retryable: true };
}
