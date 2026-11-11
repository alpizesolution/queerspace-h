import '../../test/dom-setup.ts';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FADE_MS, SPLASH_MAX_MS, SPLASH_MIN_MS, hideSplash } from './splash.ts';

/**
 * hideSplash with a fake clock: `performance.now()` and every timer are driven by the same fake time, and the splash is
 * "painted" at t = 0 (a first-contentful-paint entry is faked).
 */
let t = 0;
beforeEach(() => {
  t = 0;
  mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(performance, 'now', () => t);
  mock.method(performance, 'getEntriesByName', () => [{ startTime: 0 }]);
  document.body.innerHTML = '<div id="splash"></div>';
});
afterEach(() => { mock.timers.reset(); mock.restoreAll(); document.body.innerHTML = ''; });

const tick = async (ms: number) => { t += ms; mock.timers.tick(ms); for (let i = 0; i < 10; i++) await Promise.resolve(); };
const el = () => document.getElementById('splash');
const state = () => (!el() ? 'removed' : el()!.classList.contains('splash-out') ? 'fading' : 'up');

test('the minimum is three seconds', () => assert.equal(SPLASH_MIN_MS, 3000));

test('fast start: the app is ready at once, the splash still stays up for the full 3 seconds, then fades and goes', async () => {
  void hideSplash({ ready: Promise.resolve() });
  await tick(0);
  assert.equal(state(), 'up');
  await tick(2999);
  assert.equal(state(), 'up', 'still up at 2999 ms');
  await tick(1);
  assert.equal(state(), 'fading', 'fades at exactly 3000 ms, no extra delay');
  await tick(FADE_MS);
  assert.equal(state(), 'removed');
});

test('slow start (e.g. restoring a sign-in): the splash waits for the app, then leaves with no further delay', async () => {
  let ready!: () => void;
  void hideSplash({ ready: new Promise<void>((resolve) => { ready = resolve; }) });
  await tick(3000);
  assert.equal(state(), 'up', 'minimum passed but the app is not ready');
  await tick(4000);
  assert.equal(state(), 'up');
  ready();
  await tick(0);
  assert.equal(state(), 'fading', 'leaves the moment the app is ready');
});

test('a sign-in check that fails still lets the splash go (signed-out visitor, error)', async () => {
  void hideSplash({ ready: Promise.reject(new Error('auth failed')) });
  await tick(0);
  await tick(3000);
  assert.equal(state(), 'fading');
});

test('a ready signal that never comes cannot trap the visitor: the splash goes at the maximum', async () => {
  void hideSplash({ ready: new Promise(() => {}) });
  await tick(0);
  await tick(SPLASH_MAX_MS - 1);
  assert.equal(state(), 'up');
  await tick(1);
  assert.equal(state(), 'fading');
});

test('time already spent counts: a splash drawn 1.2 s before the app starts waits only the remaining 1.8 s', async () => {
  mock.method(performance, 'getEntriesByName', () => [{ startTime: 0 }]);
  t = 1200;
  void hideSplash({ ready: Promise.resolve() });
  await tick(0);
  await tick(1799);
  assert.equal(state(), 'up');
  await tick(1);
  assert.equal(state(), 'fading');
});

test('called twice (Strict Mode, a second caller): one timer and one fade, never a second pass', async () => {
  void hideSplash({ ready: Promise.resolve() });
  void hideSplash({ ready: Promise.resolve() });
  await tick(0);
  assert.equal(el()!.dataset.hiding, '1');
  await tick(3000);
  await tick(FADE_MS);
  assert.equal(state(), 'removed');
});

test('the admin page skips the brand moment (minMs 0) once its first frame is drawn', async () => {
  void hideSplash({ minMs: 0, ready: Promise.resolve() });
  await tick(0);
  await tick(0);
  assert.equal(state(), 'fading');
});

test('no splash in the page (a second call after it is gone) does nothing', async () => {
  document.body.innerHTML = '';
  await hideSplash({ ready: Promise.resolve() });
});

// ---- the markup and wiring
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync('src/main.tsx', 'utf8').replace(/\r\n/g, '\n');

test('the one splash lives in index.html, and main.tsx waits for Firebase auth restoration and the first frame', () => {
  assert.equal((html.match(/id="splash"/g) || []).length, 1, 'a single splash element');
  assert.match(main, /auth\.authStateReady\(\)/);
  assert.match(main, /ready: Promise\.all\(\[authRestored, firstFrame\]\)/);
  assert.equal((main.match(/hideSplash\(/g) || []).length, 1, 'called once at startup, never from a screen change');
});

test('the splash keeps within the device safe areas, cannot scroll, and scales with the screen', () => {
  const css = html.slice(html.indexOf('#splash {'), html.indexOf('</style>', html.indexOf('#splash {')));
  assert.match(css, /padding: env\(safe-area-inset-top\) env\(safe-area-inset-right\) env\(safe-area-inset-bottom\) env\(safe-area-inset-left\)/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /html:has\(#splash\), body:has\(#splash\) \{ overflow: hidden; \}/);
  assert.match(css, /width: clamp\(72px, 16vmin, 112px\)/);
  assert.match(css, /@media \(max-height: 360px\)/, 'a short landscape phone');
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('the site policy blocks inline scripts, so the splash start is read from the browser, not an inline script', () => {
  assert.doesNotMatch(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ''), /__splashStart/);
});
