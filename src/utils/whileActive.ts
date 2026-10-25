/**
 * Keeps a live Firestore listener open only while someone is actually around.
 *
 * A listener left running in a forgotten background tab keeps paying a read for every new
 * document. `whileActive` closes it after IDLE_AFTER_MS with the tab hidden or no input,
 * and reopens it on the next tap, key, scroll or return to the tab (reopening re-reads the
 * query once, so screens catch up on whatever they missed).
 */
export const IDLE_AFTER_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'focus', 'visibilitychange'] as const;

export interface ActivityEnv {
  now: () => number;
  isHidden: () => boolean;
  every: (fn: () => void, ms: number) => () => void;
  onActivity: (fn: () => void) => () => void;
}

const browserEnv = (): ActivityEnv => ({
  now: () => Date.now(),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  every: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  onActivity: (fn) => {
    if (typeof window === 'undefined') return () => {};
    const opts = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, fn, opts));
    return () => ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, fn, opts));
  },
});

/** Starts `open` now and pauses/resumes it with activity. Returns a cleanup for useEffect. */
export function whileActive(
  open: () => () => void,
  idleAfterMs: number = IDLE_AFTER_MS,
  env: ActivityEnv = browserEnv()
): () => void {
  let close: (() => void) | null = open();
  let lastActive = env.now();

  const pause = () => {
    close?.();
    close = null;
  };

  const stopChecking = env.every(() => {
    if (close && env.now() - lastActive >= idleAfterMs) pause();
  }, Math.min(CHECK_EVERY_MS, idleAfterMs));

  const stopWatching = env.onActivity(() => {
    // Hiding the tab is not activity; coming back to it is.
    if (env.isHidden()) return;
    lastActive = env.now();
    if (!close) close = open();
  });

  return () => {
    stopChecking();
    stopWatching();
    pause();
  };
}
