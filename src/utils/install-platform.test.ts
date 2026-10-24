import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallPlatform } from './install-platform.ts';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  facebook:
    'Mozilla/5.0 (Linux; Android 14; SM-A146P Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0;]',
  instagramIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

const base = { standalone: false, hasPrompt: false };

test('installed app never shows the card', () => {
  assert.equal(detectInstallPlatform(UA.androidChrome, { standalone: true, hasPrompt: true }), 'installed');
});

test('iPhone and iPad get Share → Add to Home Screen steps', () => {
  assert.equal(detectInstallPlatform(UA.iphoneSafari, base), 'ios-safari');
  assert.equal(detectInstallPlatform(UA.iphoneChrome, base), 'ios-other');
  assert.equal(detectInstallPlatform(UA.ipad, { ...base, maxTouchPoints: 5 }), 'ios-safari');
  assert.equal(detectInstallPlatform(UA.ipad, { ...base, maxTouchPoints: 0 }), 'none');
});

test('in-app browsers are told to open a real browser, even if a prompt exists', () => {
  assert.equal(detectInstallPlatform(UA.facebook, { ...base, hasPrompt: true }), 'in-app');
  assert.equal(detectInstallPlatform(UA.instagramIOS, base), 'in-app');
});

test('Chromium waits for the install prompt; Firefox Android uses the menu', () => {
  assert.equal(detectInstallPlatform(UA.androidChrome, base), 'none');
  assert.equal(detectInstallPlatform(UA.androidChrome, { ...base, hasPrompt: true }), 'prompt');
  assert.equal(detectInstallPlatform(UA.desktopChrome, { ...base, hasPrompt: true }), 'prompt');
  assert.equal(detectInstallPlatform(UA.androidFirefox, base), 'android-other');
});
