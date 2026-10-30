import { useEffect, useRef, useState } from 'react';
import {
  AdminReport,
  AdminSuggestion,
  isNewSuggestion,
  isOpenReport,
  newArrivalTracker,
  subscribeInbox,
  toAdminReport,
  toAdminSuggestion,
} from '../services/adminInboxService.ts';

const RETRY_AFTER_MS = 30_000;

/**
 * Live suggestions and reports for the whole admin panel. The listeners start when the panel opens and are removed when
 * it closes. Counts, lists and toasts all come from the same two listeners, so nothing extra is read or written.
 * If a listener stops (an error), the panel keeps what it has, says so, and retries by itself every 30 seconds.
 */
export function useAdminInbox(onArrival: (kind: 'suggestion' | 'report', ids: string[]) => void) {
  const [suggestions, setSuggestions] = useState<AdminSuggestion[] | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [failed, setFailed] = useState({ suggestions: false, reports: false });
  const [attempt, setAttempt] = useState(0);
  // The trackers outlive a restart of the listeners, so a retry can't announce the same submission twice.
  const trackers = useRef({ suggestions: newArrivalTracker(), reports: newArrivalTracker() });
  const arrival = useRef(onArrival);
  arrival.current = onArrival;

  useEffect(() => {
    let retry = 0;
    const fail = (which: 'suggestions' | 'reports') => (error: unknown) => {
      console.warn(`[Admin] Live ${which} stopped:`, (error as { code?: string })?.code ?? 'error');
      setFailed((prev) => ({ ...prev, [which]: true }));
      window.clearTimeout(retry);
      retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_AFTER_MS);
    };
    const ok = (which: 'suggestions' | 'reports') => setFailed((prev) => (prev[which] ? { ...prev, [which]: false } : prev));

    const stopSuggestions = subscribeInbox('suggestions', 'createdAt', toAdminSuggestion, isNewSuggestion, trackers.current.suggestions, {
      onItems: (items) => {
        ok('suggestions');
        setSuggestions(items);
      },
      onArrivals: (items) => arrival.current('suggestion', items.map((i) => i.id)),
      onError: fail('suggestions'),
    });
    const stopReports = subscribeInbox('reports', 'timestamp', toAdminReport, isOpenReport, trackers.current.reports, {
      onItems: (items) => {
        ok('reports');
        setReports(items);
      },
      onArrivals: (items) => arrival.current('report', items.map((i) => i.id)),
      onError: fail('reports'),
    });
    return () => {
      window.clearTimeout(retry);
      stopSuggestions();
      stopReports();
    };
  }, [attempt]);

  return {
    suggestions,
    reports,
    liveError: failed.suggestions || failed.reports,
    retry: () => setAttempt((n) => n + 1),
    pendingSuggestions: suggestions?.filter(isNewSuggestion).length ?? 0,
    openReports: reports?.filter(isOpenReport).length ?? 0,
  };
}
