/**
 * Current Vibe: a temporary 24-hour mood status. Pure rules shared by the screens, the service and the tests: the mood list, the
 * message limit, how a status from the server is read, and the words for "Updated 2 hours ago · Expires in 22 hours".
 *
 * The server (api/_vibe.js) is what decides who may see a vibe and whether it has expired, on every read; the screen only shapes
 * what it is given. Keep the moods and limits in step with api/_vibe.js (a test checks that they agree).
 */

export const VIBE_MOODS = [
  { id: 'happy', emoji: '😊', label: 'Happy' },
  { id: 'loved', emoji: '🥰', label: 'Loved' },
  { id: 'excited', emoji: '🦋', label: 'Excited' },
  { id: 'dreamy', emoji: '🌙', label: 'Dreamy' },
  { id: 'peaceful', emoji: '😌', label: 'Peaceful' },
  { id: 'sensitive', emoji: '🥺', label: 'Sensitive' },
  { id: 'sad', emoji: '😔', label: 'Sad' },
  { id: 'overwhelmed', emoji: '😵‍💫', label: 'Overwhelmed' },
  { id: 'motivated', emoji: '🔥', label: 'Motivated' },
  { id: 'exhausted', emoji: '🫠', label: 'Exhausted' },
  { id: 'thoughtful', emoji: '💭', label: 'Thoughtful' },
  { id: 'healing', emoji: '🌱', label: 'Healing' },
  { id: 'lonely', emoji: '☁️', label: 'Lonely' },
  { id: 'grateful', emoji: '💜', label: 'Grateful' },
] as const;

export type VibeMoodId = (typeof VIBE_MOODS)[number]['id'];

export const VIBE_MESSAGE_MAX = 100;
export const VIBE_TTL_HOURS = 24;
/** How long a status is remembered on this device, so moving between a few chats and profiles does not ask again each time. */
export const VIBE_CACHE_MS = 60_000;

export type VibeVisibility = 'everyone' | 'connections' | 'nobody';

export const VIBE_VISIBILITY_OPTIONS: { id: VibeVisibility; label: string; hint: string }[] = [
  { id: 'everyone', label: 'Everyone who can view my profile', hint: 'Shown on your profile, in Seek and in Signals.' },
  { id: 'connections', label: 'Approved connections only', hint: 'Only people you have a Signals connection with.' },
  { id: 'nobody', label: 'Nobody', hint: 'Only you can see it.' },
];

export const visibilityLabel = (visibility: VibeVisibility): string => VIBE_VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? 'Everyone who can view my profile';

/** A status as the server returns it. `visibility` is present only on the member's own. */
export interface VibeView {
  moodId: VibeMoodId;
  emoji: string;
  label: string;
  message: string | null;
  /** ISO times, from the server's clock. */
  updatedAt: string;
  expiresAt: string;
  visibility?: VibeVisibility;
}

const BY_ID = new Map<string, (typeof VIBE_MOODS)[number]>(VIBE_MOODS.map((m) => [m.id, m]));

export const moodById = (id: unknown) => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);

/** Characters as a person counts them (an emoji is one), so the counter and the limit agree with the server. */
export const messageLength = (text: string): number => [...text].length;

/** The message as it will be sent: one tidy line. */
export const tidyMessage = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Why a message cannot be sent, in words for the member, or null when it is fine. An empty message is fine. */
export function messageProblem(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text.replace(/[\r\n\t]/g, ' '))) return 'That message has characters we can’t show.';
  return messageLength(tidyMessage(text)) > VIBE_MESSAGE_MAX ? `Keep it to ${VIBE_MESSAGE_MAX} characters.` : null;
}

/**
 * Reads a status from the server. Anything that is not exactly the expected shape gives null, so a bad answer shows no status
 * rather than a broken one. The mood's emoji and name always come from the list, never from the answer.
 */
export function parseVibe(value: unknown): VibeView | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const mood = moodById(raw.moodId);
  if (!mood || typeof raw.updatedAt !== 'string' || typeof raw.expiresAt !== 'string') return null;
  if (Number.isNaN(Date.parse(raw.updatedAt)) || Number.isNaN(Date.parse(raw.expiresAt))) return null;
  const message = typeof raw.message === 'string' && raw.message.trim() && messageLength(raw.message) <= VIBE_MESSAGE_MAX ? raw.message.trim() : null;
  const visibility = raw.visibility === 'everyone' || raw.visibility === 'connections' || raw.visibility === 'nobody' ? raw.visibility : undefined;
  return { moodId: mood.id, emoji: mood.emoji, label: mood.label, message, updatedAt: raw.updatedAt, expiresAt: raw.expiresAt, ...(visibility ? { visibility } : {}) };
}

/** True while the status has not reached its expiry (the server decides first; this keeps an open screen honest as time passes). */
export const isLive = (vibe: Pick<VibeView, 'expiresAt'> | null | undefined, now: number = Date.now()): boolean =>
  Boolean(vibe) && Date.parse(vibe!.expiresAt) > now;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "just now", "5 minutes ago", "2 hours ago". */
export function updatedAgo(updatedAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  return `${plural(Math.floor(minutes / 60), 'hour')} ago`;
}

/** "less than a minute", "35 minutes", "22 hours" (rounded up, so a fresh status reads 24 hours). */
export function expiresIn(expiresAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
  if (minutes <= 1) return 'less than a minute';
  if (minutes < 60) return plural(minutes, 'minute');
  return plural(Math.ceil(minutes / 60), 'hour');
}

/** "Updated 2 hours ago · Expires in 22 hours". */
export function vibeTimes(vibe: Pick<VibeView, 'updatedAt' | 'expiresAt'>, now: number = Date.now()): string {
  const left = expiresIn(vibe.expiresAt, now);
  return `Updated ${updatedAgo(vibe.updatedAt, now)} · Expires in ${left}`;
}

const MANILA = { timeZone: 'Asia/Manila' } as const;

/** An exact date and time in Manila time, for a tooltip: "Nov 13, 2026, 2:15 AM". */
export function manilaDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', { ...MANILA, dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** The full sentence for a screen reader and a tooltip. */
export function vibeAccessibleSummary(vibe: VibeView, now: number = Date.now()): string {
  const parts = [`Current Vibe: ${vibe.label}`];
  if (vibe.message) parts.push(`“${vibe.message}”`);
  parts.push(vibeTimes(vibe, now));
  return parts.join('. ');
}
