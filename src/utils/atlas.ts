/** Shared ATLAS types and helpers. The server (api/_atlas.js) is the authority; these keep the app in step with it. */

/** Every memory is public to members and the server sets that itself. The other two values exist only to describe memories saved by an
 *  earlier version, which keep their narrower audience; nothing here can create or switch to them. */
export type MemoryVisibility = 'private' | 'friends' | 'public';

export const TITLE_MAX = 80;
export const TEXT_MAX = 1000;
export const PLACE_MAX = 80;
/** Mirrors GRID_DEGREES in api/_atlas.js: the server rounds every point to this grid (about 1 km) before storing it. */
export const GRID_DEGREES = 0.01;

/** Who can see a memory, in words (for the author's own card). */
export const AUDIENCE_TEXT: Record<MemoryVisibility, string> = {
  public: 'Visible to all QUEERSPACE members',
  friends: 'Only your connections (saved by an earlier version)',
  private: 'Only you (saved by an earlier version)',
};

/** How a memory shows its author: their own QUEERSPACE pseudonym, or Anonymous. An anonymous memory is shown under a random cosmic name
 *  (Nova, Polaris, Little Comet...) that the SERVER picks when it is published and stores on that memory alone; the app never sends a
 *  name. The server decides what other members receive; the real account is never part of an anonymous memory. */
export type IdentityMode = 'profile' | 'anonymous';
/** The label of the Anonymous choice in the form (what the member picks; the name other members see is the memory's cosmic name). */
export const ANONYMOUS_NAME = 'Anonymous';
export interface DisplayIdentity { mode: IdentityMode }

export interface AtlasAuthor {
  id: string;
  displayName: string | null;
  avatar: string | null;
  pronouns: string | null;
}

export interface AtlasMemory {
  id: string;
  mine: boolean;
  title: string;
  text: string;
  /** YYYY-MM-DD */
  date: string | null;
  /** Already rounded by the server: this is the approximate place, never the exact one. */
  lat: number;
  lng: number;
  placeLabel: string;
  visibility: MemoryVisibility;
  /** Which identity the author chose, and the name every member sees for it: the memory's own cosmic name when anonymous, or the author's pseudonym. */
  displayIdentity: IdentityMode;
  displayName: string | null;
  /** The author's own choices, present only on their own memories (so an edit can start from them). */
  identity: DisplayIdentity | null;
  hasPhoto: boolean;
  /** Totals only. Nobody is ever told who viewed or reacted. Older servers (and older stored records) may not send them. */
  views?: number;
  hugs?: number;
  hearts?: number;
  createdAt: number | null;
  author: AtlasAuthor | null;
}

export type ReactionKind = 'hug' | 'heart';
export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'hug', emoji: '\u{1F917}', label: 'Hug' },
  { kind: 'heart', emoji: '\u2764\uFE0F', label: 'Heart' },
];

