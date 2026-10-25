import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, isFirebaseConfigured, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import { UserPreferences } from '../types.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../utils/storage.ts';
import { formatSyncFeedback, StorageOperationResult } from '../utils/sync-feedback.ts';
import { isValidAvatar } from '../utils/avatar.ts';

export interface ProfileLoadResult {
  prefs: UserPreferences;
  source: 'cloud' | 'local';
  fromCloudSuccess: boolean;
}

/**
 * Normalizes and validates public profile fields to match strict Firestore security rules
 */
export function buildPublicProfilePayload(prefs: UserPreferences) {
  return {
    displayName: (prefs.displayName?.trim() || 'Anonymous WLW').slice(0, 30),
    pronouns: (prefs.pronouns?.trim() || 'she/her').slice(0, 20),
    intention: prefs.intention || 'open',
    region: prefs.region || 'Anywhere / Worldwide',
    topics: (prefs.topics || []).slice(0, 8),
    ...(isValidAvatar(prefs.avatar) ? { avatar: prefs.avatar } : {}),
    ...(typeof prefs.showGenderExpressionOnProfile === 'boolean'
      ? { showGenderExpressionOnProfile: prefs.showGenderExpressionOnProfile }
      : {}),
    ...(typeof prefs.showSogieOnProfile === 'boolean'
      ? { showSogieOnProfile: prefs.showSogieOnProfile }
      : {}),
    ...(typeof prefs.showLocationOnProfile === 'boolean'
      ? { showLocationOnProfile: prefs.showLocationOnProfile }
      : {}),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Normalizes private settings payload (SOGIE, exact location, filters, blocklist)
 */
export function buildPrivateSettingsPayload(prefs: UserPreferences, blockedPartnerIds: string[] = []) {
  return {
    exactLocation: prefs.locationSelection?.[0] || prefs.region || '',
    sexualOrientation: prefs.sexualOrientationCustom || prefs.sexualOrientation || '',
    genderExpression: prefs.genderExpression || [],
    preferredGenderExpressions: prefs.preferredGenderExpressions || [],
    blockedPartnerIds: blockedPartnerIds || [],
    updatedAt: serverTimestamp(),
  };
}

/**
 * Saves profile to local storage and attempts cloud save to Firestore under the authenticated UID
 */
export async function saveAnonymousProfile(
  prefs: UserPreferences,
  blockedPartnerIds: string[] = []
): Promise<StorageOperationResult> {
  let localSaved = false;
  try {
    setStorageItem(STORAGE_KEYS.USER_PREFS.current, JSON.stringify(prefs));
    setStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, JSON.stringify(blockedPartnerIds));
    localSaved = true;
  } catch (err) {
    localSaved = false;
  }

  const currentUser = auth?.currentUser;
  const canCloudSave = isFirebaseConfigured && Boolean(db) && Boolean(currentUser);

  if (!canCloudSave || !currentUser || !db) {
    return formatSyncFeedback('Profile', localSaved, false, false, null);
  }

  const uid = currentUser.uid; // Always use authenticated UID
  let cloudSuccess = false;
  let cloudErrorMsg: string | null = null;

  try {
    const publicRef = doc(db, 'users', uid, 'public', 'profile');
    const privateRef = doc(db, 'users', uid, 'private', 'settings');

    const publicPayload = buildPublicProfilePayload(prefs);
    const privatePayload = buildPrivateSettingsPayload(prefs, blockedPartnerIds);

    // Save public profile. createdAt is stamped once, so the admin page can chart new members.
    const existingPublicSnap = await getDoc(publicRef);
    const joined = existingPublicSnap.exists() && existingPublicSnap.data()?.createdAt;
    await setDoc(publicRef, joined ? publicPayload : { ...publicPayload, createdAt: serverTimestamp() }, { merge: true });

    // Check if private doc exists to safely set createdAt vs update
    const existingPrivateSnap = await getDoc(privateRef);
    if (!existingPrivateSnap.exists()) {
      await setDoc(privateRef, {
        ...privatePayload,
        createdAt: serverTimestamp(),
      });
    } else {
      await setDoc(privateRef, privatePayload, { merge: true });
    }

    cloudSuccess = true;
  } catch (err: unknown) {
    cloudSuccess = false;
    cloudErrorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[ProfilePersistence] Cloud save notice:', cloudErrorMsg);
  }

  return formatSyncFeedback('Profile', localSaved, true, cloudSuccess, cloudErrorMsg);
}

/**
 * Restores the user profile for the current anonymous session UID, falling back to local storage
 */
export async function loadAnonymousProfile(): Promise<ProfileLoadResult> {
  const localSavedPrefsStr = getStorageItem(STORAGE_KEYS.USER_PREFS.current, STORAGE_KEYS.USER_PREFS.legacies);
  let localPrefs: UserPreferences | null = null;
  if (localSavedPrefsStr) {
    try {
      localPrefs = JSON.parse(localSavedPrefsStr);
    } catch {
      localPrefs = null;
    }
  }

  const defaultLocal: UserPreferences = localPrefs || {
    displayName: 'Lavender Sapphire',
    pronouns: 'she/her',
    intention: 'open',
    topics: [],
    region: 'Anywhere / Worldwide',
  };

  const currentUser = auth?.currentUser;
  if (!isFirebaseConfigured || !db || !currentUser) {
    return {
      prefs: defaultLocal,
      source: 'local',
      fromCloudSuccess: false,
    };
  }

  try {
    const uid = currentUser.uid;
    const publicRef = doc(db, 'users', uid, 'public', 'profile');
    const privateRef = doc(db, 'users', uid, 'private', 'settings');

    const [publicSnap, privateSnap] = await Promise.all([
      getDoc(publicRef),
      getDoc(privateRef),
    ]);

    if (!publicSnap.exists() && !privateSnap.exists()) {
      return {
        prefs: defaultLocal,
        source: 'local',
        fromCloudSuccess: false,
      };
    }

    const publicData = publicSnap.exists() ? publicSnap.data() : {};
    const privateData = privateSnap.exists() ? privateSnap.data() : {};

    const restoredPrefs: UserPreferences = {
      displayName: publicData.displayName || defaultLocal.displayName,
      avatar: isValidAvatar(publicData.avatar) ? publicData.avatar : defaultLocal.avatar,
      pronouns: publicData.pronouns || defaultLocal.pronouns,
      intention: publicData.intention || defaultLocal.intention,
      region: publicData.region || defaultLocal.region,
      topics: Array.isArray(publicData.topics) ? publicData.topics : defaultLocal.topics,
      showGenderExpressionOnProfile: publicData.showGenderExpressionOnProfile,
      showSogieOnProfile: publicData.showSogieOnProfile,
      showLocationOnProfile: publicData.showLocationOnProfile,

      // Private settings
      sexualOrientation: privateData.sexualOrientation || defaultLocal.sexualOrientation,
      genderExpression: privateData.genderExpression || defaultLocal.genderExpression,
      preferredGenderExpressions: privateData.preferredGenderExpressions || defaultLocal.preferredGenderExpressions,
    };

    // Cache to local storage
    setStorageItem(STORAGE_KEYS.USER_PREFS.current, JSON.stringify(restoredPrefs));

    return {
      prefs: restoredPrefs,
      source: 'cloud',
      fromCloudSuccess: true,
    };
  } catch (err: unknown) {
    console.warn('[ProfilePersistence] Error loading cloud profile:', err);
    return {
      prefs: defaultLocal,
      source: 'local',
      fromCloudSuccess: false,
    };
  }
}
