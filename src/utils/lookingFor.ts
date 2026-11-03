/**
 * Pure rules for the Cosmos "Looking For" board: what a post holds, how the board is filtered, how mature posts are
 * shown, and what the composer accepts. Kept free of React and Firebase so it can be tested. firestore.rules repeats
 * the limits that matter for safety; the client only mirrors them to give early, friendly feedback.
 */
import type { NsfwPreference } from './nsfwPreference.ts';

export type LookingForIntention = 'dating' | 'friendship' | 'talk' | 'gaming' | 'open';

export const INTENTIONS: readonly LookingForIntention[] = ['dating', 'friendship', 'talk', 'gaming', 'open'];

/** Names in the composer. */
export const INTENTION_LABELS: Record<LookingForIntention, string> = {
  dating: 'Dating',
  friendship: 'Friendship',
  talk: 'Someone to talk to',
  gaming: 'Gaming buddy',
  open: 'Open to connections',
};

/** Names on the board's category chips (the same five intentions, plus All). */
export const LOOKING_FOR_CATEGORIES: { id: 'all' | LookingForIntention; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'dating', label: 'Dating' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'talk', label: 'Kausap' },
  { id: 'gaming', label: 'Gaming Buddies' },
  { id: 'open', label: 'Open to Connections' },
];

export const LIMITS = {
  title: 90,
  intro: 400,
  lookingFor: 400,
  contentWarning: 120,
  tags: 6,
  tagLength: 20,
  region: 60,
  minAge: 18,
  maxAge: 99,
} as const;

export interface LookingForPost {
  id: string;
  authorId: string;
  author: string;
  authorPronouns: string;
  authorAvatar?: string;
  title: string;
  intro: string;
  lookingFor: string;
  intention: LookingForIntention;
  /** Only present when the author chose to show it; the rules check it against their private birthday. */
  age?: number;
  /** The age range the author hopes to meet, published on purpose. Not the private matching range. */
  seekAgeMin?: number;
  seekAgeMax?: number;
  region?: string;
  tags: string[];
  isNsfw: boolean;
  contentWarning: string | null;
  /** The author has paused new connection requests on this post. */
  requestsPaused: boolean;
  timestamp: number;
  updatedAt?: number;
}

export const isIntention = (value: unknown): value is LookingForIntention =>
  typeof value === 'string' && (INTENTIONS as readonly string[]).includes(value);

/** One post per member per intention: the post id is derived, which also bounds how many a member can have. */
export const lookingForPostId = (uid: string, intention: LookingForIntention) => `${uid}_${intention}`;

// ----------------------------------------------------------------- filters

export interface LookingForFilters {
  category: 'all' | LookingForIntention;
  /** Only posts that show an age inside this range match; posts that hide their age do not. */
  ageMin: number | null;
  ageMax: number | null;
  region: string | null;
  tag: string | null;
  /** "hide" leaves mature posts off the board entirely, whatever the content setting is. */
  mature: 'any' | 'hide';
}

export const NO_FILTERS: LookingForFilters = { category: 'all', ageMin: null, ageMax: null, region: null, tag: null, mature: 'any' };

/** How many of the optional filters (not the category chips) are switched on. */
export const activeFilterCount = (f: LookingForFilters): number =>
  (f.ageMin !== null || f.ageMax !== null ? 1 : 0) + (f.region ? 1 : 0) + (f.tag ? 1 : 0) + (f.mature === 'hide' ? 1 : 0);

const norm = (value: string) => value.trim().toLowerCase();

/** The board as one member should see it: no blocked authors, then their filters. */
export function applyLookingForFilters(posts: LookingForPost[], filters: LookingForFilters, blockedIds: readonly string[] = []): LookingForPost[] {
  const blocked = new Set(blockedIds);
  return posts.filter((post) => {
    if (blocked.has(post.authorId)) return false;
    if (filters.category !== 'all' && post.intention !== filters.category) return false;
    if (filters.mature === 'hide' && post.isNsfw) return false;
    if (filters.ageMin !== null || filters.ageMax !== null) {
      if (post.age === undefined) return false;
      if (filters.ageMin !== null && post.age < filters.ageMin) return false;
      if (filters.ageMax !== null && post.age > filters.ageMax) return false;
    }
    if (filters.region && norm(post.region ?? '') !== norm(filters.region)) return false;
    if (filters.tag && !post.tags.some((tag) => norm(tag) === norm(filters.tag as string))) return false;
    return true;
  });
}

