/**
 * Daily-activity day keys and the first-touch acquisition source.
 *
 * Activity days follow Philippine time (UTC+8), the same clock firestore.rules uses to accept an
 * activity write, so both sides agree on which day "today" is.
 */

export const ACTIVITY_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The activity day of a moment as a number: 20261030. */
export function activityDayNumber(ms: number): number {
  const d = new Date(ms + ACTIVITY_UTC_OFFSET_MS);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Field name inside member_activity.days for that day: "d20261030". */
export const activityDayKey = (ms: number): string => `d${activityDayNumber(ms)}`;

/** The activity day number `daysAgo` days before the given moment. */
export const activityDayNumberAgo = (ms: number, daysAgo: number): number => activityDayNumber(ms - daysAgo * DAY_MS);

export const ACQUISITION_SOURCES = ['tiktok', 'facebook', 'reddit', 'direct', 'referral', 'other'] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];
export const isAcquisitionSource = (value: unknown): value is AcquisitionSource =>
  typeof value === 'string' && (ACQUISITION_SOURCES as readonly string[]).includes(value);

const REFERRAL_WORDS = new Set(['referral', 'refer', 'friend', 'friends', 'invite', 'share', 'community']);
const PLATFORM_ALIASES: Record<string, AcquisitionSource> = {
  tiktok: 'tiktok', tt: 'tiktok',
  facebook: 'facebook', fb: 'facebook', meta: 'facebook',
  reddit: 'reddit',
};

/** Maps a ?ref= value to one allowed source; anything unrecognised is "other", empty is null. */
export function normalizeRef(value: string | null | undefined): AcquisitionSource | null {
  const ref = (value ?? '').trim().toLowerCase().slice(0, 40);
  if (!ref) return null;
  if (PLATFORM_ALIASES[ref]) return PLATFORM_ALIASES[ref];
  if (REFERRAL_WORDS.has(ref)) return 'referral';
  return 'other';
}

/** Maps a referring page's address to a source: a known platform, "other" for any other site, null for none. */
export function sourceFromReferrer(referrer: string | null | undefined, ownHost = ''): AcquisitionSource | null {
  if (!referrer) return null;
  let host = '';
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || (ownHost && (host === ownHost || host.endsWith(`.${ownHost}`)))) return null;
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|l\.facebook\.com)$/.test(host)) return 'facebook';
  if (/(^|\.)(reddit\.com|redd\.it)$/.test(host)) return 'reddit';
  return 'other';
}

/** The ?ref= value wins, then the referring site, then Direct. */
export function resolveSource(search: string, referrer: string | null | undefined, ownHost = ''): AcquisitionSource {
  const ref = normalizeRef(new URLSearchParams(search).get('ref'));
  return ref ?? sourceFromReferrer(referrer, ownHost) ?? 'direct';
}

/** Day arithmetic on 20261030-style numbers (calendar days, no time zone involved). */
export function addDays(dayNumber: number, days: number): number {
  const y = Math.floor(dayNumber / 10000);
  const m = Math.floor((dayNumber % 10000) / 100);
  const d = dayNumber % 100;
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.getUTCFullYear() * 10000 + (next.getUTCMonth() + 1) * 100 + next.getUTCDate();
}

/** A day number as the local midnight a chart axis expects. */
export function dayNumberToLocalMs(dayNumber: number): number {
  return new Date(Math.floor(dayNumber / 10000), Math.floor((dayNumber % 10000) / 100) - 1, dayNumber % 100).getTime();
}

const SOURCE_KEY = 'queerspace_acquisition_source';

/**
 * Remembers where this device first came from, once. A device that already has a saved profile (an
 * existing member) is marked "unknown" and never attributed, so nobody's past is guessed.
 */
export function captureAcquisitionSource(): AcquisitionSource | 'unknown' {
  try {
    const stored = localStorage.getItem(SOURCE_KEY);
    if (stored === 'unknown' || isAcquisitionSource(stored)) return stored;
    const existingMember = ['queerspace_user_prefs', 'hiraya_user_prefs', 'vespera_user_prefs'].some((key) => localStorage.getItem(key));
    const source = existingMember
      ? 'unknown'
      : resolveSource(window.location.search, document.referrer, window.location.hostname);
    localStorage.setItem(SOURCE_KEY, source);
    return source;
  } catch {
    return 'unknown';
  }
}
