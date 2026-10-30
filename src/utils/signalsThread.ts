/**
 * Pure helpers for the Signals conversation: merging what the server sends, showing messages that are still being
 * sent, and reacting before the server has answered. Kept free of React and the network so they can be tested.
 */

export type Reaction = { emoji: string; count: number; userReacted: boolean };

export type ThreadMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string | null;
  replyTo?: { messageId: string; senderId: string; text: string } | null;
  reactions?: Reaction[];
};

export type PendingStatus = 'sending' | 'failed';

/** A message the member has written that the server has not confirmed yet. Its id is what the server will store. */
export type PendingMessage = {
  id: string;
  text: string;
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
 * Folds messages from the server into the list: a message already shown is replaced in place (a reaction changed),
 * a new one is placed by its time. Nothing is ever dropped, so a slow or out-of-order poll cannot remove a message.
 */
export function mergeMessages(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  if (!incoming.length) return current;
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

/** The newer of two cursors (ISO strings); null counts as "nothing yet". */
export function newerCursor(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

/** Words for a failed send. Network trouble and slow answers can be retried; the others cannot. */
export function describeSendFailure(error: unknown): { message: string; retryable: boolean } {
  const text = error instanceof Error ? error.message : '';
  const lower = text.toLowerCase();
  if (lower.includes('ended')) return { message: 'This connection has ended.', retryable: false };
  if (lower.includes('no longer message')) return { message: text, retryable: false };
  if (lower.includes('temporarily unavailable for this account')) return { message: text, retryable: false };
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { message: 'This is taking too long. Check your connection and try again.', retryable: true };
  }
  if (error instanceof TypeError || lower.includes('failed to fetch') || lower.includes('network')) {
    return { message: 'No connection. Your message is saved here, tap Retry when you’re back online.', retryable: true };
  }
  return { message: text || 'Message could not be sent.', retryable: true };
}
