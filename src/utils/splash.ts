/**
 * The splash screen lives in index.html so it shows before any JavaScript runs.
 * It stays up at least SPLASH_MIN_MS from page start (so the brand registers instead of
 * flashing), then fades out once the app has rendered. A slow load just keeps it up longer.
 */
export const SPLASH_MIN_MS = 1500;
const FADE_MS = 450;

export function hideSplash(minMs = SPLASH_MIN_MS): void {
  const el = document.getElementById('splash');
  if (!el) return;
  const wait = Math.max(0, minMs - performance.now());
  window.setTimeout(() => {
    el.classList.add('splash-out');
    window.setTimeout(() => el.remove(), FADE_MS);
  }, wait);
}
