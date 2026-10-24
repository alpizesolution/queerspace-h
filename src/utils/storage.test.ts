import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from './storage.ts';

function createMockStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    storage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      length: Object.keys(store).length,
    } as unknown as Storage,
  };
}

test('getStorageItem reads current key when present', () => {
  const { store, storage } = createMockStorage({
    [STORAGE_KEYS.SOUND_MUTED.current]: 'true',
  });
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;

  const result = getStorageItem(STORAGE_KEYS.SOUND_MUTED.current, STORAGE_KEYS.SOUND_MUTED.legacies);
  assert.equal(result, 'true');
});

test('getStorageItem migrates hiraya legacy key when current key is missing', () => {
  const { store, storage } = createMockStorage({
    ['hiraya_user_prefs']: JSON.stringify({ displayName: 'Maya Lark' }),
  });
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;

  const result = getStorageItem(STORAGE_KEYS.USER_PREFS.current, STORAGE_KEYS.USER_PREFS.legacies);
  assert.equal(result, JSON.stringify({ displayName: 'Maya Lark' }));
  // Transparently copied over to current queerspace key
  assert.equal(store[STORAGE_KEYS.USER_PREFS.current], JSON.stringify({ displayName: 'Maya Lark' }));
});

test('getStorageItem migrates vespera legacy key when current and hiraya keys are missing', () => {
  const { store, storage } = createMockStorage({
    ['vespera_user_prefs']: JSON.stringify({ displayName: 'Elena Rose' }),
  });
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;

  const result = getStorageItem(STORAGE_KEYS.USER_PREFS.current, STORAGE_KEYS.USER_PREFS.legacies);
  assert.equal(result, JSON.stringify({ displayName: 'Elena Rose' }));
  // Transparently copied over to current queerspace key
  assert.equal(store[STORAGE_KEYS.USER_PREFS.current], JSON.stringify({ displayName: 'Elena Rose' }));
});

test('setStorageItem updates the current key', () => {
  const { store, storage } = createMockStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;

  setStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, JSON.stringify(['id-1', 'id-2']));
  assert.equal(store[STORAGE_KEYS.BLOCKED_IDS.current], JSON.stringify(['id-1', 'id-2']));
});
