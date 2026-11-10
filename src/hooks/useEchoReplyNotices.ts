import { useCallback, useEffect, useRef, useState } from 'react';
import { markRepliesSeen, subscribeToReplyNotices } from '../services/unsaidService.ts';

/** How many replies there are in total across the posts. */
export const totalUnseen = (unseenByPost: Record<string, number>): number => Object.values(unseenByPost).reduce((sum, n) => sum + n, 0);

/**
 * What to tell the member when the unseen replies change: how many are new since the last look, and whether this is the very
 * first answer after opening the app (then it is a summary, "you have N new replies", rather than "someone just replied").
 */
export function replyNoticeFor(
  previous: Record<string, number> | null,
  next: Record<string, number>,
  initial: boolean
): { kind: 'summary' | 'new'; count: number } | null {
  if (initial) {
    const total = totalUnseen(next);
    return total > 0 ? { kind: 'summary', count: total } : null;
  }
  let added = 0;
  for (const [postId, count] of Object.entries(next)) added += Math.max(0, count - (previous?.[postId] ?? 0));
  return added > 0 ? { kind: 'new', count: added } : null;
}

/**
 * Tells an author, in the app, about new replies to their own Echoes (Need Advice and Uplift only). It never learns or shows
 * who replied: replies are anonymous, and the author's identity stays in a record only they can read. `onNotice` is how App
 * shows the toast; the per-post counts also feed the "new" badge and the Echoes tab's count.
 */
export function useEchoReplyNotices(enabled: boolean, onNotice: (notice: { kind: 'summary' | 'new'; count: number }) => void) {
  const [unseenByPost, setUnseenByPost] = useState<Record<string, number>>({});
  const previous = useRef<Record<string, number> | null>(null);
  const notify = useRef(onNotice);
  notify.current = onNotice;

  useEffect(() => {
    if (!enabled) return;
    const stop = subscribeToReplyNotices((next, { initial }) => {
      const notice = replyNoticeFor(previous.current, next, initial);
      previous.current = next;
      setUnseenByPost(next);
      if (notice) notify.current(notice);
    });
    return () => {
      stop();
      previous.current = null;
      setUnseenByPost({});
    };
  }, [enabled]);

  const markSeen = useCallback((postId: string, replyCount: number) => {
    void markRepliesSeen(postId, replyCount);
  }, []);

  return { unseenByPost, unseenTotal: totalUnseen(unseenByPost), markSeen };
}
