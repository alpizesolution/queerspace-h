/**
 * Optional mood tags on an Echo. They are metadata, not categories: they change nothing about replies, reactions,
 * visibility or sorting. An Echo has none, one or two. Stored as `moodTags: string[]` (stable ids) only when chosen.
 * The ids are mirrored in firestore.rules (`unsaidMoods`); a test keeps the two lists in step.
 */

export const MOOD_MAX = 2;

export const MOOD_GROUPS = [
  { id: 'emotional', label: 'Emotional' },
  { id: 'positive', label: 'Positive' },
  { id: 'love', label: 'Love & Connection' },
  { id: 'casual', label: 'Casual & Fun' },
] as const;

export type MoodGroupId = (typeof MOOD_GROUPS)[number]['id'];

export const MOODS = [
  { id: 'vulnerable', label: 'Vulnerable', emoji: '🥺', group: 'emotional' },
  { id: 'melancholic', label: 'Melancholic', emoji: '🌧️', group: 'emotional' },
  { id: 'overwhelmed', label: 'Overwhelmed', emoji: '🌊', group: 'emotional' },
  { id: 'healing', label: 'Healing', emoji: '🌱', group: 'emotional' },
  { id: 'lonely', label: 'Lonely', emoji: '🌙', group: 'emotional' },
  { id: 'reflective', label: 'Reflective', emoji: '🪞', group: 'emotional' },
  { id: 'hopeful', label: 'Hopeful', emoji: '🌅', group: 'positive' },
  { id: 'happy', label: 'Happy', emoji: '😊', group: 'positive' },
  { id: 'grateful', label: 'Grateful', emoji: '🙏', group: 'positive' },
  { id: 'growing', label: 'Growing', emoji: '🌿', group: 'positive' },
  { id: 'loved', label: 'Loved', emoji: '💗', group: 'positive' },
  { id: 'proud', label: 'Proud', emoji: '🏳️‍🌈', group: 'positive' },
  { id: 'in-love', label: 'In Love', emoji: '💞', group: 'love' },
  { id: 'crushing', label: 'Crushing', emoji: '🦋', group: 'love' },
  { id: 'missing-someone', label: 'Missing Someone', emoji: '💌', group: 'love' },
  { id: 'dreaming', label: 'Dreaming', emoji: '💭', group: 'love' },
  { id: 'connected', label: 'Connected', emoji: '🤝', group: 'love' },
  { id: 'longing', label: 'Longing', emoji: '🕯️', group: 'love' },
  { id: 'daydreaming', label: 'Daydreaming', emoji: '☁️', group: 'casual' },
  { id: 'confused', label: 'Confused', emoji: '🫠', group: 'casual' },
  { id: 'silly', label: 'Silly', emoji: '🤪', group: 'casual' },
  { id: 'chill', label: 'Chill', emoji: '😌', group: 'casual' },
  { id: 'excited', label: 'Excited', emoji: '✨', group: 'casual' },
  { id: 'feeling-myself', label: 'Feeling Myself', emoji: '💅', group: 'casual' },
] as const;

export type MoodId = (typeof MOODS)[number]['id'];

export const MOOD_IDS: readonly string[] = MOODS.map((m) => m.id);

export const moodsInGroup = (group: MoodGroupId) => MOODS.filter((m) => m.group === group);

export function moodInfo(id: string) {
  return MOODS.find((m) => m.id === id) ?? null;
}

/**
 * Cleans whatever was stored or chosen into a valid list: only known moods, no repeats, at most two, in order.
 * Old Echoes have no moodTags, and anything unexpected reads as "no mood".
 */
export function toMoodTags(value: unknown): MoodId[] {
  if (!Array.isArray(value)) return [];
  const out: MoodId[] = [];
  for (const v of value) {
    if (typeof v === 'string' && MOOD_IDS.includes(v) && !out.includes(v as MoodId)) out.push(v as MoodId);
    if (out.length === MOOD_MAX) break;
  }
  return out;
}

/** Add or remove one mood from a selection. A third mood is refused (the selection comes back unchanged). */
export function toggleMood(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((m) => m !== id);
  if (selected.length >= MOOD_MAX || !MOOD_IDS.includes(id)) return [...selected];
  return [...selected, id];
}
