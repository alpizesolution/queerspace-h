import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeAuthState } from '../lib/firebase.ts';
import { EMPTY_INBOX, SignalsInboxSnapshot, parseInbox, subscribeSignalsInbox, takeNewIds } from '../services/signalsInbox.ts';
import { classifyListenerError, listenerFailureText, mayRetry, retryDelayMs } from '../utils/listenerRetry.ts';

export interface SignalsInboxState extends SignalsInboxSnapshot {
  /** True while the live listener is connected; false after an error or while signed out. */
  live: boolean;
  /** Set when the listener failed for good (retries ran out, or it was refused), so screens can offer a manual retry. */
  error: string | null;
  /** True while the listener is being re-established after a temporary failure. */
  reconnecting?: boolean;
  /** Tries again now, from the start (for a Retry button). */
  retry?: () => void;
}

/**
 * Real-time pending Signals for the signed-in member. `onNewRequest` fires once per invitation id,
 * never for requests that were already pending when the app opened.
 *
 * If the listener fails it is re-established with bounded retries and growing pauses (1s, 2s, 4s, 8s, 16s). A temporary failure
 * (connection, service) is retried; a permission refusal is retried once and then reported. When retries run out the member sees a
 * message with a Retry button, and coming back online also tries again. Only one listener ever exists at a time, and unmounting
 * cancels any pending retry.
 */
export function useSignalsInbox(
  onNewRequest: () => void,
  onAccepted?: (pairId: string) => void,
  onConnectionRequest?: (requestId: string) => void
): SignalsInboxState {
  const [snapshot, setSnapshot] = useState(EMPTY_INBOX);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [tick, setTick] = useState(0);
  const rawRef = useRef<unknown>(null);
  const callbackRef = useRef(onNewRequest);
  callbackRef.current = onNewRequest;
  const acceptedRef = useRef(onAccepted);
  acceptedRef.current = onAccepted;
  const connectionRef = useRef(onConnectionRequest);
  connectionRef.current = onConnectionRequest;
  /** Starts a fresh connection attempt for the current member (set by the effect below). */
  const restartRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let currentUid: string | null = null;
    let attempts = 0;
    const seen = new Set<string>();
    const seenAccepted = new Set<string>();
    const seenRequests = new Set<string>();
    let first = true;
    const stopListening = () => {
      unsubscribe?.();
      unsubscribe = null;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    };
    const connect = (uid: string) => {
      stopListening();
      unsubscribe = subscribeSignalsInbox(
        uid,
        (data) => {
          if (disposed || uid !== currentUid) return;
          attempts = 0;
          rawRef.current = data;
          const next = parseInbox(data);
          const fresh = takeNewIds(next.pendingIds, seen);
          if (!first && fresh.length > 0) callbackRef.current();
          // Each acceptance is announced once; ones already waiting when the app opened stay quiet.
          const accepted = takeNewIds(next.acceptedUnread, seenAccepted);
          if (!first) accepted.forEach((pairId) => acceptedRef.current?.(pairId));
          // Each new connection request is announced once; ones already waiting at start-up stay quiet.
          const requested = takeNewIds(next.requestIds, seenRequests);
          if (!first) requested.forEach((id) => connectionRef.current?.(id));
          first = false;
          setSnapshot(next);
          setLive(true);
          setReconnecting(false);
          setError(null);
        },
        (failure) => {
          if (disposed || uid !== currentUid) return;
          // This listener is finished (Firestore stops it on an error); decide whether to start another.
          unsubscribe = null;
          setLive(false);
          const kind = classifyListenerError(failure);
          if (mayRetry(kind, attempts)) {
            setReconnecting(true);
            retryTimer = setTimeout(() => { retryTimer = null; if (!disposed && uid === currentUid) connect(uid); }, retryDelayMs(attempts));
            attempts += 1;
          } else {
            setReconnecting(false);
            setError(listenerFailureText(kind));
          }
        }
      );
    };
    restartRef.current = () => {
      if (disposed || !currentUid) return;
      attempts = 0;
      setError(null);
      setReconnecting(true);
      connect(currentUid);
    };
    const onOnline = () => {
      // Back online after the retries ran out (or while waiting between them): try again straight away.
      if (!disposed && currentUid && !unsubscribe) restartRef.current();
    };
    window.addEventListener('online', onOnline);
    const stopAuth = subscribeAuthState((user) => {
      stopListening();
      seen.clear();
      seenAccepted.clear();
      seenRequests.clear();
      first = true;
      attempts = 0;
      rawRef.current = null;
      currentUid = user?.uid ?? null;
      setSnapshot(EMPTY_INBOX);
      setLive(false);
      setError(null);
      setReconnecting(false);
      if (!user) return;
      connect(user.uid);
    });
    return () => {
      disposed = true;
      window.removeEventListener('online', onOnline);
      stopAuth();
      stopListening();
    };
  }, []);

  const retry = useCallback(() => restartRef.current(), []);

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

  return { ...snapshot, live, error, reconnecting, retry };
}
