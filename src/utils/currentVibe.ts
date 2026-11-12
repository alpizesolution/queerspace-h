/**
 * Current Vibe: a temporary 24-hour custom status shown as a small bubble beside a member's avatar. It is one emoji and a short
 * message in the member's own words. Pure rules shared by the screens, the service and the tests: the common emoji, the message limit,
 * how a status from the server is read, and the words for how long it has left.
 *
 * The server (api/_vibe.js) is what decides who may see a status and whether it has expired, on every read; the screen only shapes
 * what it is given. Keep the limits in step with api/_vibe.js (a test checks that they agree).
 */

/** The longest message, in characters (an emoji counts as one). */
export const VIBE_MESSAGE_MAX = 60;
export const VIBE_TTL_HOURS = 24;
/** How long a status is remembered on this device, so moving between a few chats and profiles does not ask again each time. */
export const VIBE_CACHE_MS = 60_000;

/** The emoji offered in the picker: moods, weather, little comforts. Any single emoji is accepted by the server; these are the quick picks. */
export const COMMON_EMOJI = [
  '😊', '🥰', '🥺', '😔', '😌', '😴', '🫠', '😵‍💫', '🙃', '😅', '🥹', '😎',
  '🔥', '✨', '🌙', '☁️', '🌧️', '🌈', '🪐', '🌱', '🌿', '🌸', '🦋', '💭',
  '💜', '❤️', '🩷', '🤍', '🫶', '🕯️', '☕', '🍵', '🎧', '📚', '🎮', '🤔',
] as const;

export type VibeVisibility = 'everyone' | 'connections' | 'nobody';

export const VIBE_VISIBILITY_OPTIONS: { id: VibeVisibility; label: string; short: string; hint: string }[] = [
  { id: 'everyone', label: 'Everyone who can view my profile', short: 'Everyone', hint: 'Shown on your profile, in Seek and in Signals.' },
  { id: 'connections', label: 'Approved connections only', short: 'Connections', hint: 'Only people you have a Signals connection with.' },
  { id: 'nobody', label: 'Nobody', short: 'Only me', hint: 'Only you can see it.' },
];

export const visibilityLabel = (visibility: VibeVisibility): string => VIBE_VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? 'Everyone who can view my profile';

/** A status as the server returns it: an emoji and/or a message. `visibility` is present only on the member's own. */
export interface VibeView {
  /** One emoji, or an empty string when the status is words only. */
  emoji: string;
  message: string | null;
  /** ISO times, from the server's clock. */
  updatedAt: string;
  expiresAt: string;
  visibility?: VibeVisibility;
}

/** Characters as a person counts them (an emoji is one), so the counter and the limit agree with the server. */
export const messageLength = (text: string): number => [...text].length;

/** The message as it will be sent: one tidy line. */
export const tidyMessage = (text: string): string => text.replace(/\s+/g, ' ').trim();

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f' + String.fromCharCode(0x2028, 0x2029) + ']');

/** Why a message cannot be sent, in words for the member, or null when it is fine. An empty message is fine (an emoji alone is a status). */
export function messageProblem(text: string): string | null {
  if (CONTROL.test(text.replace(/[\r\n\t]/g, ' '))) return 'That message has characters we can’t show.';
  return messageLength(tidyMessage(text)) > VIBE_MESSAGE_MAX ? `Keep it to ${VIBE_MESSAGE_MAX} characters.` : null;
}

/** Whether there is something to show: an emoji, a message, or both. */
export const hasContent = (emoji: string, message: string): boolean => emoji.trim() !== '' || tidyMessage(message) !== '';

/**
 * Reads a status from the server. Anything that is not exactly the expected shape gives null, so a bad answer shows no status
 * rather than a broken one.
 */
export function parseVibe(value: unknown): VibeView | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.updatedAt !== 'string' || typeof raw.expiresAt !== 'string') return null;
  if (Number.isNaN(Date.parse(raw.updatedAt)) || Number.isNaN(Date.parse(raw.expiresAt))) return null;
  const emoji = typeof raw.emoji === 'string' && raw.emoji.length <= 32 ? raw.emoji : '';
  const message = typeof raw.message === 'string' && raw.message.trim() && messageLength(raw.message) <= VIBE_MESSAGE_MAX ? raw.message.trim() : null;
  if (!emoji && !message) return null;
  const visibility = raw.visibility === 'everyone' || raw.visibility === 'connections' || raw.visibility === 'nobody' ? raw.visibility : undefined;
  return { emoji, message, updatedAt: raw.updatedAt, expiresAt: raw.expiresAt, ...(visibility ? { visibility } : {}) };
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

/** "Updated 2 hours ago · Clears in 22 hours". */
export function vibeTimes(vibe: Pick<VibeView, 'updatedAt' | 'expiresAt'>, now: number = Date.now()): string {
  return `Updated ${updatedAgo(vibe.updatedAt, now)} · Clears in ${expiresIn(vibe.expiresAt, now)}`;
}

/** An exact date and time in Manila time, for a tooltip: "Nov 13, 2026, 2:15 AM". */
export function manilaDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** The full sentence for a screen reader and a tooltip: the status in words, then how long it has left. */
export function vibeAccessibleSummary(vibe: VibeView, now: number = Date.now()): string {
  const said = [vibe.emoji, vibe.message].filter(Boolean).join(' ');
  return `Status: ${said}. ${vibeTimes(vibe, now)}`;
}
