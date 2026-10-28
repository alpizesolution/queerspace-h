import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Inbox, Info, LoaderCircle, RadioTower, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { auth, isFirebaseConfigured } from '../lib/firebase.ts';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { SignalsConversation } from './SignalsConversation.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { isValidAvatar } from '../utils/avatar.ts';
import type { SignalsInboxState } from '../hooks/useSignalsInbox.ts';

/** The other person's public pseudonym and avatar, resolved by the API; null fields when they have none. */
type SignalPartner = { displayName: string | null; avatar: string | null };

type SignalInvitation = {
  id: string;
  senderId: string;
  recipientId: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  createdAt: string | null;
  expiresAt: string | null;
  direction: 'sent' | 'received';
  /** The other person (the sender, for received invitations). */
  partner?: SignalPartner;
};

type SignalPair = {
  id: string;
  invitationId: string;
  participants: string[];
  status: 'active' | 'ended';
  createdAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  partner?: SignalPartner;
};

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

/**
 * Pseudonym of whoever sent the newest pending invitation to this member, for the in-app banner.
 * Resolved by the API, so only a public pseudonym is returned; null if there is no pending invitation.
 */
export async function fetchNewestPendingSenderName(): Promise<string | null> {
  try {
    const { invitations } = await signalsRequest<{ invitations: SignalInvitation[] }>('/api/signals');
    const newest = (invitations || []).find((item) => item.direction === 'received' && item.status === 'pending');
    return newest ? newest.partner?.displayName?.trim() || 'Anonymous member' : null;
  } catch {
    return null;
  }
}

function formatShortDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

const SectionHeader: React.FC<{ title: string; count: number; muted?: boolean }> = ({ title, count, muted }) => (
  <div className="mb-1.5 flex items-center gap-2 px-1">
    <h2 className={`text-xs font-semibold uppercase tracking-[0.14em] ${muted ? 'text-subtle' : 'text-muted'}`}>{title}</h2>
    <span className={`rounded-full px-2 text-[length:calc(11px_*_var(--fs,1))] font-semibold leading-5 tabular-nums ${count > 0 && !muted ? 'bg-berry/15 text-berry' : 'bg-raised text-subtle'}`}>{count}</span>
  </div>
);

