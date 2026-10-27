import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth, isFirebaseConfigured, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import { UserPreferences } from '../types.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../utils/storage.ts';
import { formatSyncFeedback, StorageOperationResult } from '../utils/sync-feedback.ts';
import { isValidAvatar } from '../utils/avatar.ts';
import { INTENTION_LABELS, SEXUAL_ORIENTATIONS } from '../utils/matching-logic.ts';

export interface ProfileLoadResult {
  prefs: UserPreferences;
  source: 'cloud' | 'local';
  fromCloudSuccess: boolean;
  /** Blocked IDs saved in the cloud (merge with this device's list; never shrink it). */
  blockedPartnerIds?: string[];
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
    aboutMe: (prefs.aboutMe || '').trim().slice(0, 160),
    myVibe: (prefs.myVibe || '').slice(0, 24),
    profileComplete: prefs.profileComplete === true,
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
    // One field in the rules: a listed option, or the person's own words when self-described.
    sexualOrientation:
      prefs.sexualOrientation === 'Self-described' ? prefs.sexualOrientationCustom?.trim() || '' : prefs.sexualOrientation || '',
    genderExpression: prefs.genderExpression || [],
    preferredGenderExpressions: prefs.preferredGenderExpressions || [],
    ...(prefs.birthDate ? { birthDate: Timestamp.fromDate(new Date(`${prefs.birthDate}T00:00:00.000Z`)) } : {}),
    blockedPartnerIds: blockedPartnerIds || [],
    updatedAt: serverTimestamp(),
  };
}

/**
 * The cloud-stored content of a save, without timestamps. Equal signatures mean a cloud write
 * would change nothing, so it can be skipped (no reads, no writes).
 */
export function cloudProfileSignature(prefs: UserPreferences, blockedPartnerIds: string[] = []): string {
  const { updatedAt: _p, ...pub } = buildPublicProfilePayload(prefs);
  const { updatedAt: _s, ...priv } = buildPrivateSettingsPayload(prefs, blockedPartnerIds);
  return JSON.stringify([pub, priv]);
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/**
 * Layers what the cloud holds over this device's copy. Only fields the cloud actually stores (and
 * that are valid) replace local values; everything else, like age and filter switches that the
 * rules don't let us store yet, is kept from the device instead of being reset.
 */
export function mergeCloudProfile(
  local: UserPreferences,
  publicData: Record<string, unknown>,
  privateData: Record<string, unknown>
): UserPreferences {
  const merged: UserPreferences = { ...local };
  const set = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K] | undefined) => {
    if (value !== undefined) merged[key] = value;
  };

  set('displayName', text(publicData.displayName));
  set('avatar', isValidAvatar(publicData.avatar) ? publicData.avatar : undefined);
  set('pronouns', text(publicData.pronouns));
  const intention = text(publicData.intention);
  if (intention && intention in INTENTION_LABELS) merged.intention = intention as UserPreferences['intention'];
  set('region', text(publicData.region));
  set('topics', strings(publicData.topics));
  set('aboutMe', typeof publicData.aboutMe === 'string' ? publicData.aboutMe.slice(0, 160) : undefined);
  set('myVibe', text(publicData.myVibe));
  set('profileComplete', flag(publicData.profileComplete));
  set('showGenderExpressionOnProfile', flag(publicData.showGenderExpressionOnProfile));
  set('showSogieOnProfile', flag(publicData.showSogieOnProfile));
  set('showLocationOnProfile', flag(publicData.showLocationOnProfile));

  const orientation = text(privateData.sexualOrientation);
  if (orientation) {
    if (SEXUAL_ORIENTATIONS.includes(orientation) && orientation !== 'Self-described') {
      merged.sexualOrientation = orientation;
      merged.sexualOrientationCustom = undefined;
    } else {
      merged.sexualOrientation = 'Self-described';
      merged.sexualOrientationCustom = orientation === 'Self-described' ? local.sexualOrientationCustom : orientation;
    }
  }
  const expression = strings(privateData.genderExpression);
  if (expression?.length) merged.genderExpression = expression as UserPreferences['genderExpression'];
  const preferred = strings(privateData.preferredGenderExpressions);
  if (preferred) merged.preferredGenderExpressions = preferred;
  const birthDate = privateData.birthDate;
  if (birthDate instanceof Timestamp) merged.birthDate = birthDate.toDate().toISOString().slice(0, 10);
  const area = text(privateData.exactLocation);
  if (area && !local.locationSelection?.length) merged.locationSelection = [area];

  return merged;
}

/**
 * Saves profile to local storage and attempts cloud save to Firestore under the authenticated UID
 */
export async function saveAnonymousProfile(
  prefs: UserPreferences,
  blockedPartnerIds: string[] = [],
  /** false: save on this device only (nothing the cloud stores has changed). */
  cloud = true
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

  if (!cloud || !canCloudSave || !currentUser || !db) {
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

    const restoredPrefs = mergeCloudProfile(defaultLocal, publicData, privateData);

    // Cache to local storage
    setStorageItem(STORAGE_KEYS.USER_PREFS.current, JSON.stringify(restoredPrefs));

    return {
      prefs: restoredPrefs,
      source: 'cloud',
      fromCloudSuccess: true,
      blockedPartnerIds: strings(privateData.blockedPartnerIds) ?? [],
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
