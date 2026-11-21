import { auth } from '../lib/firebase.ts';
import { prepareSupportImage, SUPPORT_IMAGE_TYPES } from './supportImageService.ts';
import type { AtlasFailure, AtlasMemory, DisplayIdentity, Engagement, MapBounds, ReactionKind } from '../utils/atlas.ts';

/**
 * ATLAS client. Everything goes through /api/atlas (api/_atlas.js), which decides who may see or change each memory; the app never
 * reads the memories collection directly (Firestore denies it). Photos are shrunk on the device by the same routine Support Chat uses.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface MemoryDraft {
  /** Optional: the composer no longer asks for one (older memories keep theirs). */
  title?: string;
  text: string;
  date: string;
  lat: number;
  lng: number;
  displayIdentity: DisplayIdentity;
}

export type AtlasResult<T> = ({ ok: true } & T) | { ok: false; reason: AtlasFailure };

async function request(path: string, body?: Record<string, unknown>): Promise<Response | null> {
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

export function failureFor(status: number, code?: string): AtlasFailure {
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  if (status === 503) return 'unavailable';
  if (status === 403) return code === 'account_unavailable' ? 'suspended' : 'not-allowed';
  if (status === 400 && code === 'content_not_allowed') return 'content';
  if (status === 400 && code === 'invalid_identity') return 'identity';
  if (status === 400 && code === 'invalid_image') return 'type';
  return 'failed';
}

async function send<T>(body: Record<string, unknown>, pick: (data: Record<string, unknown>) => T | null): Promise<AtlasResult<{ value: T }>> {
  try {
    const response = await request('/api/atlas', body);
    if (!response) return { ok: false, reason: 'failed' };
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return { ok: false, reason: failureFor(response.status, typeof data.error === 'string' ? data.error : undefined) };
    const value = pick(data);
    return value === null ? { ok: false, reason: 'failed' } : { ok: true, value };
  } catch {
    return { ok: false, reason: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed' };
  }
}

const asMemory = (data: Record<string, unknown>): AtlasMemory | null => (data.memory && typeof data.memory === 'object' ? (data.memory as AtlasMemory) : null);

const asEngagement = (data: Record<string, unknown>): Engagement | null => {
  const e = data.engagement as Partial<Engagement> | undefined;
  if (!e || typeof e !== 'object') return null;
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return { views: n(e.views), hugs: n(e.hugs), hearts: n(e.hearts), mine: e.mine === 'hug' || e.mine === 'heart' ? e.mine : null };
};

/** The member opened a memory's card: counts their first open as one view and returns the totals with their own reaction. */
export function openMemory(id: string) {
  return send({ action: 'view', id }, asEngagement);
}

/** The member's one reaction to a memory: 'hug', 'heart', or null to take it back. */
export function reactToMemory(id: string, kind: ReactionKind | null) {
  return send({ action: 'react', id, kind }, asEngagement);
}

/** `recent` is the Recent Memories preview: the newest few community memories from the last 24 hours (the map still shows every memory). */
export function listMemories(scope: 'mine' | 'community' | 'recent', bounds?: MapBounds) {
  return send({ action: 'list', scope, ...(bounds ? { bounds } : {}) }, (data) =>
    Array.isArray(data.memories) ? { memories: data.memories as AtlasMemory[], truncated: data.truncated === true } : null);
}

const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

/** Shrinks a chosen picture and encodes it for the server. null means it is not a readable JPEG, PNG or WebP. */
export async function encodePhoto(file: Blob): Promise<string | null> {
  if (!SUPPORT_IMAGE_TYPES.includes(file.type)) return null;
  const blob = await prepareSupportImage(file);
  return blob ? toBase64(new Uint8Array(await blob.arrayBuffer())) : null;
}

export function createMemory(draft: MemoryDraft, photo: string | null, id: string) {
  return send({ action: 'create', id, ...draft, ...(photo ? { photo } : {}) }, asMemory);
}

export function updateMemory(id: string, changes: Partial<MemoryDraft> & { photo?: string; removePhoto?: boolean }) {
  return send({ action: 'update', id, ...changes }, asMemory);
}

export function deleteMemory(id: string) {
  return send({ action: 'delete', id }, (data) => (data.deleted === true ? true : null));
}

const photoCache = new Map<string, string>();
const photoInFlight = new Map<string, Promise<string | null>>();
/** Pictures are fetched a couple at a time, so a row of previews never piles requests onto the server at once. */
let photoSlots = 2;
const photoWaiting: Array<() => void> = [];
const takePhotoSlot = (): Promise<void> => (photoSlots > 0 ? (photoSlots -= 1, Promise.resolve()) : new Promise((resolve) => photoWaiting.push(resolve)));
const freePhotoSlot = () => { const next = photoWaiting.shift(); if (next) next(); else photoSlots += 1; };

/** One memory photo as a blob URL (null when it can't be shown), remembered for this session. Asking twice at once is one request. */
export function fetchMemoryPhoto(id: string): Promise<string | null> {
  const hit = photoCache.get(id);
  if (hit) return Promise.resolve(hit);
  const pending = photoInFlight.get(id);
  if (pending) return pending;
  const run = (async () => {
    await takePhotoSlot();
    try { return await loadMemoryPhoto(id); } finally { freePhotoSlot(); photoInFlight.delete(id); }
  })();
  photoInFlight.set(id, run);
  return run;
}

async function loadMemoryPhoto(id: string): Promise<string | null> {
  try {
    const response = await request(`/api/atlas?view=photo&id=${encodeURIComponent(id)}`);
    if (!response || !response.ok) return null;
    const data = (await response.json()) as { image?: unknown; contentType?: unknown };
    if (typeof data.image !== 'string' || typeof data.contentType !== 'string' || !SUPPORT_IMAGE_TYPES.includes(data.contentType)) return null;
    const bytes = Uint8Array.from(atob(data.image), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
    photoCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}

/** Forget a cached photo (after it was replaced or removed). */
export function forgetMemoryPhoto(id: string): void {
  const url = photoCache.get(id);
  if (url) URL.revokeObjectURL(url);
  photoCache.delete(id);
}
