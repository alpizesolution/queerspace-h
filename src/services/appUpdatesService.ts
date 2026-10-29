import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';

/**
 * "What's New": app_updates/{id} is written by admins only; members read published ones.
 * Which updates a member has opened lives in app_update_reads/{uid} (firestore.rules, "APP UPDATES").
 */

export const APP_UPDATE_CATEGORIES = [
  { id: 'feature', label: 'New Feature' },
  { id: 'improvement', label: 'Improvement' },
  { id: 'fix', label: 'Bug Fix' },
  { id: 'announcement', label: 'Community Announcement' },
] as const;

export type AppUpdateCategory = (typeof APP_UPDATE_CATEGORIES)[number]['id'];
export type AppUpdateStatus = 'draft' | 'published';

/** These limits must match appUpdateValid() in firestore.rules. */
export const APP_UPDATE_TITLE_MIN = 3;
export const APP_UPDATE_TITLE_MAX = 80;
export const APP_UPDATE_BODY_MAX = 500;
export const APP_UPDATE_LINK_URL_MAX = 300;
export const APP_UPDATE_LINK_LABEL_MAX = 30;
/** Updates loaded per page; the unread dot looks at the newest page only. */
export const APP_UPDATES_PAGE_SIZE = 20;
/** Reads are kept as one map per member; must match the size cap in firestore.rules. */
export const APP_UPDATE_READS_MAX = 200;

export interface AppUpdateLink {
  url: string;
  label: string;
}

export interface AppUpdate {
  id: string;
  title: string;
  body: string;
  category: AppUpdateCategory;
  status: AppUpdateStatus;
  link: AppUpdateLink | null;
  createdAt: number;
  updatedAt: number;
  /** Set when published; kept (not shown to members) after an unpublish. */
  publishedAt: number | null;
}

export interface AppUpdateInput {
  title: string;
  body: string;
  category: string;
  linkUrl?: string;
  linkLabel?: string;
}

export interface CleanAppUpdate {
  title: string;
  body: string;
  category: AppUpdateCategory;
  link: AppUpdateLink | null;
}

export type AppUpdateValidation = { ok: true; value: CleanAppUpdate } | { ok: false; error: string };

export function categoryLabel(category: string): string {
  return APP_UPDATE_CATEGORIES.find((c) => c.id === category)?.label ?? 'Update';
}

/** Only plain https links are accepted; anything else is rejected rather than rewritten. */
export function normalizeAppUpdateLink(url: string, label: string): AppUpdateLink | null | 'invalid' {
  const rawUrl = url.trim();
  const rawLabel = label.trim();
  if (!rawUrl && !rawLabel) return null;
  if (!rawUrl || !rawLabel) return 'invalid';
  if (rawUrl.length > APP_UPDATE_LINK_URL_MAX || rawLabel.length > APP_UPDATE_LINK_LABEL_MAX) return 'invalid';
  if (/\s/.test(rawUrl)) return 'invalid';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return 'invalid';
  } catch {
    return 'invalid';
  }
  return { url: rawUrl, label: rawLabel };
}

/** Trims and checks admin input. Text is stored as-is and rendered as plain text, never as HTML. */
export function validateAppUpdate(input: AppUpdateInput): AppUpdateValidation {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < APP_UPDATE_TITLE_MIN || title.length > APP_UPDATE_TITLE_MAX) {
    return { ok: false, error: `Title needs ${APP_UPDATE_TITLE_MIN}–${APP_UPDATE_TITLE_MAX} characters.` };
  }
  if (!body || body.length > APP_UPDATE_BODY_MAX) {
    return { ok: false, error: `Description needs 1–${APP_UPDATE_BODY_MAX} characters.` };
  }
  const category = APP_UPDATE_CATEGORIES.find((c) => c.id === input.category)?.id;
  if (!category) return { ok: false, error: 'Pick a category.' };
  const link = normalizeAppUpdateLink(input.linkUrl ?? '', input.linkLabel ?? '');
  if (link === 'invalid') {
    return { ok: false, error: `A link needs an https:// address and a label of up to ${APP_UPDATE_LINK_LABEL_MAX} characters.` };
  }
  return { ok: true, value: { title, body, category, link } };
}

/** Ids of updates the member has not opened yet. */
export function unreadUpdateIds(updates: Pick<AppUpdate, 'id' | 'status'>[], readIds: ReadonlySet<string>): string[] {
  return updates.filter((u) => u.status === 'published' && !readIds.has(u.id)).map((u) => u.id);
}

type RawDoc = { id: string; data: () => Record<string, unknown> };

const millis = (value: unknown): number | null => (value instanceof Timestamp ? value.toMillis() : null);

