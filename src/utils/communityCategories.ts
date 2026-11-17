/**
 * The Cosmos Community categories, shared by the feed and by member profiles.
 *
 * Community is for sharing, discussion, recommendations and events. Finding people (friends, dates, activity partners) lives
 * in Looking For. Posts written before the two were separated keep their stored category ('general', 'vents', 'friends',
 * 'advice'): they stay readable, show under All, and are never rewritten.
 */
export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'events', label: 'Cozy Events' },
  { id: 'media', label: 'Books & Media' },
  { id: 'talk', label: 'Community Talk' },
  { id: 'experiences', label: 'Experiences' },
];

/** The categories a new Community post can be filed under (everything but All). */
export const COMPOSER_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'all');

/** The filter row. */
export const FILTER_CATEGORIES = CATEGORIES;

/** Older stored categories that no longer exist as choices, and which current category's filter lists them. */
const LEGACY_FILTER_HOME: Record<string, string> = { general: 'talk', vents: 'experiences' };

/** Whether a post belongs under a filter chip. Legacy 'friends' and 'advice' posts show under All only. */
export const matchesCategory = (postCategory: string, filter: string): boolean =>
  filter === 'all' || postCategory === filter || LEGACY_FILTER_HOME[postCategory] === filter;

export const CATEGORY_EMOJI: Record<string, string> = {
  events: '🕯️',
  media: '📚',
  talk: '💬',
  experiences: '🌷',
  // Stored by posts from before the separation.
  vents: '☁️',
  friends: '🫶',
  advice: '💌',
  general: '🌸',
};
export const CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])),
  vents: 'Cozy Vents',
  friends: 'Friend Finder',
  advice: 'Dating',
  general: 'General',
};
