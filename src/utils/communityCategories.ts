/** The Cosmos Community categories, shared by the feed and by member profiles. */
export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'vents', label: 'Cozy Vents' },
  { id: 'media', label: 'Books & Media' },
  { id: 'friends', label: 'Friend Finder' },
  { id: 'advice', label: 'Dating & Advice' },
  { id: 'general', label: 'General' },
];

export const CATEGORY_EMOJI: Record<string, string> = {
  vents: '☁️',
  media: '📚',
  friends: '🫶',
  advice: '💌',
  general: '🌸',
};
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
