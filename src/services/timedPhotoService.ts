import { auth } from '../lib/firebase.ts';
import { fitWithin, SEND_MAX_SIDE, SEND_QUALITY, type PhotoInfo, type PhotoTimer } from '../utils/timedPhoto.ts';
import type { ThreadMessage } from '../utils/signalsThread.ts';

/**
 * Timed photos go through the same Signals API as every other message. Nothing is ever kept on the device or in a URL:
 * the photo is shrunk and re-drawn here (which also removes camera and GPS metadata), sent once, and the recipient gets
 * the image in the single response that opens it.
 */

const TIMEOUT_MS = 30_000;

async function post<T>(body: Record<string, unknown>): Promise<{ status: number; data: T & { error?: string } }> {
  const user = auth?.currentUser;
  if (!user) return { status: 401, data: { error: 'unauthenticated' } as never };
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('/api/signals', {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Reads a chosen photo, redraws it at a sensible size as a JPEG, and returns it as base64. Throws if it cannot be read. */
export async function prepareTimedPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, SEND_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no_canvas');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SEND_QUALITY));
    if (!blob) throw new Error('encode_failed');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } finally {
    bitmap.close();
  }
}

export type SendPhotoResult = { ok: true; message: ThreadMessage } | { ok: false; reason: 'ended' | 'not_allowed' | 'too_large' | 'invalid' | 'busy' | 'unavailable' | 'failed' };

export async function sendTimedPhoto(input: { pairId: string; messageId: string; timer: PhotoTimer; imageBase64: string }): Promise<SendPhotoResult> {
  try {
    const { status, data } = await post<ThreadMessage>({ action: 'send-photo', pairId: input.pairId, messageId: input.messageId, timerSeconds: input.timer, image: input.imageBase64 });
    if (status === 200 || status === 201) return { ok: true, message: data };
    if (status === 409) return { ok: false, reason: 'ended' };
    if (status === 403 || status === 404) return { ok: false, reason: 'not_allowed' };
    if (status === 413) return { ok: false, reason: 'too_large' };
    if (status === 400) return { ok: false, reason: 'invalid' };
    if (status === 429) return { ok: false, reason: 'busy' };
    if (status === 502 || status === 503) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export const sendPhotoProblemText = (reason: Exclude<SendPhotoResult, { ok: true }>['reason']): string =>
  ({
    ended: 'This connection has ended.',
    not_allowed: 'You can no longer message this connection.',
    too_large: 'That photo is too large to send.',
    invalid: 'That photo can’t be sent. Try another one.',
    busy: 'You’re sending photos quickly. Wait a moment and try again.',
    unavailable: 'Photos are unavailable right now. Please try again later.',
    failed: 'Couldn’t send. Check your connection and try again.',
  })[reason];

export type OpenPhotoResult =
  | { ok: true; bitmap: ImageBitmap; remainingMs: number; durationSec: number; receivedAt: number }
  | { ok: false; reason: 'expired' | 'not_allowed' | 'unavailable' | 'failed' };

/**
 * Asks the server to open a photo. The picture comes back inside this response and is decoded straight to an in-memory
 * bitmap: it is never turned into a URL, a data link or an element attribute.
 */
export async function openTimedPhoto(pairId: string, messageId: string): Promise<OpenPhotoResult> {
  try {
    const { status, data } = await post<{ image: string; contentType: string; remainingMs: number; durationSec: number }>({ action: 'open-photo', pairId, messageId });
    if (status === 410 || (status === 404 && data.error === 'photo_not_found')) return { ok: false, reason: 'expired' };
    if (status === 403 || status === 409 || status === 404) return { ok: false, reason: 'not_allowed' };
    if (status === 502 || status === 503) return { ok: false, reason: 'unavailable' };
    if (status !== 200 || typeof data.image !== 'string') return { ok: false, reason: 'failed' };
    const receivedAt = performance.now();
    const raw = atob(data.image);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: data.contentType }));
    return { ok: true, bitmap, remainingMs: data.remainingMs, durationSec: data.durationSec, receivedAt };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export type { PhotoInfo };
