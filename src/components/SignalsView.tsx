import React, { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, RadioTower, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { auth, isFirebaseConfigured } from '../lib/firebase.ts';

type SignalPair = {
  id: string;
  invitationId: string;
  participants: string[];
  status: 'active' | 'ended';
  createdAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
};

const STARS = [
  { top: 8, left: 14, size: 2 },
  { top: 22, left: 84, size: 3 },
  { top: 64, left: 6, size: 2 },
  { top: 78, left: 90, size: 2 },
  { top: 40, left: 96, size: 1.5 },
  { top: 92, left: 30, size: 1.5 },
];

async function signalsRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in is still preparing. Please try again in a moment.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      unauthenticated: 'Your session needs to refresh. Please try again.',
      not_allowed: 'You are not allowed to change this connection.',
      pair_not_found: 'This connection could not be found.',
      pair_not_active: 'This connection is no longer active.',
      internal_error: 'Signals is temporarily unavailable. Please try again.',
    };
    throw new Error(messages[data.error] || 'Something went wrong. Please try again.');
  }
  return data as T;
}

function formatDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export const SignalsView: React.FC = () => {
  const [pairs, setPairs] = useState<SignalPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPairs = useCallback(async () => {
    if (!isFirebaseConfigured) {
      setError('Connect Firebase to use Signals. Your other QUEERSPACE features remain available.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await signalsRequest<{ pairs: SignalPair[] }>('/api/signals?view=pairs');
      setPairs(Array.isArray(result.pairs) ? result.pairs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your connections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  const endPair = async (pairId: string) => {
    setEndingId(pairId);
    setError(null);
    setNotice(null);
    try {
      await signalsRequest<{ status: string; alreadyEnded: boolean }>('/api/signals', {
        action: 'end',
        pairId,
      });
      setPairs((current) => current.map((pair) =>
        pair.id === pairId ? { ...pair, status: 'ended', endedAt: new Date().toISOString() } : pair
      ));
      setNotice('Connection ended. You can leave it here; no message was sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end this connection.');
    } finally {
      setEndingId(null);
    }
  };

  const activePairs = pairs.filter((pair) => pair.status === 'active');
  const endedPairs = pairs.filter((pair) => pair.status === 'ended');

  return (
    <section
      aria-labelledby="signals-title"
      className="relative mx-auto flex min-h-[min(620px,calc(100dvh-9rem))] w-full max-w-xl flex-col px-5 py-8 anim-rise sm:px-6 sm:py-10"
    >
      <div className="mb-7 flex items-center gap-4">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-berry/20 bg-raised text-berry">
          <RadioTower className="h-6 w-6" strokeWidth={1.6} />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-lavender" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lavender">A private frequency</p>
          <h1 id="signals-title" className="mt-1 font-serif text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
            Signals
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">Connections that began with a mutual yes.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadPairs()}
          disabled={loading}
          aria-label="Refresh connections"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:border-berry/50 hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-raised/60 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-lavender" />
        <p className="text-xs leading-relaxed text-muted">
          Only you can view your connections. Ending one closes the connection here; it does not send a message.
        </p>
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-berry/20 bg-plum/20 p-3 text-sm text-fg">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-berry" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="ml-auto text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-berry/30 bg-plum/20 p-4 text-sm text-fg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadPairs()} className="shrink-0 font-semibold text-berry underline underline-offset-4">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted">
          <LoaderCircle className="h-5 w-5 animate-spin text-berry" /> Finding your connections…
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Active connections</h2>
            <span className="rounded-full border border-line px-2.5 py-1 text-xs tabular-nums text-muted">{activePairs.length}</span>
          </div>
          {activePairs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-raised text-lavender"><RadioTower className="h-5 w-5" /></div>
              <p className="text-sm font-medium text-fg">Nothing lingering just yet.</p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">When an invitation is accepted, the connection will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activePairs.map((pair) => (
                <article key={pair.id} className="rounded-2xl border border-line bg-raised/70 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-lavender/20 bg-plum/30 text-lavender"><RadioTower className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">A mutual connection</p>
                      <p className="mt-1 text-xs text-muted">Connected {formatDate(pair.createdAt)}</p>
                    </div>
                    <span className="rounded-full bg-lavender/10 px-2.5 py-1 text-[10px] font-semibold text-lavender">Active</span>
                  </div>
                  <div className="mt-4 flex justify-end border-t border-line pt-3">
                    <button
                      type="button"
                      onClick={() => void endPair(pair.id)}
                      disabled={endingId !== null}
                      className="rounded-full border border-line px-3.5 py-2 text-xs font-semibold text-muted transition hover:border-berry/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {endingId === pair.id ? 'Ending…' : 'End connection'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {endedPairs.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-fg">Past connections</h2>
                <span className="rounded-full border border-line px-2.5 py-1 text-xs tabular-nums text-muted">{endedPairs.length}</span>
              </div>
              <div className="space-y-2">
                {endedPairs.map((pair) => (
                  <div key={pair.id} className="flex items-center gap-3 rounded-xl border border-line/70 bg-raised/40 p-3">
                    <Check className="h-4 w-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-muted">Connection ended</p>
                      <p className="mt-0.5 text-xs text-subtle">{formatDate(pair.endedAt || pair.createdAt)}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-subtle">Closed</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