/** Returns null for a document that does not look like an update, so one bad row cannot break the list. */
export function toAppUpdate(snap: RawDoc): AppUpdate | null {
  const d = snap.data();
  const category = APP_UPDATE_CATEGORIES.find((c) => c.id === d.category)?.id;
  const status = d.status === 'published' || d.status === 'draft' ? d.status : null;
  if (typeof d.title !== 'string' || typeof d.body !== 'string' || !category || !status) return null;
  const link = d.link as Partial<AppUpdateLink> | undefined;
  return {
    id: snap.id,
    title: d.title,
    body: d.body,
    category,
    status,
    link: link && typeof link.url === 'string' && typeof link.label === 'string' ? { url: link.url, label: link.label } : null,
    createdAt: millis(d.createdAt) ?? 0,
    updatedAt: millis(d.updatedAt) ?? 0,
    publishedAt: millis(d.publishedAt),
  };
}

export interface PublishedPage {
  items: AppUpdate[];
  /** Pass to the next call to load older updates; null when there are no more. */
  nextBefore: number | null;
}

/** Published updates, newest first. Drafts are never requested (and the rules would refuse them). */
export async function loadPublishedUpdates(before?: number): Promise<PublishedPage> {
  if (!db) return { items: [], nextBefore: null };
  const base = [where('status', '==', 'published'), orderBy('publishedAt', 'desc')];
  const q = query(
    collection(db, 'app_updates'),
    ...base,
    ...(before ? [startAfter(Timestamp.fromMillis(before))] : []),
    limit(APP_UPDATES_PAGE_SIZE),
  );
  const snap = await getDocs(q);
  const items = snap.docs.map(toAppUpdate).filter((u): u is AppUpdate => u !== null && u.status === 'published');
  const last = items[items.length - 1];
  return { items, nextBefore: snap.size === APP_UPDATES_PAGE_SIZE && last?.publishedAt ? last.publishedAt : null };
}

async function currentUid(): Promise<string | null> {
  return (auth?.currentUser ?? (await ensureAnonymousAuth()))?.uid ?? null;
}

/** Ids this member has opened. Only their own document is ever read. */
export async function loadReadIds(): Promise<Set<string>> {
  if (!db) return new Set();
  const uid = await currentUid();
  if (!uid) return new Set();
  const snap = await getDoc(doc(db, 'app_update_reads', uid));
  const reads = snap.exists() ? snap.data().reads : null;
  return new Set(reads && typeof reads === 'object' ? Object.keys(reads) : []);
}

/** Marks exactly one update as read; other updates are left alone. */
export async function markUpdateRead(updateId: string): Promise<void> {
  if (!db) return;
  const uid = await currentUid();
  if (!uid) return;
  await setDoc(
    doc(db, 'app_update_reads', uid),
    { reads: { [updateId]: true }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ---------------------------------------------------------------- admin

/** Admin list: every update, drafts included, most recently edited first. */
export async function loadAllUpdates(): Promise<AppUpdate[]> {
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'app_updates'), orderBy('updatedAt', 'desc'), limit(100)));
  return snap.docs.map(toAppUpdate).filter((u): u is AppUpdate => u !== null);
}

/**
 * Saves a draft, or saves-and-publishes. Publishing a draft stamps a new date; editing something
 * that is already published keeps its date, and unpublishing keeps it too (it is never shown to members).
 * Existing documents are updated in place so createdAt and publishedAt keep their exact stored values.
 */
export async function saveAppUpdate(
  existing: AppUpdate | null,
  value: CleanAppUpdate,
  publish: boolean,
): Promise<string> {
  if (!db) throw new Error('Firebase is not configured');
  const status: AppUpdateStatus = publish ? 'published' : 'draft';
  const fields = { title: value.title, body: value.body, category: value.category, status, updatedAt: serverTimestamp() };
  if (!existing) {
    const ref = doc(collection(db, 'app_updates'));
    await setDoc(ref, {
      ...fields,
      ...(value.link ? { link: value.link } : {}),
      createdAt: serverTimestamp(),
      publishedAt: publish ? serverTimestamp() : null,
    });
    return ref.id;
  }
  const ref = doc(db, 'app_updates', existing.id);
  const restamp = publish && existing.status !== 'published';
  await updateDoc(ref, {
    ...fields,
    link: value.link ?? deleteField(),
    ...(restamp ? { publishedAt: serverTimestamp() } : {}),
  });
  return ref.id;
}

export async function setAppUpdatePublished(update: AppUpdate, publish: boolean): Promise<void> {
  await saveAppUpdate(
    update,
    { title: update.title, body: update.body, category: update.category, link: update.link },
    publish,
  );
}

export async function deleteDraftUpdate(id: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  await deleteDoc(doc(db, 'app_updates', id));
}