const PartnerAvatar: React.FC<{ avatar?: string | null; seed: string; small?: boolean }> = ({ avatar, seed, small }) => {
  const size = small ? 'h-7 w-7' : 'h-10 w-10';
  return isValidAvatar(avatar)
    ? <AnimalAvatar avatar={avatar} seed={seed} className={size} />
    : <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-plum/30 text-lavender`}><RadioTower className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} /></div>;
};

const nameOf = (partner?: SignalPartner) => partner?.displayName?.trim() || 'Anonymous member';

export const SignalsView: React.FC<{ inbox?: SignalsInboxState }> = ({ inbox }) => {
  const [pairs, setPairs] = useState<SignalPair[]>([]);
  const [invitations, setInvitations] = useState<SignalInvitation[]>([]);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [pairToEnd, setPairToEnd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPairId, setOpenPairId] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const loadPairs = useCallback(async (quiet = false) => {
    if (!isFirebaseConfigured) {
      setError('Connect Firebase to use Signals. Your other QUEERSPACE features remain available.');
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
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

  // The server bumps this revision whenever a request is sent, accepted, declined, withdrawn or ended
  // (for both people), so the lists refresh straight away without polling.
  const lastRev = useRef(inbox?.rev);
  useEffect(() => {
    if (inbox === undefined || inbox.rev === lastRev.current) return;
    lastRev.current = inbox.rev;
    void loadPairs(true);
  }, [inbox?.rev, loadPairs]);

  const invitationsRef = useRef<HTMLDivElement>(null);
  const scrolledToRequests = useRef(false);

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
      setNotice('Connection ended. No message was sent.');
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
        setNotice(`Connected with ${nameOf(invitation.partner)}.`);
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

  // Arriving from the new-request banner or tab badge: bring the invitations into view once.
  useEffect(() => {
    if (loading || scrolledToRequests.current || pendingReceived.length === 0) return;
    scrolledToRequests.current = true;
    invitationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, pendingReceived.length]);

  if (openPairId) {
    const selectedPair = pairs.find((pair) => pair.id === openPairId);
    if (selectedPair?.status === 'active') {
      return <SignalsConversation pairId={openPairId} partner={selectedPair.partner} onBack={() => setOpenPairId(null)} />;
    }
  }

  const hasInvitations = pendingReceived.length + pendingSent.length > 0;

  return (
    <section aria-labelledby="signals-title" className="relative mx-auto flex w-full max-w-xl flex-col px-4 pb-6 pt-4 anim-rise sm:px-6 sm:pt-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-berry">
          <RadioTower className="h-5 w-5" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 id="signals-title" className="font-serif text-2xl font-semibold leading-none tracking-tight text-fg">Signals</h1>
          <p className="mt-1 text-xs leading-none text-muted">Connections, on your terms.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadPairs()}
          disabled={loading}
          aria-label="Refresh connections"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="mb-3 mt-2 flex items-center gap-1 text-xs text-subtle">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Private connections</span>
        <button
          type="button"
          onClick={() => setPrivacyOpen(true)}
          aria-label="About private connections"
          className="flex h-8 w-8 items-center justify-center rounded-full text-subtle transition hover:text-fg"
        >
          <Info className="h-4 w-4" />
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-plum/20 px-3 py-2 text-sm text-fg">
          <Check className="h-4 w-4 shrink-0 text-berry" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="flex h-8 w-8 items-center justify-center text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
      )}
      {inbox?.error && !error && (
        <p role="status" className="mb-3 rounded-xl border border-line px-3 py-2 text-xs text-muted">{inbox.error}</p>
      )}
      {error && (
        <div role="alert" className="mb-3 flex items-center gap-3 rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-sm text-fg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadPairs()} className="shrink-0 font-semibold text-berry underline underline-offset-4">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Finding your connections…
        </div>
      ) : (
        <>
          <div ref={invitationsRef} className="scroll-mt-20">
            <SectionHeader title="Invitations" count={pendingReceived.length + pendingSent.length} />
            {!hasInvitations ? (
              <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted"><Inbox className="h-4 w-4 text-subtle" /> Inbox is quiet.</p>
            ) : (
              <ul className="space-y-2">
                {pendingReceived.map((invitation) => {
                  const name = nameOf(invitation.partner);
                  return (
                    <li key={invitation.id} className="rounded-2xl border border-lavender/25 bg-raised/70 p-3">
                      <div className="flex items-center gap-3">
                        <PartnerAvatar avatar={invitation.partner?.avatar} seed={invitation.id} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg">{name}</p>
                          <p className="mt-0.5 text-xs text-subtle">Wants to connect · {formatShortDate(invitation.createdAt)}</p>
                        </div>
                      </div>
                      {invitation.message && <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surface/70 px-3 py-2 text-sm leading-snug text-fg">{invitation.message}</p>}
                      <div className="mt-1.5 flex justify-end gap-1">
                        <button type="button" onClick={() => void respondToInvitation(invitation, 'decline')} disabled={invitationActionId !== null} aria-label={`Decline ${name}`} className="h-9 rounded-full px-3 text-xs font-semibold text-muted transition hover:text-fg disabled:opacity-50">Decline</button>
                        <button type="button" onClick={() => void respondToInvitation(invitation, 'accept')} disabled={invitationActionId !== null} aria-label={`Accept ${name}`} className="h-9 rounded-full bg-berry px-4 text-xs font-semibold text-ink transition hover:brightness-110 disabled:opacity-50">{invitationActionId === invitation.id ? 'Saving…' : 'Accept'}</button>
                      </div>
                    </li>
                  );
                })}
                {pendingSent.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 px-1 py-1.5">
                    <PartnerAvatar avatar={invitation.partner?.avatar} seed={invitation.id} small />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">Waiting for {nameOf(invitation.partner)}</p>
                      <p className="text-xs text-subtle">Sent {formatShortDate(invitation.createdAt)}</p>
                    </div>
                    <button type="button" onClick={() => void respondToInvitation(invitation, 'revoke')} disabled={invitationActionId !== null} className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-muted hover:text-fg disabled:opacity-50">{invitationActionId === invitation.id ? 'Withdrawing…' : 'Withdraw'}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5">
            <SectionHeader title="Active" count={activePairs.length} />
            {activePairs.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted">No active connections yet.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {activePairs.map((pair) => {
                  const name = nameOf(pair.partner);
                  return (
                    <li key={pair.id} className="flex items-center gap-3 py-2.5">
                      <PartnerAvatar avatar={pair.partner?.avatar} seed={pair.id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg">{name}</p>
                        <p className="mt-0.5 text-xs text-subtle">Since {formatShortDate(pair.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPairToEnd(pair.id)}
                        disabled={endingId !== null}
                        aria-label={`End connection with ${name}`}
                        className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {endingId === pair.id ? 'Ending…' : 'End'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenPairId(pair.id)}
                        aria-label={`Open chat with ${name}`}
                        className="h-9 shrink-0 rounded-full bg-berry px-4 text-xs font-semibold text-ink transition hover:brightness-110"
                      >
                        Open
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {endedPairs.length > 0 && (
            <div className="mt-5">
              <SectionHeader title="Past" count={endedPairs.length} muted />
              <ul className="divide-y divide-line/40">
                {endedPairs.map((pair) => (
                  <li key={pair.id} className="flex items-center gap-3 py-2 opacity-70">
                    <PartnerAvatar avatar={pair.partner?.avatar} seed={pair.id} small />
                    <p className="min-w-0 flex-1 truncate text-sm text-muted">{nameOf(pair.partner)}</p>
                    <span className="shrink-0 text-xs text-subtle">Closed · {formatShortDate(pair.endedAt || pair.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {privacyOpen && (
        <Sheet title="Private connections" size="sm" icon={<ShieldCheck className="h-5 w-5" />} onClose={() => setPrivacyOpen(false)}>
          <p className="text-sm leading-relaxed text-muted">Only you can view your connections. Ending a connection closes it here; no message is sent.</p>
        </Sheet>
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
