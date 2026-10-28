import { useEffect, useRef, useState } from 'react';
import { subscribeAuthState } from '../lib/firebase.ts';
import { EMPTY_INBOX, SignalsInboxSnapshot, parseInbox, subscribeSignalsInbox, takeNewIds } from '../services/signalsInbox.ts';

export interface SignalsInboxState extends SignalsInboxSnapshot {
  /** True while the live listener is connected; false after an error or while signed out. */
  live: boolean;
  /** Set when the listener failed, so screens can offer a manual refresh. */
  error: string | null;
}

/**
 * Real-time pending Signals for the signed-in member. `onNewRequest` fires once per invitation id,
 * never for requests that were already pending when the app opened.
 */
export function useSignalsInbox(onNewRequest: () => void): SignalsInboxState {
  const [snapshot, setSnapshot] = useState(EMPTY_INBOX);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const rawRef = useRef<unknown>(null);
  const callbackRef = useRef(onNewRequest);
  callbackRef.current = onNewRequest;

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    const seen = new Set<string>();
    let first = true;
    const stopListening = () => {
      unsubscribe?.();
      unsubscribe = null;
    };
    const stopAuth = subscribeAuthState((user) => {
      stopListening();
      seen.clear();
      first = true;
      rawRef.current = null;
      setSnapshot(EMPTY_INBOX);
      setLive(false);
      setError(null);
      if (!user) return;
      unsubscribe = subscribeSignalsInbox(
        user.uid,
        (data) => {
          rawRef.current = data;
          const next = parseInbox(data);
          const fresh = takeNewIds(next.pendingIds, seen);
          if (!first && fresh.length > 0) callbackRef.current();
          first = false;
          setSnapshot(next);
          setLive(true);
          setError(null);
        },
        () => {
          setLive(false);
          setError('Live Signals updates are unavailable. Refresh to check for new requests.');
        }
      );
    });
    return () => {
      stopAuth();
      stopListening();
    };
  }, []);

  // Requests expire without any write, so re-evaluate the stored expiry times once a minute.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tick === 0 || rawRef.current === null) return;
    setSnapshot((current) => {
      const next = parseInbox(rawRef.current);
      return next.pendingIds.length === current.pendingIds.length ? current : next;
    });
  }, [tick]);

  return { ...snapshot, live, error };
}
