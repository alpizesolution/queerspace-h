/**
 * The member's setting for mature ("NSFW") posts, kept on this device like the text-size setting.
 *   hide    Always hide (default): mature posts stay covered and cannot be revealed.
 *   ask     Ask before revealing: revealing one post opens a confirmation first.
 *   confirm Show after confirmation: the cover shows the author's content warning, and the explicit
 *           "Reveal content" tap is the confirmation.
 * Whatever the setting, a post is only ever revealed one post at a time, by choice, and never by scrolling.
 */
export type NsfwPreference = 'hide' | 'ask' | 'confirm';

export const NSFW_PREFERENCE_KEY = 'queerspace_nsfw_preference';
export const DEFAULT_NSFW_PREFERENCE: NsfwPreference = 'hide';

export const NSFW_PREFERENCE_OPTIONS: { id: NsfwPreference; label: string; hint: string }[] = [
  { id: 'hide', label: 'Always hide', hint: 'Mature posts stay covered' },
  { id: 'ask', label: 'Ask before revealing', hint: 'You confirm each time' },
  { id: 'confirm', label: 'Show after confirmation', hint: 'Reveal one post at a time' },
];

/** Anything unknown or missing falls back to the safest choice. */
export function parseNsfwPreference(value: unknown): NsfwPreference {
  return value === 'ask' || value === 'confirm' || value === 'hide' ? value : DEFAULT_NSFW_PREFERENCE;
}

export function loadNsfwPreference(): NsfwPreference {
  try {
    return parseNsfwPreference(localStorage.getItem(NSFW_PREFERENCE_KEY));
  } catch {
    return DEFAULT_NSFW_PREFERENCE;
  }
}

export function saveNsfwPreference(value: NsfwPreference): void {
  try {
    localStorage.setItem(NSFW_PREFERENCE_KEY, value);
  } catch {
    // The choice still applies for this visit.
  }
}
