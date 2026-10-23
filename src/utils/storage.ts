/**
 * Backward-compatible storage utility for QUEERSPACE
 * Migrates data seamlessly from previous versions (hiraya_* and vespera_*)
 */

export const STORAGE_KEYS = {
  BLOCKED_IDS: {
    current: 'queerspace_blocked_ids',
    legacies: ['hiraya_blocked_ids', 'vespera_blocked_ids'],
    legacy: 'hiraya_blocked_ids',
  },
  SOUND_MUTED: {
    current: 'queerspace_sound_muted',
    legacies: ['hiraya_sound_muted', 'vespera_sound_muted'],
    legacy: 'hiraya_sound_muted',
  },
  USER_PREFS: {
    current: 'queerspace_user_prefs',
    legacies: ['hiraya_user_prefs', 'vespera_user_prefs'],
    legacy: 'hiraya_user_prefs',
  },
  REPORTS: {
    current: 'queerspace_moderation_reports',
    legacies: ['hiraya_moderation_reports', 'vespera_moderation_reports'],
    legacy: 'hiraya_moderation_reports',
  },
  PUBLIC_ROOM: {
    current: 'queerspace_public_room_messages',
    legacies: ['hiraya_public_room_messages', 'vespera_public_room_messages'],
    legacy: 'hiraya_public_room_messages',
  },
  COMMUNITY_POSTS: {
    current: 'queerspace_community_posts',
    legacies: ['hiraya_community_posts', 'vespera_community_posts'],
    legacy: 'hiraya_community_posts',
  },
} as const;

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

export function getStorageItem(
  currentKey: string,
  legacyKeys?: string | readonly string[]
): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const val = storage.getItem(currentKey);
    if (val !== null) return val;

    if (legacyKeys) {
      const keys = Array.isArray(legacyKeys) ? legacyKeys : [legacyKeys];
      for (const legacyKey of keys) {
        const legacyVal = storage.getItem(legacyKey);
        if (legacyVal !== null) {
          // Transparent backward-compatible migration
          try {
            storage.setItem(currentKey, legacyVal);
          } catch {
            // Ignore quota/storage errors
          }
          return legacyVal;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function setStorageItem(currentKey: string, value: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(currentKey, value);
  } catch {
    // Ignore quota/storage errors
  }
}

