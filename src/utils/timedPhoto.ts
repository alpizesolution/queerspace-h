/**
 * Pure rules for timed photos in Signals: the only timers, what a photo message shows, how a picked file is checked and
 * sized, and when the viewer must hide the picture. No React, no network, no browser, so it can be tested. The server
 * (api/_media.js) is the authority on who may open a photo and when it ends; nothing here is a security boundary.
 */

/** The only viewing times, in seconds. The server accepts the same three and refuses everything else. */
export const PHOTO_TIMERS = [3, 5, 8] as const;
export type PhotoTimer = (typeof PHOTO_TIMERS)[number];
export const DEFAULT_PHOTO_TIMER: PhotoTimer = 3;
export const isPhotoTimer = (value: unknown): value is PhotoTimer => typeof value === 'number' && (PHOTO_TIMERS as readonly number[]).includes(value);

export type PhotoStatus = 'sent' | 'opened' | 'unopened' | 'viewing' | 'expired';

/** What the server tells the app about a photo message: its timer and state, never where the image is. */
export interface PhotoInfo {
  durationSec: number;
  status: PhotoStatus;
  mine: boolean;
  /** When the one viewing window ends (ms), while it is open. */
  expiresAt?: number;
  /** When a photo nobody has opened expires (ms). */
  until?: number;
}

export type PhotoCard =
  | { kind: 'expired'; label: string }
  | { kind: 'sent'; label: string }
  | { kind: 'opened'; label: string }
  | { kind: 'openable'; label: string };

/**
 * How a photo message is drawn. "Photo expired" is also shown as soon as the member has closed it on this device, or when
 * the clock says its time is up; the server still decides every real request. `now` is the device clock.
 */
export function photoCard(photo: PhotoInfo, now: number, closedHere: boolean): PhotoCard {
  const timeUp = (photo.status === 'viewing' || photo.status === 'opened') && photo.expiresAt !== undefined && now >= photo.expiresAt;
  const lapsed = photo.status === 'unopened' && photo.until !== undefined && now >= photo.until;
  if (photo.status === 'expired' || timeUp || lapsed || (closedHere && !photo.mine)) return { kind: 'expired', label: 'Photo expired' };
  if (photo.mine) return photo.status === 'opened' ? { kind: 'opened', label: 'Opened' } : { kind: 'sent', label: `Photo · ${photo.durationSec}s` };
  return { kind: 'openable', label: 'Open photo' };
}

/** The whole seconds left, never below zero, shown while the viewer counts down. */
export const secondsLeft = (remainingMs: number): number => Math.max(0, Math.ceil(remainingMs / 1000));

// ------------------------------------------------------------------------------------------ choosing a file

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** The biggest file read from the device; it is shrunk before sending. */
export const MAX_PICKED_BYTES = 20 * 1024 * 1024;
/** The longest side of what is sent. The photo is redrawn at this size, which also drops all camera metadata. */
export const SEND_MAX_SIDE = 1600;
export const SEND_QUALITY = 0.85;

export type PickProblem = 'type' | 'size' | 'empty';

/** Why a chosen file cannot be sent, or null. SVG and anything that is not a plain photo format is refused here too. */
export function pickedFileProblem(file: { type: string; size: number }): PickProblem | null {
  if (!file.size) return 'empty';
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > MAX_PICKED_BYTES) return 'size';
  return null;
}

export const pickProblemText = (problem: PickProblem): string =>
  problem === 'type' ? 'Choose a JPEG, PNG or WebP photo.' : problem === 'size' ? 'That photo is too large. Choose one under 20 MB.' : 'That file is empty.';

/** The size to redraw a photo at: the same shape, no side longer than `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = SEND_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// -------------------------------------------------------------------------------------- hiding while capturing

/**
 * Whether the picture must be hidden right now. A hidden tab or a window that lost focus can be screen-recorded or
 * mirrored, and some keys (such as Print Screen) take a screenshot. This only hides the picture; the countdown keeps
 * running, and it cannot stop a photo of the screen taken another way.
 */
export const shouldConceal = (state: { hidden: boolean; focused: boolean; captureKey: boolean }): boolean => state.hidden || !state.focused || state.captureKey;

/** Keys that usually take a screenshot on desktop. Best effort: a browser may not report them at all. */
export function isCaptureKey(event: { key: string; metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean }): boolean {
  if (event.key === 'PrintScreen') return true;
  return Boolean(event.metaKey && event.shiftKey && ['3', '4', '5', 's', 'S'].includes(event.key));
}

// ------------------------------------------------------------------------------ when a photo cannot be read

export type PhotoReadStage = 'read' | 'decode' | 'draw' | 'encode';

/** Why a chosen photo could not be prepared: which step failed, and the browser's name for the error. Nothing private. */
export class PhotoReadError extends Error {
  constructor(public readonly stage: PhotoReadStage, public readonly detail: string) {
    super(`${stage}:${detail}`);
    this.name = 'PhotoReadError';
  }
}

/** A short, safe name for whatever was thrown, for the message and the console. */
export const errorLabel = (error: unknown): string => {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'Error';
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30) || 'Error';
};

/** The message when a photo cannot be prepared, naming the step so the real cause can be found. */
export const photoReadProblemText = (error: unknown): string => {
  const code = error instanceof PhotoReadError ? error.message.slice(0, 60) : `unknown:${errorLabel(error)}`;
  return `That photo can’t be read on this device (${code}). Try another one.`;
};
