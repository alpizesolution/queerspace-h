/**
 * The splash screen lives in index.html so it shows before any JavaScript runs.
 *
 * It is taken down when BOTH are true: it has been on screen for at least SPLASH_MIN_MS (measured from the moment it was drawn, not from
 * the start of the page load, so a slow network cannot shorten the brand moment), and the app says it is ready (see `ready`). If the app
 * is slower than the minimum the splash just stays up until it is ready; if it is faster, nothing extra is added after the minimum.
 * A ready signal that never arrives cannot trap anyone: after SPLASH_MAX_MS the splash goes regardless.
 */
export const SPLASH_MIN_MS = 3000;
export const SPLASH_MAX_MS = 12000;
export const FADE_MS = 450;
const PAINT_LAG_MS = 250;

interface HideOptions {
  /** The shortest time the splash stays up, counted from when it was drawn. */
  minMs?: number;
  /** The longest it waits for `ready`. */
  maxMs?: number;
  /** Settles when the app has restored what it needs to show the first screen. A rejection counts as ready. */
  ready?: Promise<unknown>;
}

/**
 * When the splash was first drawn, best source first:
 *  1. the start time of the splash logo's entrance animation, which starts on the first frame drawn (exact; absent when the visitor prefers
 *     reduced motion; if it has not started within 1.5 s, e.g. in a background tab, the time is counted from then);
 *  2. the browser's first-contentful-paint entry (exact, but some browsers report it a little late);
 *  3. failing both, the moment after the next two animation frames, by which time the first paint has happened.
 * (An inline script in index.html could record this too, but the site's Content-Security-Policy does not allow inline scripts.)
 */
function paintedAt(): Promise<number> {
  const animation = document.getElementById('splash')?.querySelector('.splash-logo')?.getAnimations?.()[0];
  if (animation) {
    // `ready` settles when the animation has really started, i.e. on the first frame it was drawn; its startTime is then that frame's time.
    // A frame's start time is when the browser began making it; it reaches the screen a little later, so add that lag.
    const drawn = animation.ready.then(() => (typeof animation.startTime === 'number' ? animation.startTime + PAINT_LAG_MS : performance.now()));
    const gaveUp = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), 1500));
    return Promise.race([drawn, gaveUp]);
  }
  const seen = typeof performance.getEntriesByName === 'function' ? performance.getEntriesByName('first-contentful-paint')[0] : undefined;
  if (seen) return Promise.resolve(seen.startTime);
  return new Promise((resolve) => {
    const settle = () => resolve(performance.now());
    if (typeof requestAnimationFrame !== 'function') return settle();
    requestAnimationFrame(() => requestAnimationFrame(settle));
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Fades the splash out and removes it once the minimum time has passed and the app is ready. Safe to call more than once (React Strict
 * Mode, a second caller): only the first call does anything, so there is one timer and one fade.
 */
export async function hideSplash({ minMs = SPLASH_MIN_MS, maxMs = SPLASH_MAX_MS, ready }: HideOptions = {}): Promise<void> {
  const el = document.getElementById('splash');
  if (!el || el.dataset.hiding) return;
  el.dataset.hiding = '1';
  const elapsed = performance.now() - (await paintedAt());
  await Promise.all([
    sleep(minMs - elapsed),
    Promise.race([Promise.resolve(ready).catch(() => undefined), sleep(maxMs - elapsed)]),
  ]);
  el.classList.add('splash-out');
  await sleep(FADE_MS);
  el.remove();
}
