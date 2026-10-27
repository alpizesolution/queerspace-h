import { UserPreferences } from '../types.ts';

/**
 * UserPreferences holds two independent things: the profile someone saves about themselves, and
 * the chat filters they search with. Each editor only ever writes its own half, so saving one
 * can't reset the other.
 */

/** About me: edited in "Your profile". Visibility flags decide what others may see. */
export const PROFILE_KEYS = [
  'displayName',
  'avatar',
  'aboutMe',
  'myVibe',
  'pronouns',
  'customPronouns',
  'sexualOrientation',
  'sexualOrientationCustom',
  'genderIdentity',
  'genderIdentityCustom',
  'genderExpression',
  'showGenderExpressionOnProfile',
  'showSexualOrientationOnProfile',
  'showGenderIdentityOnProfile',
  'showSogieOnProfile',
  'showLocationOnProfile',
] as const satisfies readonly (keyof UserPreferences)[];

/**
 * Who I want to meet: edited in the Seek sheet. `region` is the summary of `locationSelection`;
 * `age` lives here because it is only ever used by age filters.
 */
export const FILTER_KEYS = [
  'intention',
  'topics',
  'region',
  'locationSelection',
  'applyLocationFilter',
  'applyGenderExpressionFilter',
  'preferredGenderExpressions',
  'age',
  'applyAgeFilter',
  'ageMin',
  'ageMax',
] as const satisfies readonly (keyof UserPreferences)[];

export type ProfileFields = Pick<UserPreferences, (typeof PROFILE_KEYS)[number]>;
export type FilterFields = Pick<UserPreferences, (typeof FILTER_KEYS)[number]>;

function pick<K extends keyof UserPreferences>(prefs: UserPreferences, keys: readonly K[]): Pick<UserPreferences, K> {
  const out = {} as Pick<UserPreferences, K>;
  for (const key of keys) out[key] = prefs[key];
  return out;
}

export const pickProfile = (prefs: UserPreferences): ProfileFields => pick(prefs, PROFILE_KEYS);
export const pickFilters = (prefs: UserPreferences): FilterFields => pick(prefs, FILTER_KEYS);

/** Replaces only the profile half; filters (and anything else) stay as they were. */
export const applyProfile = (prefs: UserPreferences, profile: ProfileFields): UserPreferences => ({
  ...prefs,
  ...pick(profile as UserPreferences, PROFILE_KEYS),
});

/** Replaces only the filter half; profile fields and visibility flags stay as they were. */
export const applyFilters = (prefs: UserPreferences, filters: FilterFields): UserPreferences => ({
  ...prefs,
  ...pick(filters as UserPreferences, FILTER_KEYS),
});

/**
 * What a search actually runs with. Quick Match meets anyone available: no intention, topic, age,
 * location or expression filters. The saved Custom filters are left untouched for next time.
 */
export function matchPrefsForMode(prefs: UserPreferences, mode: 'quick' | 'custom'): UserPreferences {
  if (mode === 'custom') return prefs;
  return {
    ...prefs,
    intention: 'open',
    topics: [],
    applyAgeFilter: false,
    applyLocationFilter: false,
    applyGenderExpressionFilter: false,
  };
}
