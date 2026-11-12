/**
 * Pure rules for re-establishing a live listener after it fails: which failures are worth retrying, how long to wait, and when to
 * stop. Bounded on purpose (never an endless loop) and no React or network, so it can be tested.
 */

export type ListenerFailure = 'permission' | 'transient';

/** Tries after a temporary failure (a dropped connection, the service briefly unavailable) before giving up until the member retries. */
export const MAX_TRANSIENT_RETRIES = 5;
/** A refusal is retried once only (a sign-in that was still settling), then reported: repeating it cannot help. */
export const MAX_PERMISSION_RETRIES = 1;
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;

/** A permission error is permanent for this session; anything else (unavailable, network, deadline, unknown) is treated as temporary. */
export function classifyListenerError(error: unknown): ListenerFailure {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  return code.includes('permission-denied') || code.includes('unauthenticated') ? 'permission' : 'transient';
}

/** The wait before retry number `attempt` (0 for the first): 1s, 2s, 4s, 8s, 16s, never more than 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
}

/** Whether another automatic retry is allowed after `attemptsSoFar` retries for a failure of this kind. */
export function mayRetry(kind: ListenerFailure, attemptsSoFar: number): boolean {
  return attemptsSoFar < (kind === 'permission' ? MAX_PERMISSION_RETRIES : MAX_TRANSIENT_RETRIES);
}

/** Words for the member once automatic retries have run out. */
export function listenerFailureText(kind: ListenerFailure): string {
  return kind === 'permission'
    ? 'Live Signals updates aren’t available for this session. Reopen the app, or tap Retry.'
    : 'Live Signals updates are unavailable. Check your connection and tap Retry.';
}
