import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from '../lib/firebase.ts';
import { kindAllowsReplies, kindInfo, toUnsaidKind, type UnsaidKind } from '../utils/echoKinds.ts';
import { loadMyReplyIds, toUnsaidPost, type UnsaidPost } from './unsaidService.ts';

/**
 * Echo Notifications: a private list for the author of an Echo (separate from the Signals inbox).
 *
 * How it works, with no server code: replies and reactions are public and anonymous, but only the author's own device knows which
 * Echoes are theirs (unsaid_owners, readable only by them). So the author's device notices what is new on their own Echoes and
 * records a notification in a place only they can read: echo_notifications/{uid}/items/{id}. Firestore rules check every one
 * against the real data (the reply or the counter must exist, the Echo must be the writer's own, a reply by the writer themselves
 * never counts) and the id is derived from the event, so the same event can only ever have one notification. Nothing in a
 * notification, or anywhere public, says who replied or who reacted.
 *
 * Kinds of notification: a reply (Need Advice and Uplift categories only), and an engagement milestone (total reactions on an Echo
 * reaching 10, 25, 50 or 100). "Comfort received" is not built: there is no Send Comfort in the app.
 */

export const ECHO_NOTIFICATION_PAGE = 20;
export const ECHO_MILESTONES = [10, 25, 50, 100] as const;
const PREVIEW_MAX = 80;
const WATCH_CHUNK = 30; // Firestore's limit for an "in" query
const WATCH_MAX_CHUNKS = 10;
const REACTION_COUNTERS = ['hugs', 'same', 'felt', 'strong', 'proud', 'cry'] as const;

export type EchoNotificationType = 'reply' | 'milestone';

export interface EchoNotification {
  id: string;
  type: EchoNotificationType;
  postId: string;
  kind: UnsaidKind;
  /** A short, safe piece of the reply (replies are already checked for names, links and numbers); empty for milestones. */
  preview: string;
  threshold: number | null;
  /** When it happened: the reply's own time for a reply, the time the notification was made for a milestone. */
  at: number;
  /** When the notification was recorded; the list is ordered by this. */
  createdAt: number;
  read: boolean;
}

export interface EchoNotificationPrefs {
  replies: boolean;
  milestones: boolean;
}
export const DEFAULT_ECHO_PREFS: EchoNotificationPrefs = { replies: true, milestones: true };

// ----------------------------------------------------------------------------------------------------------------- pure helpers

const ms = (value: unknown): number => (value && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis: () => number }).toMillis() : 0);

export const reactionTotal = (data: Record<string, unknown>): number =>
  REACTION_COUNTERS.reduce((sum, key) => sum + Math.max(0, Math.floor(Number(data[key]) || 0)), 0);

/** The biggest milestone a total has reached, or null. Only this one is ever announced, so a jump never causes a burst. */
export function highestMilestone(total: number): number | null {
  let best: number | null = null;
  for (const m of ECHO_MILESTONES) if (total >= m) best = m;
  return best;
}

export const replyNotificationId = (replyId: string) => `reply_${replyId}`;
export const milestoneNotificationId = (postId: string, threshold: number) => `milestone_${postId}_${threshold}`;

/** A reply, cut down for the notification. */
export function replyPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : flat;
}

export function toEchoNotification(id: string, data: Record<string, unknown>): EchoNotification {
  const createdAt = ms(data.createdAt);
  return {
    id,
    type: data.type === 'milestone' ? 'milestone' : 'reply',
    postId: String(data.postId ?? ''),
    kind: toUnsaidKind(data.kind),
    preview: typeof data.preview === 'string' ? data.preview : '',
    threshold: typeof data.threshold === 'number' ? data.threshold : null,
    at: ms(data.eventAt) || createdAt,
    createdAt,
    read: data.read === true,
  };
}

/** What the list shows for a notification. */
export function notificationText(n: Pick<EchoNotification, 'type' | 'kind' | 'preview' | 'threshold'>): { title: string; body: string } {
  const label = kindInfo(n.kind).label;
  if (n.type === 'milestone') {
    return { title: `Your ${label} reached ${n.threshold ?? 0} reactions`, body: 'People are feeling what you shared.' };
  }
  return { title: `New reply on your ${label}`, body: n.preview ? `“${n.preview}”` : 'Someone replied.' };
}

export const unreadCount = (items: readonly EchoNotification[]) => items.filter((n) => !n.read).length;

