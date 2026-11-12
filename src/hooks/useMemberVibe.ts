import { useEffect, useState } from 'react';
import { fetchMemberVibe } from '../services/currentVibeService.ts';
import type { VibeView } from '../utils/currentVibe.ts';

/** The longest a timer can be set for (about 24.8 days); a status is never that long, but this keeps the call valid. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Another member's live Current Vibe, for a small indicator (Seek, the Signals header). The server decides whether this viewer may
 * see it at all (blocks, the member's own setting, expiry); null means there is nothing to show, for any reason. While the screen
 * stays open the status is dropped at the moment it expires, with no further request.
 */
export function useMemberVibe(memberId: string | null | undefined): VibeView | null {
  const [vibe, setVibe] = useState<VibeView | null>(null);

  useEffect(() => {
    setVibe(null);
    if (!memberId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchMemberVibe(memberId).then((found) => {
      if (!live || !found) return;
      setVibe(found);
      timer = setTimeout(() => { if (live) setVibe(null); }, Math.min(Math.max(Date.parse(found.expiresAt) - Date.now(), 0), MAX_TIMER_MS));
    });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [memberId]);

  return vibe;
}

/** The current time, refreshed every minute, so "Expires in 22 hours" stays true while a profile is open. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
