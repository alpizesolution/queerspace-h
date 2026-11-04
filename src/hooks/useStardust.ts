import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGivenStardust, MAX_STATE_IDS, setStardust, type StardustPostType } from '../services/stardustService.ts';

interface Override { value: number; base: number }

/**
 * Stardust state for one feed. The counts come with the posts; this adds the viewer's own state, learned once per post
 * (posts that arrive or load later are asked about, nothing is asked twice), and updates only the post that changed after
 * a give or remove: the feed is never reloaded.
 */
export function useStardust(postType: StardustPostType, postIds: string[]) {
  const [given, setGiven] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const retryCount = useRef(0);
  const idsKey = postIds.join(',');
  // A failed "which have I given to" read is tried again a few times, so one network blip does not leave every post looking ungiven.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const unknown = postIds.filter((id) => !known.current.has(id));
    if (!unknown.length) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      for (let i = 0; i < unknown.length; i += MAX_STATE_IDS) {
        const chunk = unknown.slice(i, i + MAX_STATE_IDS);
        const result = await fetchGivenStardust(postType, chunk);
        if (cancelled) return;
        if (!result) { // not marked as known, so the next change of the list asks again; and it is retried shortly
          if (retryCount.current < 3) { retryCount.current += 1; retryTimer = setTimeout(() => setRetry((n) => n + 1), 3000 * retryCount.current); }
          return;
        }
        retryCount.current = 0;
        chunk.forEach((id) => known.current.add(id));
        setGiven((prev) => ({ ...prev, ...Object.fromEntries(chunk.map((id) => [id, result.includes(id)])) }));
      }
    })();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postType, idsKey, retry]);

  /**
   * Gives or removes Stardust, then shows the server's answer for this one post. `serverCount` is the post's own count at
   * the time of the tap. Returns true when Stardust was just given (so the screen can celebrate), false otherwise.
   */
  const toggle = useCallback(async (postId: string, serverCount: number): Promise<boolean> => {
    if (inFlight.current.has(postId)) return false; // a second tap while one is on its way does nothing
    inFlight.current.add(postId);
    setPending((prev) => ({ ...prev, [postId]: true }));
    setError(null);
    const wantGiven = !given[postId];
    const result = await setStardust(postType, postId, wantGiven);
    inFlight.current.delete(postId);
    setPending((prev) => { const next = { ...prev }; delete next[postId]; return next; });
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    known.current.add(postId);
    setGiven((prev) => ({ ...prev, [postId]: result.given }));
    setOverrides((prev) => ({ ...prev, [postId]: { value: result.count, base: serverCount } }));
    return result.given && wantGiven;
  }, [given, postType]);

  /** The count to show: the answer to this member's last action while the post still holds the count it had then, else the post's own. */
  const countFor = (postId: string, serverCount: number) => {
    const override = overrides[postId];
    return override && override.base === serverCount ? override.value : serverCount;
  };

  return { given, pending, error, clearError: () => setError(null), toggle, countFor };
}