/** Newest first, no repeats; used to join the live first page with older pages loaded on request. */
export function mergeNotifications(...lists: readonly EchoNotification[][]): EchoNotification[] {
  const byId = new Map<string, EchoNotification>();
  for (const list of lists) for (const n of list) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

// --------------------------------------------------------------------------------------------------------------------- reading

async function currentUid(): Promise<string | null> {
  const user = auth?.currentUser ?? (await ensureAnonymousAuth());
  return user?.uid ?? null;
}

/** The first page, live. */
export function subscribeToEchoNotifications(onItems: (items: EchoNotification[], info: { hasMore: boolean }) => void, onError: () => void = () => {}): () => void {
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let stop: (() => void) | null = null;
  currentUid().then((uid) => {
    if (cancelled || !uid) return;
    stop = onSnapshot(
      query(collection(firestore, 'echo_notifications', uid, 'items'), orderBy('createdAt', 'desc'), limit(ECHO_NOTIFICATION_PAGE)),
      // A notification still being written has no server time yet; it shows up the moment it does.
      (snap) => onItems(snap.docs.filter((d) => !d.metadata.hasPendingWrites || d.data().createdAt).map((d) => toEchoNotification(d.id, d.data())), { hasMore: snap.size >= ECHO_NOTIFICATION_PAGE }),
      (err) => {
        console.warn('[Echo notifications] Feed notice:', err);
        onError();
      }
    );
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** The next page of older notifications, starting just before `before` (a createdAt in ms). */
export async function loadOlderEchoNotifications(before: number): Promise<{ items: EchoNotification[]; hasMore: boolean } | null> {
  if (!db) return null;
  try {
    const uid = await currentUid();
    if (!uid) return null;
    const snap = await getDocs(
      query(collection(db, 'echo_notifications', uid, 'items'), where('createdAt', '<', Timestamp.fromMillis(before)), orderBy('createdAt', 'desc'), limit(ECHO_NOTIFICATION_PAGE))
    );
    return { items: snap.docs.map((d) => toEchoNotification(d.id, d.data())), hasMore: snap.size >= ECHO_NOTIFICATION_PAGE };
  } catch (err) {
    console.warn('[Echo notifications] Could not load older:', err);
    return null;
  }
}

/** One Echo by id, for opening it from a notification when it is not on screen. Null when it is gone. */
export async function fetchUnsaidPost(postId: string): Promise<UnsaidPost | null> {
  if (!db || !postId) return null;
  try {
    const snap = await getDoc(doc(db, 'unsaid', postId));
    return snap.exists() ? toUnsaidPost(snap.id, snap.data()) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------------ read state

export async function markEchoNotificationRead(id: string): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    await setDocUpdateRead(uid, [id]);
    return true;
  } catch {
    return false;
  }
}

async function setDocUpdateRead(uid: string, ids: string[]) {
  if (!db || ids.length === 0) return;
  const batch = writeBatch(db);
  for (const id of ids) batch.update(doc(db, 'echo_notifications', uid, 'items', id), { read: true });
  await batch.commit();
}

/** Everything unread, not only what is on screen. */
export async function markAllEchoNotificationsRead(): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    for (let round = 0; round < 5; round++) {
      const snap = await getDocs(query(collection(db, 'echo_notifications', uid, 'items'), where('read', '==', false), limit(400)));
      if (snap.empty) break;
      await setDocUpdateRead(uid, snap.docs.map((d) => d.id));
      if (snap.size < 400) break;
    }
    return true;
  } catch {
    return false;
  }
}

/** The author has read the replies on an Echo, so that Echo's reply notifications are read too (milestones are left alone). */
export async function markPostReplyNotificationsRead(postId: string): Promise<void> {
  if (!db) return;
  try {
    const uid = await currentUid();
    if (!uid) return;
    const snap = await getDocs(query(collection(db, 'echo_notifications', uid, 'items'), where('postId', '==', postId), where('read', '==', false)));
    await setDocUpdateRead(uid, snap.docs.filter((d) => d.data().type === 'reply').map((d) => d.id));
  } catch {
    // Nothing to mark, or offline.
  }
}

// ----------------------------------------------------------------------------------------------------------------- preferences

export function subscribeToEchoPrefs(onPrefs: (prefs: EchoNotificationPrefs) => void): () => void {
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let stop: (() => void) | null = null;
  currentUid().then((uid) => {
    if (cancelled || !uid) return;
    stop = onSnapshot(
      doc(firestore, 'echo_notifications', uid),
      (snap) => onPrefs({ replies: snap.data()?.replies !== false, milestones: snap.data()?.milestones !== false }),
      () => {}
    );
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

export async function saveEchoPrefs(prefs: EchoNotificationPrefs): Promise<boolean> {
  if (!db) return false;
  try {
    const uid = await currentUid();
    if (!uid) return false;
    await setDoc(doc(db, 'echo_notifications', uid), { replies: prefs.replies, milestones: prefs.milestones });
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------------------------------------- noticing what is new

/** A member's own Echo, as far as the notifier needs to know. */
export interface OwnEcho {
  id: string;
  kind: UnsaidKind;
  replyCount: number;
  seenReplies: number;
  reactions: number;
}

/** Calls `onChange` with the member's own Echoes (every category) whenever their counters change. */
export function watchOwnEchoes(onChange: (echoes: OwnEcho[]) => void): () => void {
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let stopOwners: (() => void) | null = null;
  let stopPosts: Array<() => void> = [];
  let seen = new Map<string, number>();
  let posts = new Map<string, OwnEcho>();
  let idsKey = '';
  let expected = 0;
  const ready = new Set<number>();

  const emit = () => {
    if (cancelled || ready.size < expected) return;
    onChange([...posts.values()].map((p) => ({ ...p, seenReplies: seen.get(p.id) ?? 0 })));
  };

  currentUid().then((uid) => {
    if (cancelled || !uid) return;
    stopOwners = onSnapshot(
      query(collection(firestore, 'unsaid_owners'), where('authorId', '==', uid)),
      (snap) => {
        seen = new Map(snap.docs.map((d) => [d.id, Math.max(0, Math.floor(Number(d.data().seenReplies) || 0))] as const));
        const ids = [...seen.keys()].sort();
        const key = ids.join(',');
        if (key !== idsKey) {
          idsKey = key;
          stopPosts.forEach((stop) => stop());
          stopPosts = [];
          posts = new Map();
          ready.clear();
          const usable = ids.slice(0, WATCH_CHUNK * WATCH_MAX_CHUNKS);
          expected = Math.ceil(usable.length / WATCH_CHUNK);
          for (let i = 0; i < usable.length; i += WATCH_CHUNK) {
            const chunk = usable.slice(i, i + WATCH_CHUNK);
            const index = i / WATCH_CHUNK;
            stopPosts.push(
              onSnapshot(
                query(collection(firestore, 'unsaid'), where(documentId(), 'in', chunk)),
                (postsSnap) => {
                  for (const id of chunk) posts.delete(id);
                  postsSnap.docs.forEach((d) => {
                    const data = d.data();
                    posts.set(d.id, {
                      id: d.id,
                      kind: toUnsaidKind(data.kind),
                      replyCount: Math.max(0, Math.floor(Number(data.replyCount) || 0)),
                      seenReplies: 0,
                      reactions: reactionTotal(data),
                    });
                  });
                  ready.add(index);
                  emit();
                },
                (err) => console.warn('[Echo notifications] Watch notice:', err)
              )
            );
          }
        }
        emit();
      },
      (err) => console.warn('[Echo notifications] Watch notice:', err)
    );
  });

  return () => {
    cancelled = true;
    stopOwners?.();
    stopPosts.forEach((stop) => stop());
  };
}

// What this device has already looked into, so a counter that has not moved is not looked into again.
const looked = new Set<string>();

/**
 * Records a notification for each new reply and milestone on the member's own Echoes. Safe to call as often as the counters
 * change: ids come from the event itself, so repeating it can never make a second notification, and the rules would refuse one.
 */
export async function syncEchoNotifications(echoes: readonly OwnEcho[], prefs: EchoNotificationPrefs): Promise<void> {
  if (!db) return;
  const firestore = db;
  const uid = await currentUid();
  if (!uid) return;
  const item = (id: string) => doc(firestore, 'echo_notifications', uid, 'items', id);

  for (const echo of echoes) {
    try {
      // New replies (Need Advice and Uplift only): every reply the author has not yet seen.
      const unseen = echo.replyCount - echo.seenReplies;
      if (prefs.replies && kindAllowsReplies(echo.kind) && unseen > 0 && !looked.has(`r:${echo.id}:${echo.replyCount}:${echo.seenReplies}`)) {
        looked.add(`r:${echo.id}:${echo.replyCount}:${echo.seenReplies}`);
        const [replies, mine] = await Promise.all([
          getDocs(query(collection(firestore, 'unsaid', echo.id, 'replies'), orderBy('createdAt', 'desc'), limit(Math.min(unseen, ECHO_NOTIFICATION_PAGE)))),
          loadMyReplyIds(echo.id),
        ]);
        const own = new Set(mine);
        for (const reply of replies.docs) {
          if (own.has(reply.id)) continue; // never a notification for one's own reply
          const ref = item(replyNotificationId(reply.id));
          if ((await getDoc(ref)).exists()) continue;
          await setDoc(ref, {
            type: 'reply',
            postId: echo.id,
            kind: echo.kind,
            replyId: reply.id,
            preview: replyPreview(String(reply.data().text ?? '')),
            eventAt: reply.data().createdAt,
            createdAt: serverTimestamp(),
            read: false,
          });
        }
      }

      // Engagement milestone: total reactions reaching 10, 25, 50 or 100, announced once each.
      const milestone = highestMilestone(echo.reactions);
      if (prefs.milestones && milestone !== null && !looked.has(`m:${echo.id}:${milestone}`)) {
        looked.add(`m:${echo.id}:${milestone}`);
        const ref = item(milestoneNotificationId(echo.id, milestone));
        if (!(await getDoc(ref)).exists()) {
          await setDoc(ref, { type: 'milestone', postId: echo.id, kind: echo.kind, threshold: milestone, createdAt: serverTimestamp(), read: false });
        }
      }
    } catch (err) {
      // Rules refused it (the reply or the Echo is gone, or it is one's own reply) or we are offline: nothing to record.
      looked.delete(`r:${echo.id}:${echo.replyCount}:${echo.seenReplies}`);
      console.warn('[Echo notifications] Skipped one:', (err as { code?: string })?.code ?? err);
    }
  }
}

/** For tests: forget what this device has looked into. */
export const resetEchoNotificationMemory = () => looked.clear();
