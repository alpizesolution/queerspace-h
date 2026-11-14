import { auth } from '../lib/firebase.ts';

/**
 * Pictures in Support Chat (api/_supportImages.js): no timer, they stay in the conversation for the member and the team. The picture
 * is shrunk on the device, sent to the server (which checks the real file and stores it privately), and shown from the server through
 * a permission-checked request, never a public link.
 */

const REQUEST_TIMEOUT_MS = 30_000;
export const SUPPORT_IMAGE_MAX_BYTES = 3_000_000;
export const SUPPORT_IMAGE_MAX_SIDE = 2000;
export const SUPPORT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type SupportImageFailure = 'type' | 'too-large' | 'rate-limited' | 'not-allowed' | 'unavailable' | 'failed';
export type SupportImageOutcome = { ok: true; id: string } | { ok: false; reason: SupportImageFailure };

export function supportImageProblemText(reason: SupportImageFailure): string {
  switch (reason) {
    case 'type': return 'Please choose a JPEG, PNG or WebP picture.';
    case 'too-large': return 'That picture is too large. Try a smaller one.';
    case 'rate-limited': return 'You’re sending pictures very quickly. Please wait a little and try again.';
    case 'not-allowed': return 'You can’t send a picture here.';
    case 'unavailable': return 'Picture sending isn’t available right now. You can still write to us.';
    default: return 'Couldn’t send that picture. Please try again.';
  }
}

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

/** Shrinks a chosen picture to a JPEG of at most 2000 px and 3 MB (the server limit). Returns null if it is not a readable picture. */
export async function prepareSupportImage(file: Blob): Promise<Blob | null> {
  if (!SUPPORT_IMAGE_TYPES.includes(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SUPPORT_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    for (const quality of [0.88, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= SUPPORT_IMAGE_MAX_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

/**
 * Sends a prepared picture into a support conversation: the member's own (no threadId) or, for an admin, a member's thread. `messageId`
 * is chosen by the caller and kept across retries, so a repeat can never make a second message.
 */
export async function sendSupportImage(blob: Blob, messageId: string, threadId?: string): Promise<SupportImageOutcome> {
  if (!SUPPORT_IMAGE_TYPES.includes(blob.type)) return { ok: false, reason: 'type' };
  if (blob.size > SUPPORT_IMAGE_MAX_BYTES) return { ok: false, reason: 'too-large' };
  try {
    const image = toBase64(new Uint8Array(await blob.arrayBuffer()));
    const response = await call('/api/signals', { action: 'support-image-send', image, messageId, ...(threadId ? { threadId } : {}) });
    if (!response) return { ok: false, reason: 'failed' };
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
      return typeof data?.id === 'string' ? { ok: true, id: data.id } : { ok: false, reason: 'failed' };
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

const cache = new Map<string, string>();

/** One support picture as a blob URL (or null when it can't be shown), remembered for this session. */
export async function fetchSupportImage(threadId: string, messageId: string): Promise<string | null> {
  const key = `${threadId}/${messageId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const response = await call(`/api/signals?view=support-image&threadId=${encodeURIComponent(threadId)}&messageId=${encodeURIComponent(messageId)}`);
    if (!response || !response.ok) return null;
    const data = (await response.json()) as { image?: unknown; contentType?: unknown };
    if (typeof data.image !== 'string' || typeof data.contentType !== 'string' || !SUPPORT_IMAGE_TYPES.includes(data.contentType)) return null;
    const bytes = Uint8Array.from(atob(data.image), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
