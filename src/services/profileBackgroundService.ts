import { auth } from '../lib/firebase.ts';
import { IMAGE_ID } from '../utils/profileBackground.ts';

/**
 * A member’s own background picture, through the Signals API (api/_background.js). The picture is shrunk on the device before it is
 * sent, the server inspects and cleans the real bytes and keeps them in private storage, and a viewer’s app asks the server (never a
 * link) for the picture saved on a profile. Presets need none of this: they are drawn by the app.
 */

const REQUEST_TIMEOUT_MS = 20_000;
/** The longest side a picture is shrunk to before upload. A background does not need more, and it keeps the upload small. */
export const UPLOAD_MAX_SIDE = 1600;
/** What the server accepts (see api/_background.js). The app aims well under it. */
export const UPLOAD_MAX_BYTES = 1_800_000;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function call(path: string, body?: Record<string, unknown>): Promise<Response | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export type UploadFailure = 'type' | 'too-large' | 'rate-limited' | 'not-allowed' | 'unavailable' | 'failed';
export type UploadOutcome = { ok: true; image: string } | { ok: false; reason: UploadFailure };

/** Words for a failed upload. */
export function uploadProblemText(reason: UploadFailure): string {
  switch (reason) {
    case 'type': return 'Please choose a JPEG, PNG or WebP picture.';
    case 'too-large': return 'That picture is too large. Try a smaller one.';
    case 'rate-limited': return 'You’re uploading very quickly. Please wait a little and try again.';
    case 'not-allowed': return 'You can’t change your background right now.';
    case 'unavailable': return 'Picture storage isn’t available right now. Try again later, or pick a galaxy instead.';
    default: return 'Couldn’t upload that picture. Please try again.';
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

/** Shrinks a chosen picture to a still JPEG of at most UPLOAD_MAX_SIDE pixels. Returns null if it is not a readable picture. */
export async function prepareBackgroundImage(file: Blob): Promise<Blob | null> {
  if (!ACCEPTED_TYPES.includes(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    // Re-encoding from the canvas also drops camera metadata (the server removes it again regardless).
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= UPLOAD_MAX_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

/** Uploads a prepared picture. It is not on the profile (and nobody else can see it) until the profile is saved with the returned id. */
export async function uploadBackgroundImage(blob: Blob): Promise<UploadOutcome> {
  if (!ACCEPTED_TYPES.includes(blob.type)) return { ok: false, reason: 'type' };
  if (blob.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'too-large' };
  try {
    const image = toBase64(new Uint8Array(await blob.arrayBuffer()));
    const response = await call('/api/signals', { action: 'bg-image-set', image });
    if (!response) return { ok: false, reason: 'failed' };
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { image?: unknown } | null;
      return typeof data?.image === 'string' && IMAGE_ID.test(data.image) ? { ok: true, image: data.image } : { ok: false, reason: 'failed' };
    }
    const status = response.status;
    if (status === 413) return { ok: false, reason: 'too-large' };
    if (status === 429) return { ok: false, reason: 'rate-limited' };
    if (status === 403) return { ok: false, reason: 'not-allowed' };
    if (status === 503) return { ok: false, reason: 'unavailable' };
    if (status === 400) return { ok: false, reason: 'type' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** After a profile save: have the server delete every uploaded picture except the one now on the profile. Best effort, safe to repeat. */
export async function pruneBackgroundImages(): Promise<void> {
  try {
    await call('/api/signals', { action: 'bg-image-prune' });
  } catch {
    /* the next save tries again */
  }
}

const cache = new Map<string, { id: string; url: string }>();

export function clearBackgroundImageCache(): void {
  for (const { url } of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

/** The picture saved on a member’s profile as a blob URL (or null when it can’t be shown). Remembered per member and picture id. */
export async function fetchBackgroundImage(memberId: string, imageId: string): Promise<string | null> {
  const hit = cache.get(memberId);
  if (hit && hit.id === imageId) return hit.url;
  try {
    const response = await call(`/api/signals?view=background-image&memberId=${encodeURIComponent(memberId)}`);
    if (!response || !response.ok) return null;
    const data = (await response.json()) as { image?: unknown; contentType?: unknown; id?: unknown };
    if (typeof data.image !== 'string' || typeof data.contentType !== 'string' || !ACCEPTED_TYPES.includes(data.contentType) || data.id !== imageId) return null;
    const bytes = Uint8Array.from(atob(data.image), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
    if (hit) URL.revokeObjectURL(hit.url);
    cache.set(memberId, { id: imageId, url });
    return url;
  } catch {
    return null;
  }
}
