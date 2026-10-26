/**
 * Typing indicator logic, kept free of Firebase so it can be unit tested.
 *
 * Cost model: the sender writes only when typing starts, when it ends, and at most once per
 * `refreshMs` while someone keeps typing. The watcher never reads the database; it only turns
 * the status the chat already listens to into a visible/hidden flag, with a local expiry.
 */

export const TYPING_IDLE_MS = 2000;
/** While typing continues, re-stamp at most this often, so the reader's expiry doesn't lapse. */
export const TYPING_REFRESH_MS = 5000;
/** How long the reader trusts a stamp. Must exceed TYPING_REFRESH_MS. */
export const TYPING_TTL_MS = 7000;

export interface TypingSender {
  /** Call on every input change. Writes only on a state change or a refresh. */
  input: (hasText: boolean) => void;
  /** Typing ended (idle, left the field, tab hidden): writes the clear if one is owed. */
  stop: () => void;
  /** The state is being cleared by something else (a sent message): forget it without writing. */
  reset: () => void;
  isActive: () => boolean;
}

export function createTypingSender(send: (typing: boolean) => void): TypingSender {
  let active = false;
  let lastStamp = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };

  const stop = () => {
    clearIdle();
    if (!active) return;
    active = false;
    send(false);
  };

  return {
    input(hasText) {
      if (!hasText) {
        stop();
        return;
      }
      const now = Date.now();
      if (!active) {
        active = true;
        lastStamp = now;
        send(true);
      } else if (now - lastStamp >= TYPING_REFRESH_MS) {
        lastStamp = now;
        send(true);
      }
      clearIdle();
      idle = setTimeout(stop, TYPING_IDLE_MS);
    },
    stop,
    reset() {
      clearIdle();
      active = false;
    },
    isActive: () => active,
  };
}

export interface TypingWatcher {
  /** Feed the partner's latest stamp (ms since epoch), or null when none. */
  update: (stampMs: number | null) => void;
  dispose: () => void;
}

export function createTypingWatcher(onChange: (typing: boolean) => void): TypingWatcher {
  let lastSeen: number | null | undefined;
  let visible = false;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  const set = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onChange(next);
  };
  const clearExpiry = () => {
    if (expiry) clearTimeout(expiry);
    expiry = null;
  };

  return {
    update(stampMs) {
      if (stampMs === null) {
        lastSeen = null;
        clearExpiry();
        set(false);
        return;
      }
      if (stampMs === lastSeen) return; // an unrelated change to the conversation doc
      const first = lastSeen === undefined;
      lastSeen = stampMs;
      // A stamp that was already old when we joined (left behind by a closed tab) isn't typing now.
      if (first && Date.now() - stampMs > TYPING_TTL_MS) return;
      clearExpiry();
      set(true);
      expiry = setTimeout(() => set(false), TYPING_TTL_MS);
    },
    dispose() {
      clearExpiry();
      visible = false;
    },
  };
}
