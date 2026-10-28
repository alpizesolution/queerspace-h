import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFontSize, DEFAULT_FONT_SIZE, FONT_SIZE_KEY } from './fontSize.ts';
import { getStorageItem, setStorageItem } from './storage.ts';

test('font size defaults to Small when nothing valid is stored', () => {
  assert.equal(DEFAULT_FONT_SIZE, 'small');
  for (const bad of [null, undefined, '', 'huge', 'LARGE', 3, {}]) assert.equal(parseFontSize(bad), 'small');
});

test('valid sizes are kept', () => {
  for (const size of ['small', 'medium', 'large'] as const) assert.equal(parseFontSize(size), size);
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