/** Every interest used on the board, most common first, for the interests filter. */
export function popularTags(posts: LookingForPost[], max = 12): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = norm(tag);
      if (!key) continue;
      const entry = counts.get(key);
      if (entry) entry.n += 1;
      else counts.set(key, { label: tag, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, max).map((e) => e.label);
}

// --------------------------------------------------------- mature content

/**
 * How a post is drawn. Mature posts are never shown open until the member has taken an explicit step for that
 * post: "concealed" covers the content (and can be revealed, depending on the setting), "blocked" is concealed with
 * no way to reveal because the member's setting is "always hide".
 */
export type Presentation = 'open' | 'concealed' | 'blocked';

export function postPresentation(post: Pick<LookingForPost, 'isNsfw'>, preference: NsfwPreference, revealed: boolean): Presentation {
  if (!post.isNsfw) return 'open';
  if (preference === 'hide') return 'blocked';
  return revealed ? 'open' : 'concealed';
}

/** "Ask before revealing" adds a confirmation dialog; "Show after confirmation" reveals on the explicit tap itself. */
export const revealNeedsDialog = (preference: NsfwPreference): boolean => preference === 'ask';

// ---------------------------------------------------------------- composer

export interface LookingForDraft {
  title: string;
  intro: string;
  lookingFor: string;
  intention: LookingForIntention | '';
  showAge: boolean;
  ageMin: string;
  ageMax: string;
  region: string;
  tags: string[];
  showPhoto: boolean;
  isNsfw: boolean;
  contentWarning: string;
}

export const EMPTY_DRAFT: LookingForDraft = {
  title: '', intro: '', lookingFor: '', intention: '', showAge: false, ageMin: '', ageMax: '',
  region: '', tags: [], showPhoto: true, isNsfw: false, contentWarning: '',
};

export function draftFromPost(post: LookingForPost): LookingForDraft {
  return {
    title: post.title, intro: post.intro, lookingFor: post.lookingFor, intention: post.intention,
    showAge: post.age !== undefined, ageMin: post.seekAgeMin?.toString() ?? '', ageMax: post.seekAgeMax?.toString() ?? '',
    region: post.region ?? '', tags: post.tags.slice(), showPhoto: Boolean(post.authorAvatar),
    isNsfw: post.isNsfw, contentWarning: post.contentWarning ?? '',
  };
}

const toAge = (value: string): number | null => {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
};

/** Friendly problems with a draft, by field. An empty object means it can be posted. */
export function validateDraft(draft: LookingForDraft, ownAge: number | null): Partial<Record<keyof LookingForDraft, string>> {
  const errors: Partial<Record<keyof LookingForDraft, string>> = {};
  if (!draft.title.trim()) errors.title = 'Give your post a title.';
  if (!draft.intro.trim()) errors.intro = 'Say a little about yourself.';
  if (!draft.lookingFor.trim()) errors.lookingFor = 'Say what you are looking for.';
  if (!isIntention(draft.intention)) errors.intention = 'Choose what kind of connection you want.';
  if (draft.showAge && (ownAge === null || ownAge < LIMITS.minAge)) errors.showAge = 'Add your birthday in your profile to show your age.';
  const min = toAge(draft.ageMin);
  const max = toAge(draft.ageMax);
  const inRange = (n: number | null) => n === null || (Number.isInteger(n) && n >= LIMITS.minAge && n <= LIMITS.maxAge);
  if (!inRange(min) || !inRange(max)) errors.ageMin = `Ages run from ${LIMITS.minAge} to ${LIMITS.maxAge}.`;
  else if (min !== null && max !== null && min > max) errors.ageMin = 'The youngest age must not be above the oldest.';
  if (draft.isNsfw && draft.contentWarning.trim().length > LIMITS.contentWarning) errors.contentWarning = `Keep it under ${LIMITS.contentWarning} characters.`;
  return errors;
}

