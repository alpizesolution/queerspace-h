import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ECHO_PREFS,
  loadOlderEchoNotifications,
  markAllEchoNotificationsRead,
  markEchoNotificationRead,
  markPostReplyNotificationsRead,
  mergeNotifications,
  saveEchoPrefs,
  subscribeToEchoNotifications,
  subscribeToEchoPrefs,
  syncEchoNotifications,
  unreadCount,
  watchOwnEchoes,
  type EchoNotification,
  type EchoNotificationPrefs,
  type OwnEcho,
} from '../services/echoNotificationService.ts';

/**
 * The member's Echo Notifications: the list (live first page, older pages on request), what is unread, read/unread changes and
 * the three small preferences. It also keeps the list up to date by noticing new replies and milestones on the member's own
 * Echoes (see services/echoNotificationService.ts). Shared by App (the Echoes tab count) and the Echoes screen (the list).
 */
export function useEchoNotifications(enabled: boolean) {
  const [live, setLive] = useState<EchoNotification[]>([]);
  const [older, setOlder] = useState<EchoNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prefs, setPrefsState] = useState<EchoNotificationPrefs>(DEFAULT_ECHO_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const lastEchoes = useRef<OwnEcho[]>([]);
  const prefsLoaded = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const stopList = subscribeToEchoNotifications((items, info) => {
      setLive(items);
      setLoaded(true);
      // Only the first answer decides whether there is more beyond the live page; older pages carry their own flag.
      setHasMore((current) => (older.length > 0 ? current : info.hasMore));
    });
    const stopPrefs = subscribeToEchoPrefs((next) => {
      prefsLoaded.current = true;
      setPrefsState(next);
    });
    const stopWatch = watchOwnEchoes((echoes) => {
      lastEchoes.current = echoes;
      void syncEchoNotifications(echoes, prefsRef.current);
    });
    return () => {
      stopList();
      stopPrefs();
      stopWatch();
      setLive([]);
      setOlder([]);
      setLoaded(false);
    };
    // `older` is only read to keep the "more" flag; it must not restart the subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Turning a kind on again records what is waiting for it.
  useEffect(() => {
    if (enabled && prefsLoaded.current && lastEchoes.current.length > 0) void syncEchoNotifications(lastEchoes.current, prefs);
  }, [enabled, prefs.replies, prefs.milestones]);

  const items = mergeNotifications(live, older);
  const unread = unreadCount(items);

  const patchRead = (predicate: (n: EchoNotification) => boolean) => {
    const apply = (list: EchoNotification[]) => list.map((n) => (predicate(n) ? { ...n, read: true } : n));
    setLive(apply);
    setOlder(apply);
  };

  const markRead = useCallback((id: string) => {
    patchRead((n) => n.id === id);
    void markEchoNotificationRead(id);
  }, []);

  const markAllRead = useCallback(() => {
    patchRead(() => true);
    void markAllEchoNotificationsRead();
  }, []);

  /** The author has read the replies on this Echo. */
  const markPostRead = useCallback((postId: string) => {
    patchRead((n) => n.postId === postId && n.type === 'reply');
    void markPostReplyNotificationsRead(postId);
  }, []);

  const loadMore = useCallback(async () => {
    const all = mergeNotifications(live, older);
    const oldest = all[all.length - 1];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const page = await loadOlderEchoNotifications(oldest.createdAt);
    setLoadingMore(false);
    if (!page) return;
    setOlder((current) => mergeNotifications(current, page.items));
    setHasMore(page.hasMore);
  }, [live, older, loadingMore]);

  const setPrefs = useCallback((next: EchoNotificationPrefs) => {
    setPrefsState(next);
    void saveEchoPrefs(next);
  }, []);

  return { items, unread, loaded, hasMore, loadingMore, prefs, setPrefs, markRead, markAllRead, markPostRead, loadMore };
}

export type EchoNotificationsApi = ReturnType<typeof useEchoNotifications>;
