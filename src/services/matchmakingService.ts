import { collectionGroup, getDocs, limit, query } from 'firebase/firestore';
import { db, auth, isFirebaseConfigured } from '../lib/firebase.ts';
import { PartnerProfile, UserPreferences } from '../types.ts';
import { calculateCompatibilityScore, generateSapphicPseudonym } from '../utils/matching-logic.ts';
import { findBestPartner, MOCK_PARTNERS } from '../utils/mock-partners.ts';
import { isLocationCompatible } from '../utils/philippines-locations.ts';

export interface MatchCandidateResult {
  candidate: PartnerProfile;
  source: 'cloud' | 'local_fallback' | 'dynamic_fallback';
  compatibilityScore: number;
  totalCandidatesQueried: number;
  message: string;
}

/**
 * Fetches real public profiles from Firestore and ranks them according to user preferences.
 * Falls back seamlessly to local mock profiles if unconfigured, offline, or empty.
 */
export function sanitizeCandidatePrivacy(candidate: PartnerProfile): PartnerProfile {
  return {
    ...candidate,
    showSogieOnProfile: false,
    sexualOrientation: undefined,
    genderIdentity: undefined,
  };
}

export async function findMatchCandidate(
  userPrefs: UserPreferences,
  excludeIds: string[] = []
): Promise<MatchCandidateResult> {
  const currentUser = auth?.currentUser;
  const canCloudMatch = isFirebaseConfigured && Boolean(db) && Boolean(currentUser);

  // If Firebase is unavailable or unconfigured, execute Local Demo Mode matching
  if (!canCloudMatch || !db || !currentUser) {
    const mockCandidate = sanitizeCandidatePrivacy(findBestPartner(userPrefs, excludeIds));
    const score = calculateCompatibilityScore(userPrefs, mockCandidate);
    return {
      candidate: mockCandidate,
      source: 'local_fallback',
      compatibilityScore: score,
      totalCandidatesQueried: MOCK_PARTNERS.length,
      message: 'Matched via Local Demo Mode (Cloud Sync Unconfigured/Offline).',
    };
  }


  try {
    const currentUid = currentUser.uid;
    // Combine current user UID and explicitly blocked/active IDs into exclusion set
    const allExcludedIds = new Set([currentUid, ...excludeIds]);

    // Query public profiles from Firestore collectionGroup
    // Security Rule: match /users/{userId}/public/profile { allow read: if isAuthenticated(); }
    const profilesQuery = query(collectionGroup(db, 'profile'), limit(50));
    const querySnapshot = await getDocs(profilesQuery);

    const candidatesFromCloud: PartnerProfile[] = [];

    querySnapshot.forEach((docSnap) => {
      // Document path format: users/{userId}/public/profile
      // Parent parent doc ID is the user UID
      const userId = docSnap.ref.parent.parent?.id || docSnap.id;

      // Filter out self and explicitly excluded/blocked partner IDs
      if (allExcludedIds.has(userId)) return;

      const data = docSnap.data();

      // Ensure required public profile fields are present and profile is not hidden
      if (!data.displayName || !data.pronouns || !data.intention || !data.region) return;
      if (data.isProfileHidden === true || data.optOutOfDiscovery === true) return;

      const candidateProfile: PartnerProfile = {
        id: userId,
        displayName: String(data.displayName).slice(0, 30),
        pronouns: String(data.pronouns).slice(0, 20),
        intention: data.intention,
        topics: Array.isArray(data.topics) ? data.topics : [],
        region: String(data.region),
        location: String(data.region),
        avatarColor: '#8D426B', // default sapphic palette accent
        bioSnippet: `Sapphic community member in ${data.region}`,
        showGenderExpressionOnProfile: Boolean(data.showGenderExpressionOnProfile),
        showSogieOnProfile: false, // Never expose private SOGIE
        showLocationOnProfile: Boolean(data.showLocationOnProfile),
      };

      candidatesFromCloud.push(candidateProfile);
    });

    // If cloud contains candidate profiles, filter and rank them
    if (candidatesFromCloud.length > 0) {
      let filteredPool = candidatesFromCloud;

      // Apply location filter if explicitly enabled
      if (
        userPrefs.applyLocationFilter &&
        userPrefs.locationSelection &&
        userPrefs.locationSelection.length > 0 &&
        !userPrefs.locationSelection.includes('Anywhere in the Philippines')
      ) {
        const locationMatches = candidatesFromCloud.filter((c) =>
          isLocationCompatible(userPrefs.locationSelection, c.region || c.location)
        );
        if (locationMatches.length > 0) {
          filteredPool = locationMatches;
        }
      }

      // Rank by compatibility score
      const scored = filteredPool.map((candidate) => ({
        candidate,
        score: calculateCompatibilityScore(userPrefs, candidate),
      }));

      scored.sort((a, b) => b.score - a.score);

      const topChoice = scored[0];
      return {
        candidate: topChoice.candidate,
        source: 'cloud',
        compatibilityScore: topChoice.score,
        totalCandidatesQueried: candidatesFromCloud.length,
        message: `Matched with ${topChoice.candidate.displayName} from Cloud Firestore.`,
      };
    }

    // If Firestore has 0 eligible candidates (e.g. database empty or all excluded)
    const mockCandidate = sanitizeCandidatePrivacy(findBestPartner(userPrefs, excludeIds));
    const score = calculateCompatibilityScore(userPrefs, mockCandidate);
    return {
      candidate: mockCandidate,
      source: 'dynamic_fallback',
      compatibilityScore: score,
      totalCandidatesQueried: 0,
      message: 'No cloud candidates found — matched with community demo partner.',
    };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.warn('[MatchmakingService] Firestore candidate query notice:', errMessage);

    // Fallback to local mock matching on error
    const fallbackCandidate = sanitizeCandidatePrivacy(findBestPartner(userPrefs, excludeIds));
    const score = calculateCompatibilityScore(userPrefs, fallbackCandidate);
    return {
      candidate: fallbackCandidate,
      source: 'local_fallback',
      compatibilityScore: score,
      totalCandidatesQueried: 0,
      message: 'Firestore candidate query unavailable — matched via Local Demo Mode.',
    };
  }
}