/** Cleans up one interest tag the way the composer stores it. */
export function cleanTag(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.tagLength);
}

/** The fields written to Firestore for a draft. Optional fields that are off are left out so nothing private leaks. */
export function draftToDocument(
  draft: LookingForDraft,
  author: { uid: string; name: string; pronouns: string; avatar?: string },
  ownAge: number | null
): Record<string, unknown> {
  const min = toAge(draft.ageMin);
  const max = toAge(draft.ageMax);
  const seen = new Set<string>();
  const tags = draft.tags.map(cleanTag).filter((tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, LIMITS.tags);
  return {
    authorId: author.uid,
    authorName: author.name.trim().slice(0, 30) || 'Sapphic Guest',
    authorPronouns: author.pronouns.trim().slice(0, 20),
    ...(draft.showPhoto && author.avatar ? { authorAvatar: author.avatar } : {}),
    title: draft.title.trim().slice(0, LIMITS.title),
    intro: draft.intro.trim().slice(0, LIMITS.intro),
    lookingFor: draft.lookingFor.trim().slice(0, LIMITS.lookingFor),
    intention: draft.intention,
    ...(draft.showAge && ownAge !== null ? { age: ownAge } : {}),
    ...(min !== null && !Number.isNaN(min) ? { seekAgeMin: min } : {}),
    ...(max !== null && !Number.isNaN(max) ? { seekAgeMax: max } : {}),
    ...(draft.region.trim() ? { region: draft.region.trim().slice(0, LIMITS.region) } : {}),
    tags,
    isNsfw: draft.isNsfw,
    contentWarning: draft.isNsfw && draft.contentWarning.trim() ? draft.contentWarning.trim().slice(0, LIMITS.contentWarning) : null,
  };
}

/** The first few interests for a collapsed card, and how many are held back. Everything shows once expanded. */
export function previewTags(tags: string[], expanded: boolean, max = 3): { shown: string[]; hidden: number } {
  if (expanded || tags.length <= max) return { shown: tags, hidden: 0 };
  return { shown: tags.slice(0, max), hidden: tags.length - max };
}

/** "Looking for 24–32" style text for the preferred age range, or null when none is set. */
export function preferredAgeText(post: Pick<LookingForPost, 'seekAgeMin' | 'seekAgeMax'>): string | null {
  const { seekAgeMin, seekAgeMax } = post;
  if (seekAgeMin !== undefined && seekAgeMax !== undefined) return seekAgeMin === seekAgeMax ? `${seekAgeMin}` : `${seekAgeMin}–${seekAgeMax}`;
  if (seekAgeMin !== undefined) return `${seekAgeMin}+`;
  if (seekAgeMax !== undefined) return `up to ${seekAgeMax}`;
  return null;
}

export type FeedErrorReason = 'denied' | 'failed';

/** A refused read is told apart from every other failure (offline, unavailable, a missing index) by the error's code. */
export const feedErrorReason = (error: unknown): FeedErrorReason =>
  String((error as { code?: unknown } | null)?.code ?? '').includes('permission-denied') ? 'denied' : 'failed';

/** Pauses before the board is asked again after a refusal, in milliseconds. */
export const FEED_RETRY_DELAYS_MS: readonly number[] = [1500, 4000, 9000];

/**
 * How long to wait before asking the board again on its own, or null to stop. Only a refusal for an account that already
 * looks eligible on this device is retried: its profile may simply not have reached the server yet (a brand-new member who
 * opens the board straight after signing up). A member who is not eligible is never retried; the screen explains instead.
 */
export function feedRetryDelay(reason: FeedErrorReason | null, locallyEligible: boolean, triesSoFar: number): number | null {
  if (reason !== 'denied' || !locallyEligible) return null;
  return FEED_RETRY_DELAYS_MS[triesSoFar] ?? null;
}
