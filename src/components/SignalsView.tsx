import React, { useCallback, useEffect, useState } from 'react';
import { Check, Inbox, LoaderCircle, RadioTower, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { auth, isFirebaseConfigured } from '../lib/firebase.ts';
import { ConfirmDialog } from './Sheet.tsx';
import { SignalsConversation } from './SignalsConversation.tsx';

type SignalInvitation = {
  id: string;
  senderId: string;
  recipientId: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  createdAt: string | null;
  expiresAt: string | null;
  direction: 'sent' | 'received';
};

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
  const [invitations, setInvitations] = useState<SignalInvitation[]>([]);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [pairToEnd, setPairToEnd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPairId, setOpenPairId] = useState<string | null>(null);

  const loadPairs = useCallback(async () => {
    if (!isFirebaseConfigured) {
      setError('Connect Firebase to use Signals. Your other QUEERSPACE features remain available.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pairResult, invitationResult] = await Promise.all([
        signalsRequest<{ pairs: SignalPair[] }>('/api/signals?view=pairs'),
        signalsRequest<{ invitations: SignalInvitation[] }>('/api/signals'),
      ]);
      setPairs(Array.isArray(pairResult.pairs) ? pairResult.pairs : []);
      setInvitations(Array.isArray(invitationResult.invitations) ? invitationResult.invitations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your connections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  const endPair = async (pairId: string): Promise<boolean> => {
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end this connection.');
      return false;
    } finally {
      setEndingId(null);
    }
  };

  const respondToInvitation = async (invitation: SignalInvitation, action: 'accept' | 'decline' | 'revoke') => {
    setInvitationActionId(invitation.id);
    setError(null);
    setNotice(null);
    try {
      const result = await signalsRequest<{ status: string }>('/api/signals', { action, invitationId: invitation.id });
      setInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: result.status as SignalInvitation['status'] } : item));
      if (action === 'accept' && result.status === 'accepted') {
        setNotice('Invitation accepted. Your mutual connection is now active.');
        await loadPairs();
      } else if (action === 'decline') {
        setNotice('Invitation declined. No message was sent.');
      } else if (action === 'revoke') {
        setNotice('Invitation withdrawn.');
      } else {
        setNotice('This invitation is no longer available.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this invitation.');
    } finally {
      setInvitationActionId(null);
    }
  };

  const pendingReceived = invitations.filter((item) => item.direction === 'received' && item.status === 'pending');
  const pendingSent = invitations.filter((item) => item.direction === 'sent' && item.status === 'pending');
  const activePairs = pairs.filter((pair) => pair.status === 'active');
  const endedPairs = pairs.filter((pair) => pair.status === 'ended');

  if (openPairId) {
    const selectedPair = pairs.find((pair) => pair.id === openPairId);
    if (selectedPair?.status === 'active') {
      return <SignalsConversation pairId={openPairId} onBack={() => setOpenPairId(null)} />;
    }
  }

  return (
    <section
      aria-labelledby="signals-title"
      className="relative mx-auto flex min-h-[min(620px,calc(100dvh-9rem))] w-full max-w-xl flex-col px-5 py-4 anim-rise sm:px-6 sm:py-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-berry/20 bg-raised text-berry">
          <RadioTower className="h-5 w-5" strokeWidth={1.6} />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-lavender" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lavender">A private frequency</p>
          <h1 id="signals-title" className="mt-0.5 font-serif text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">
            Signals
          </h1>
          <p className="mt-1 text-xs leading-snug text-muted">Connections that began with a mutual yes.</p>
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

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-raised/60 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lavender" />
        <p className="text-[11px] leading-snug text-muted">
          Only you can view your connections. Ending one closes it here; no message is sent.
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
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Inbox className="h-4 w-4 text-lavender" /> Invitations</h2>
              <span className="rounded-full border border-line px-2.5 py-1 text-xs tabular-nums text-muted">{pendingReceived.length + pendingSent.length}</span>
            </div>
            {pendingReceived.length === 0 && pendingSent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-3 py-3 text-center">
                <p className="text-sm text-muted">No pending invitations.</p>
                <p className="mt-1 text-[11px] leading-snug text-subtle">When someone sends a Signal, you decide whether to accept.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingReceived.map((invitation) => (
                  <article key={invitation.id} className="rounded-2xl border border-lavender/20 bg-raised/70 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-plum/30 text-lavender"><RadioTower className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-fg">Someone would like to connect</p>
                        <p className="mt-1 text-xs text-muted">Received {formatDate(invitation.createdAt)}</p>
                        {invitation.message && <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-surface/70 p-3 text-sm leading-relaxed text-fg">{invitation.message}</p>}
                        <p className="mt-2 text-[11px] leading-relaxed text-subtle">Accept only if you feel comfortable. You can end a connection later.</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                      <button type="button" onClick={() => void respondToInvitation(invitation, 'decline')} disabled={invitationActionId !== null} className="rounded-full border border-line px-3.5 py-2 text-xs font-semibold text-muted transition hover:text-fg disabled:opacity-50">Decline</button>
                      <button type="button" onClick={() => void respondToInvitation(invitation, 'accept')} disabled={invitationActionId !== null} className="rounded-full bg-berry px-4 py-2 text-xs font-semibold text-ink transition hover:brightness-110 disabled:opacity-50">{invitationActionId === invitation.id ? 'Saving…' : 'Accept'}</button>
                    </div>
                  </article>
                ))}
                {pendingSent.map((invitation) => (
                  <article key={invitation.id} className="flex items-center gap-3 rounded-xl border border-line/70 bg-raised/40 p-3">
                    <RadioTower className="h-4 w-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg">Invitation sent</p>
                      <p className="mt-0.5 text-xs text-subtle">Sent {formatDate(invitation.createdAt)} · Expires {formatDate(invitation.expiresAt)}</p>
                    </div>
                    <button type="button" onClick={() => void respondToInvitation(invitation, 'revoke')} disabled={invitationActionId !== null} className="shrink-0 rounded-full border border-line px-3 py-2 text-xs font-semibold text-muted hover:border-berry/50 hover:text-fg disabled:opacity-50">{invitationActionId === invitation.id ? 'Withdrawing…' : 'Withdraw'}</button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Active connections</h2>
            <span className="rounded-full border border-line px-2.5 py-1 text-xs tabular-nums text-muted">{activePairs.length}</span>
          </div>
          {activePairs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-4 py-4 text-center">
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-raised text-lavender"><RadioTower className="h-5 w-5" /></div>
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
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                    <button
                      type="button"
                      onClick={() => setOpenPairId(pair.id)}
                      className="rounded-full bg-berry px-4 py-2 text-xs font-semibold text-ink transition hover:brightness-110"
                    >
                      Open chat
                    </button>
                    <button
                      type="button"
                      onClick={() => setPairToEnd(pair.id)}
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
            <div className="mt-5">
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
      {pairToEnd && (
        <ConfirmDialog
          title="End this connection?"
          message="This will close the mutual connection in QUEERSPACE. You can’t undo this action, and no message will be sent to the other person."
          confirmLabel={endingId === pairToEnd ? 'Ending…' : 'End connection'}
          cancelLabel="Keep connection"
          tone="danger"
          busy={endingId === pairToEnd}
          onCancel={() => setPairToEnd(null)}
          onConfirm={async () => {
            const id = pairToEnd;
            if (await endPair(id)) setPairToEnd(null);
          }}
        />
      )}
    </section>
  );
};
