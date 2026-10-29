import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFontSize, DEFAULT_FONT_SIZE, FONT_SIZE_KEY } from './fontSize.ts';
import { getStorageItem, setStorageItem } from './storage.ts';

test('font size defaults to Small when nothing valid is stored', () => {
  assert.equal(DEFAULT_FONT_SIZE, 'small');
  for (const bad of [null, undefined, '', 'huge', 'LARGE', 3, {}]) assert.equal(parseFontSize(bad), 'small');
});

test('valid sizes are kept', () => {
  for (const size of ['tiny', 'small', 'medium', 'large'] as const) assert.equal(parseFontSize(size), size);
});

test('the chosen size survives a save and reload through app storage', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
  assert.equal(parseFontSize(getStorageItem(FONT_SIZE_KEY)), 'small', 'no preference yet');
  setStorageItem(FONT_SIZE_KEY, 'large');
  assert.equal(parseFontSize(getStorageItem(FONT_SIZE_KEY)), 'large');
  setStorageItem(FONT_SIZE_KEY, 'tampered');
  assert.equal(parseFontSize(getStorageItem(FONT_SIZE_KEY)), 'small');
});

import fs from 'node:fs';
import vm from 'node:vm';
import { resolveFontSize } from './fontSize.ts';

test('default size: Tiny on phones, Small on tablets and desktops', () => {
  assert.equal(resolveFontSize(null, false, true), 'tiny');
  assert.equal(resolveFontSize(null, false, false), 'small');
});

test('a size the person picked always wins, on any device', () => {
  for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
    assert.equal(resolveFontSize(size, true, true), size);
    assert.equal(resolveFontSize(size, true, false), size);
  }
});

test('earlier versions: a saved Small was automatic and follows the device; Tiny, Medium and Large were deliberate', () => {
  assert.equal(resolveFontSize('small', false, true), 'tiny');
  assert.equal(resolveFontSize('small', false, false), 'small');
  for (const size of ['tiny', 'medium', 'large'] as const) assert.equal(resolveFontSize(size, false, true), size);
});

test('corrupted values fall back to the device default', () => {
  for (const bad of ['huge', '', 3, {}, undefined]) {
    assert.equal(resolveFontSize(bad, true, true), 'tiny');
    assert.equal(resolveFontSize(bad, false, false), 'small');
  }
});

test('the first-paint script in index.html applies the same rule as resolveFontSize', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('queerspace_font_size'))!;
  assert.ok(script, 'inline script found');
  const values = [null, 'tiny', 'small', 'medium', 'large', 'huge'];
  for (const stored of values) for (const chosen of [false, true]) for (const phone of [false, true]) {
    const items: Record<string, string> = {};
    if (stored !== null) items.queerspace_font_size = stored;
    if (chosen) items.queerspace_font_size_chosen = '1';
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    vm.runInNewContext(script, {
      document,
      localStorage: { getItem: (k: string) => items[k] ?? null },
      matchMedia: () => ({ matches: phone }),
      screen: { width: phone ? 414 : 1280, height: phone ? 736 : 800 },
    });
    assert.equal(document.documentElement.dataset.fontsize, resolveFontSize(stored, chosen, phone), `${stored} chosen=${chosen} phone=${phone}`);
  }
});
