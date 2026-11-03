/** The Cosmos Community categories, shared by the feed and by member profiles. */
export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'vents', label: 'Cozy Vents' },
  { id: 'media', label: 'Books & Media' },
  { id: 'friends', label: 'Friend Finder' },
  { id: 'advice', label: 'Dating' },
  { id: 'general', label: 'General' },
];

/** The filter row: the same categories without General, which is still a post category and still shows under All. */
export const FILTER_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'general');

export const CATEGORY_EMOJI: Record<string, string> = {
  vents: '☁️',
  media: '📚',
  friends: '🫶',
  advice: '💌',
  general: '🌸',
};
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
