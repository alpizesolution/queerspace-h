import { auth } from '../lib/firebase.ts';
import { errorLabel, fitWithin, PhotoReadError, SEND_MAX_SIDE, SEND_QUALITY, type PhotoInfo, type PhotoTimer } from '../utils/timedPhoto.ts';
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

/**
 * Copies a chosen photo into memory right away. A file handed over by a phone's picker can stop being readable if it is
 * read later, after the picker has moved on, so the app never keeps the original: it keeps this copy. Throws a
 * PhotoReadError('read') if the file cannot be read even now.
 */
export async function copyPickedPhoto(file: File): Promise<File> {
  try {
    const buffer = await file.arrayBuffer();
    if (!buffer.byteLength) throw new Error('empty');
    return new File([buffer], file.name || 'photo', { type: file.type });
  } catch (error) {
    throw new PhotoReadError('read', errorLabel(error));
  }
}

interface Decoded { source: CanvasImageSource; width: number; height: number; release: () => void }

/**
 * Turns the photo into something that can be drawn, trying the ways browsers differ on, in order: a bitmap that follows the
 * photo's own rotation, a plain bitmap, then an image element. Gives up only when all of them fail, and says what failed.
 */
async function decodePhoto(file: File): Promise<Decoded> {
  const failures: string[] = [];
  if (typeof createImageBitmap === 'function') {
    for (const options of [{ imageOrientation: 'from-image' as const }, undefined]) {
      try {
        const bitmap = options ? await createImageBitmap(file, options) : await createImageBitmap(file);
        if (bitmap.width > 0 && bitmap.height > 0) return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
        bitmap.close();
        failures.push('empty');
      } catch (error) {
        failures.push(errorLabel(error));
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
    failures.push('empty');
  } catch (error) {
    failures.push(errorLabel(error));
  } finally {
    URL.revokeObjectURL(url);
  }
  throw new PhotoReadError('decode', [...new Set(failures)].join('+').slice(0, 40));
}

/** Reads a chosen photo, redraws it at a sensible size as a JPEG, and returns it as base64. Throws a PhotoReadError. */
export async function prepareTimedPhoto(file: File): Promise<string> {
  const decoded = await decodePhoto(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, SEND_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoReadError('draw', 'no_canvas');
    try {
      context.drawImage(decoded.source, 0, 0, width, height);
    } catch (error) {
      throw new PhotoReadError('draw', errorLabel(error));
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SEND_QUALITY));
    if (!blob || !blob.size) throw new PhotoReadError('encode', 'no_jpeg');
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    } catch (error) {
      throw new PhotoReadError('encode', errorLabel(error));
    }
  } finally {
    decoded.release();
  }
}

export type SendPhotoFailure = 'ended' | 'not_allowed' | 'too_large' | 'invalid' | 'busy' | 'not_configured' | 'storage' | 'not_saved' | 'unavailable' | 'failed';
export type SendPhotoResult = { ok: true; message: ThreadMessage } | { ok: false; reason: SendPhotoFailure };

export async function sendTimedPhoto(input: { pairId: string; messageId: string; timer: PhotoTimer; imageBase64: string }): Promise<SendPhotoResult> {
  try {
    const { status, data } = await post<ThreadMessage>({ action: 'send-photo', pairId: input.pairId, messageId: input.messageId, timerSeconds: input.timer, image: input.imageBase64 });
    if (status === 200 || status === 201) return { ok: true, message: data };
    if (status === 409) return { ok: false, reason: 'ended' };
    if (status === 403 || status === 404) return { ok: false, reason: 'not_allowed' };
    if (status === 413) return { ok: false, reason: 'too_large' };
    if (status === 400) return { ok: false, reason: 'invalid' };
    if (status === 429) return { ok: false, reason: 'busy' };
    // Told apart by what the server says, so the message names the real problem instead of one catch-all.
    if (data.error === 'media_not_configured') return { ok: false, reason: 'not_configured' };
    if (data.error === 'media_storage_failed') return { ok: false, reason: 'storage' };
    if (data.error === 'photo_not_saved') return { ok: false, reason: 'not_saved' };
    if (status === 502 || status === 503) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export const sendPhotoProblemText = (reason: SendPhotoFailure): string =>
  ({
    ended: 'This connection has ended.',
    not_allowed: 'You can no longer message this connection.',
    too_large: 'That photo is too large to send.',
    invalid: 'That photo can’t be sent. Try another one.',
    busy: 'You’re sending photos quickly. Wait a moment and try again.',
    not_configured: 'Photo sending isn’t switched on yet. Please try again later.',
    storage: 'Couldn’t store the photo. Please try again.',
    not_saved: 'The photo was stored but the message couldn’t be saved. Please try again.',
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