/** What a card shows under a memory: the totals, and the viewing member's own reaction (one at most). */
export interface Engagement { views: number; hugs: number; hearts: number; mine: ReactionKind | null }

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The totals a list response already carries (the member's own reaction is only known once the card is opened). */
export const engagementOf = (memory: Pick<AtlasMemory, 'views' | 'hugs' | 'hearts'>, mine: ReactionKind | null = null): Engagement =>
  ({ views: whole(memory.views), hugs: whole(memory.hugs), hearts: whole(memory.hearts), mine });

/** The totals after the member chooses `next` (null takes their reaction back): one reaction at most, switching moves it, never below zero. */
export function applyReaction(current: Engagement, next: ReactionKind | null): Engagement {
  if (current.mine === next) return current;
  const out = { ...current, mine: next };
  if (current.mine) out[current.mine === 'hug' ? 'hugs' : 'hearts'] = Math.max(0, out[current.mine === 'hug' ? 'hugs' : 'hearts'] - 1);
  if (next) out[next === 'hug' ? 'hugs' : 'hearts'] += 1;
  return out;
}

/** 0 to 999 as they are, then 1.2k, 12k, 1.2M: short enough for a small chip. */
export function formatCount(value: number): string {
  const n = whole(value);
  if (n < 1000) return String(n);
  const short = (x: number, unit: string) => `${x >= 10 ? Math.floor(x) : Math.floor(x * 10) / 10}${unit}`.replace('.0', '');
  return n < 1_000_000 ? short(n / 1000, 'k') : short(n / 1_000_000, 'M');
}

export interface MapBounds { south: number; west: number; north: number; east: number }

export function snapCoordinate(value: number): number {
  return Number((Math.round(value / GRID_DEGREES) * GRID_DEGREES).toFixed(2)) || 0;
}

/** A calendar date as YYYY-MM-DD for today in the member's own time zone (what a date field expects). */
export function todayInputValue(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "June 1, 2024" from YYYY-MM-DD, without the time-zone shift a plain Date would add. */
export function formatMemoryDate(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const at = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** "Jun 1, 2024": the short form for the corner of a card. */
/** What to call a memory in a label or a list: its title, or (new memories have none) the first words of its story. */
export function memoryLabel(memory: { title?: string; text?: string }): string {
  const title = (memory.title ?? '').trim();
  if (title) return title;
  const words = (memory.text ?? '').trim().replace(/\s+/g, ' ');
  if (!words) return 'A memory';
  if (words.length <= 60) return words;
  const cut = words.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30))}…`;
}

export function formatMemoryDateShort(date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const at = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The map's view as bounds for the server. A view that spans the whole world becomes the whole world; a view that crosses the date
 * line (west > east) is sent as it is. Padded a little so a small pan does not need a new request.
 */
export function normalizeBounds(b: MapBounds, pad = 0.2): MapBounds {
  const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
  const wrapLng = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  const height = b.north - b.south;
  const south = clampLat(b.south - height * pad);
  const north = clampLat(b.north + height * pad);
  const span = b.east - b.west;
  if (span * (1 + 2 * pad) >= 360) return { south, west: -180, north, east: 180 };
  return { south, west: wrapLng(b.west - span * pad), north, east: wrapLng(b.east + span * pad) };
}

export interface PlaceGroup {
  key: string;
  lat: number;
  lng: number;
  memories: AtlasMemory[];
}

/** Memories at the same rounded point share one star; the star opens all of them. Newest first inside a star. */
export function groupByPlace(memories: AtlasMemory[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const memory of memories) {
    const key = `${memory.lat.toFixed(2)},${memory.lng.toFixed(2)}`;
    const group = groups.get(key) ?? { key, lat: memory.lat, lng: memory.lng, memories: [] };
    group.memories.push(memory);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.memories.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return [...groups.values()];
}

export type AtlasFailure = 'not-allowed' | 'suspended' | 'rate-limited' | 'too-large' | 'type' | 'content' | 'identity' | 'unavailable' | 'offline' | 'failed';

export function atlasProblemText(reason: AtlasFailure): string {
  switch (reason) {
    case 'not-allowed': return 'Save your profile with your birthday to use ATLAS.';
    case 'suspended': return 'ATLAS isn’t available on this account right now.';
    case 'rate-limited': return 'You’re going a little fast. Please wait a moment and try again.';
    case 'too-large': return 'That picture is too large. Try a smaller one.';
    case 'type': return 'Please choose a JPEG, PNG or WebP picture.';
    case 'content': return 'That doesn’t fit our community guidelines. Please change the words and try again.';
    case 'identity': return 'Choose how your name should appear (your pseudonym or Anonymous) and try again.';
    case 'unavailable': return 'Picture saving isn’t available right now. You can save the memory without a picture.';
    case 'offline': return 'You seem to be offline. Check your connection and try again.';
    default: return 'Something went wrong. Please try again.';
  }
}
