import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Inbox, Info, LoaderCircle, RadioTower, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { auth, isFirebaseConfigured } from '../lib/firebase.ts';
import { InboxSkeleton } from './Skeleton.tsx';
import { Sheet } from './Sheet.tsx';
import { SignalsConversation } from './SignalsConversation.tsx';
import { ConnectionRequestsPanel } from './ConnectionRequestsPanel.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { isValidAvatar } from '../utils/avatar.ts';
import type { SignalsInboxState } from '../hooks/useSignalsInbox.ts';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';
import { formatUnread, sortByActivity } from '../services/signalsInbox.ts';
import {
  fetchPair,
  fetchPairsPage,
  fetchPendingInvitations,
  readInboxCache,
  writeInboxCache,
  type SignalInvitation,
  type SignalPair,
  type SignalPartner,
} from '../services/signalsListService.ts';
import { appendPage, inboxFreshness, mergeFirstPage } from '../utils/signalsList.ts';

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
      not_allowed: 'You are not allowed to do that in this connection.',
      invalid_test: 'That test isn’t available.',
      account_unavailable: 'Messaging is temporarily unavailable for this account.',
      pair_not_found: 'This connection could not be found.',
      pair_not_active: 'This connection is no longer active.',
      invitation_not_pending: 'This invitation was already answered.',
      invitation_not_found: 'This invitation is no longer available.',
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
    // The same request the inbox makes, so the two share one answer instead of asking twice.
    const invitations = await fetchPendingInvitations();
    const newest = invitations.find((item) => item.direction === 'received' && item.status === 'pending');
    return newest ? newest.partner?.displayName?.trim() || 'Anonymous member' : null;
  } catch {
    return null;
  }
}

/** Pseudonym of the member on the other side of a connection, for the "request accepted" banner; null if unknown. */
export async function fetchPartnerName(pairId: string): Promise<string | null> {
  try {
    const cached = readInboxCache(auth?.currentUser?.uid)?.pairs.find((pair) => pair.id === pairId);
    if (cached?.partner?.displayName?.trim()) return cached.partner.displayName.trim();
    // One connection, one read: not the whole list.
    return (await fetchPair(pairId))?.partner?.displayName?.trim() || null;
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
export const SignalsView: React.FC<{
  inbox?: SignalsInboxState;
  isSoundMuted?: boolean;
  /** A connection to open as soon as the list has loaded (from a notification). */
  requestedPairId?: string | null;
  /** The conversation that was open when the member left Signals, so coming back returns to it. */
  initialPairId?: string | null;
  /** Which conversation is open and whether it is on screen (App uses this to hide its header on a phone). */
  onConversationState?: (state: { openPairId: string | null; visible: boolean }) => void;
  onRequestedPairHandled?: () => void;
  /** Which area to open first: the usual inbox, or Requests (from a Looking For shortcut or a request banner). */
  initialSection?: 'inbox' | 'requests';
  onInitialSectionHandled?: () => void;
  onBlockMember?: (memberId: string) => void;
  /** The member's own NSFW setting, passed to the conversation (it decides whether NSFW Cards can be sent or read). */
  nsfwPreference?: NsfwPreference;
  /** Opens the app's settings. */
  onOpenSettings?: () => void;
}> = ({ inbox, isSoundMuted = false, requestedPairId = null, initialPairId = null, onConversationState, onRequestedPairHandled, initialSection = 'inbox', onInitialSectionHandled, onBlockMember, nsfwPreference = 'hide', onOpenSettings }) => {
  const [section, setSection] = useState<'inbox' | 'requests'>(initialSection);
  useEffect(() => {
    onInitialSectionHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // What was loaded last time is shown straight away; the skeleton is only for a first load with nothing to show yet.
  const ownerId = auth?.currentUser?.uid ?? null;
  const remembered = useRef(readInboxCache(ownerId));
  const [pairs, setPairs] = useState<SignalPair[]>(() => remembered.current?.pairs ?? []);
  const [invitations, setInvitations] = useState<SignalInvitation[]>(() => remembered.current?.invitations ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(() => remembered.current?.nextCursor ?? null);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(remembered.current === null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const loadedOnce = useRef(remembered.current !== null);
  const loadedRev = useRef<number | undefined>(remembered.current?.rev);
  const cursorRef = useRef<string | null>(remembered.current?.nextCursor ?? null);
  const moreBusy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPairId, setOpenPairId] = useState<string | null>(initialPairId);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [selectedInvitationId, setSelectedInvitationId] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [invitationAction, setInvitationAction] = useState<'accept' | 'decline' | null>(null);

  /** The list as last shown, readable outside a state update (so a refresh can tell whether deeper pages are already loaded). */
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  /** Counts refreshes: only the newest one may change the screen, so a slow, older answer can never overwrite a newer one. */
  const loadGeneration = useRef(0);

  /**
   * Reads the first page and the waiting invitations. `fresh` is for a refresh that follows a known change (a new rev from the live
   * inbox, an accepted invitation): it never joins a request that was sent before the change, which would give the old list back.
   */
  const loadPairs = useCallback(async (quiet = false, fresh = false) => {
    if (!isFirebaseConfigured) {
      setError('Connect Firebase to use Signals. Your other QUEERSPACE features remain available.');
      setLoading(false);
      return;
    }
    const generation = ++loadGeneration.current;
    // The revision the answer is valid for is the one when it was ASKED, not when it came back.
    const revAtStart = latestRev.current;
    // Content that is already on screen stays: only a first load with nothing to show uses the skeleton.
    if (!loadedOnce.current && !quiet) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [page, pending] = await Promise.all([fetchPairsPage(null, fresh), fetchPendingInvitations(fresh)]);
      if (generation !== loadGeneration.current) return;
      const merged = mergeFirstPage(pairsRef.current, page.pairs);
      const kept = merged.length > page.pairs.length;
      pairsRef.current = merged;
      setPairs(merged);
      // If pages further down were already loaded, their cursor still points to what comes next.
      const cursor = kept ? cursorRef.current : page.nextCursor;
      cursorRef.current = cursor;
      setNextCursor(cursor);
      setInvitations(pending);
      loadedOnce.current = true;
      loadedRev.current = revAtStart;
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setError(err instanceof Error ? err.message : 'Could not load your connections.');
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  /** Loads the next page of connections when the end of the list comes into view. */
  const loadMore = useCallback(async () => {
    if (!cursorRef.current || moreBusy.current) return;
    moreBusy.current = true;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchPairsPage(cursorRef.current);
      setPairs((current) => appendPage(current, page.pairs));
      cursorRef.current = page.nextCursor;
      setNextCursor(page.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      moreBusy.current = false;
      setLoadingMore(false);
    }
  }, []);

  const endSentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = endSentinel.current;
    if (!target || !nextCursor || moreError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [nextCursor, moreError, loadMore, pairs.length, section]);

  // Coming back to the inbox: if the live inbox says nothing has changed since it was loaded, ask for nothing at all.
  const latestRev = useRef(inbox?.rev);
  latestRev.current = inbox?.rev;
  useEffect(() => {
    if (inboxFreshness(remembered.current, inbox?.rev, Date.now()) === 'fresh') return;
    void loadPairs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPairs]);

  // Remember the inbox as it is (including changes made here) for the next visit.
  useEffect(() => {
    if (!loadedOnce.current) return;
    writeInboxCache(ownerId, { pairs, invitations, nextCursor, rev: loadedRev.current, at: Date.now() });
  }, [pairs, invitations, nextCursor, ownerId]);

  // The server bumps this revision whenever a request is sent, accepted, declined, withdrawn or ended
  // (for both people), so the lists refresh straight away without polling.
  const lastRev = useRef(inbox?.rev);
  useEffect(() => {
    if (inbox === undefined || inbox.rev === lastRev.current) return;
    lastRev.current = inbox.rev;
    void loadPairs(true, true);
  }, [inbox?.rev, loadPairs]);

  const invitationsRef = useRef<HTMLDivElement>(null);
  const scrolledToRequests = useRef(false);

  /** Ends a connection with the existing `end` action. Returns null on success, or words for the member. */
  const endPair = async (pairId: string): Promise<string | null> => {
    setError(null);
    try {
      await signalsRequest<{ status: string; alreadyEnded: boolean }>('/api/signals', {
        action: 'end',
        pairId,
      });
      setPairs((current) => current.map((pair) =>
        pair.id === pairId ? { ...pair, status: 'ended', endedAt: new Date().toISOString() } : pair
      ));
      setNotice('Connection ended. No message was sent.');
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not end this connection.';
    }
  };

  /** Answers an invitation with the existing accept / decline / revoke actions. Returns null on success, or words for the member. */
  const respondToInvitation = async (invitation: SignalInvitation, action: 'accept' | 'decline' | 'revoke'): Promise<string | null> => {
    if (invitationActionId !== null) return null;
    setInvitationActionId(invitation.id);
    setError(null);
    setNotice(null);
    try {
      const result = await signalsRequest<{ status: string }>('/api/signals', { action, invitationId: invitation.id });
      setInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: result.status as SignalInvitation['status'] } : item));
      if (action === 'accept' && result.status === 'accepted') {
        setNotice(`Connected with ${nameOf(invitation.partner)}.`);
        await loadPairs(false, true);
      } else if (action === 'decline') {
        setNotice('Invitation declined. No message was sent.');
      } else if (action === 'revoke') {
        setNotice('Invitation withdrawn.');
      } else {
        setNotice('This invitation is no longer available.');
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not update this invitation.';
    } finally {
      setInvitationActionId(null);
    }
  };

  /** Answers from the invitation dialog: it closes on success and stays open, with the invitation intact, on failure. */
  const answerFromDialog = async (invitation: SignalInvitation, action: 'accept' | 'decline') => {
    setInvitationError(null);
    setInvitationAction(action);
    const failure = await respondToInvitation(invitation, action);
    setInvitationAction(null);
    if (failure) setInvitationError(failure);
    else setSelectedInvitationId(null);
  };

  // Sheet keeps the onClose it was opened with, so the busy check reads a ref that is current on every render.
  const answeringRef = useRef(false);
  answeringRef.current = invitationActionId !== null;
  const closeInvitation = () => {
    if (answeringRef.current) return;
    setSelectedInvitationId(null);
    setInvitationError(null);
  };

  /** Opens a conversation, and marks its "request accepted" notification as seen. */
  const openPair = (pairId: string) => {
    if (inbox?.acceptedUnread.includes(pairId)) void signalsRequest('/api/signals', { action: 'ack-notification', pairId }).catch(() => {});
    setOpenPairId(pairId);
  };

  const pendingReceived = invitations.filter((item) => item.direction === 'received' && item.status === 'pending');
  const pendingSent = invitations.filter((item) => item.direction === 'sent' && item.status === 'pending');
  // Conversations with unread messages first, then the most recently active.
  const activePairs = sortByActivity(pairs.filter((pair) => pair.status === 'active'), inbox?.unread ?? {}, inbox?.last ?? {});
  const endedPairs = pairs.filter((pair) => pair.status === 'ended');
  const selectedInvitation = pendingReceived.find((item) => item.id === selectedInvitationId) ?? null;
  const acceptedNotes = (inbox?.acceptedUnread ?? []).flatMap((id) => {
    const pair = activePairs.find((item) => item.id === id);
    return pair ? [pair] : [];
  });

  // A notification asked for a conversation: open it once the list is in, refreshing once if it isn't there yet.
  const retriedRequestedPair = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedPairId || loading) return;
    const pair = pairs.find((item) => item.id === requestedPairId);
    if (pair) {
      if (pair.status === 'active') openPair(pair.id);
      onRequestedPairHandled?.();
    } else if (retriedRequestedPair.current !== requestedPairId) {
      retriedRequestedPair.current = requestedPairId;
      void loadPairs(true, true);
    } else {
      onRequestedPairHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPairId, loading, pairs]);

  // A notification for a connection that has since ended has nothing to open, so clear it instead of leaving a badge.
  useEffect(() => {
    for (const id of inbox?.acceptedUnread ?? []) {
      if (pairs.find((item) => item.id === id)?.status === 'ended') void signalsRequest('/api/signals', { action: 'ack-notification', pairId: id }).catch(() => {});
    }
  }, [inbox?.acceptedUnread, pairs]);

  // Arriving from the new-request banner or tab badge: bring the invitations into view once.
  useEffect(() => {
    if (loading || scrolledToRequests.current || pendingReceived.length === 0) return;
    scrolledToRequests.current = true;
    invitationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, pendingReceived.length]);

  // Tell App which conversation is open and whether it is actually showing, so it can hide its own header on a phone.
  const conversationVisible = Boolean(openPairId && pairs.find((pair) => pair.id === openPairId)?.status === 'active');
  useEffect(() => {
    onConversationState?.({ openPairId, visible: conversationVisible });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPairId, conversationVisible]);

  if (openPairId) {
    const selectedPair = pairs.find((pair) => pair.id === openPairId);
    if (selectedPair?.status === 'active') {
      return <SignalsConversation pairId={openPairId} partnerId={selectedPair.participants?.find((id) => id !== auth?.currentUser?.uid)} partner={selectedPair.partner} liveAt={inbox?.last[openPairId] && !inbox.last[openPairId].mine ? inbox.last[openPairId].at : null} isSoundMuted={isSoundMuted} nsfwPreference={nsfwPreference} onOpenSettings={onOpenSettings} onBack={() => setOpenPairId(null)} onEnd={() => endPair(openPairId)} />;
    }
  }

  const hasInvitations = pendingReceived.length + pendingSent.length > 0;

  // The dialogs sit beside the section, not inside it: its entrance animation would otherwise pin them to the section
  // instead of the screen.
  return (
    <>
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
          disabled={loading || refreshing}
          aria-label="Refresh connections"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
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

      <div role="tablist" aria-label="Signals sections" className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1">
        {([['inbox', 'Inbox'], ['requests', 'Requests']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)} className={`h-9 rounded-full text-[length:calc(13px_*_var(--fs,1))] font-semibold transition-colors cursor-pointer ${section === id ? 'bg-raised text-fg ring-1 ring-berry/40' : 'text-muted hover:text-fg'}`}>
            {label}
            {id === 'requests' && (inbox?.requestIds.length ?? 0) > 0 && <span className="ml-1.5 text-berry" aria-label={`${inbox?.requestIds.length} waiting`}>{inbox?.requestIds.length}</span>}
          </button>
        ))}
      </div>

      {notice && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-plum/20 px-3 py-2 text-sm text-fg">
          <Check className="h-4 w-4 shrink-0 text-berry" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="flex h-8 w-8 items-center justify-center text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
      )}
      {inbox?.reconnecting && !inbox.error && (
        <p role="status" data-testid="inbox-reconnecting" className="mb-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reconnecting live updates…</p>
      )}
      {inbox?.error && !error && (
        <p role="status" data-testid="inbox-sync-error" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-xs text-muted">
          <span>{inbox.error}</span>
          {inbox.retry && <button type="button" onClick={() => { inbox.retry?.(); void loadPairs(true, true); }} className="shrink-0 font-semibold text-berry underline underline-offset-4">Retry</button>}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-3 flex items-center gap-3 rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-sm text-fg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadPairs()} className="shrink-0 font-semibold text-berry underline underline-offset-4">Retry</button>
        </div>
      )}

      {section === 'requests' ? (
        <ConnectionRequestsPanel rev={inbox?.rev ?? 0} onChanged={() => void loadPairs(true, true)} onOpenConversation={openPair} onBlockMember={onBlockMember} />
      ) : loading ? (
        <InboxSkeleton />
      ) : !loadedOnce.current ? null : (
        <>
          {acceptedNotes.length > 0 && (
            <ul className="mb-4 space-y-2" aria-label="Notifications">
              {acceptedNotes.map((pair) => (
                <li key={pair.id}>
                  <button
                    type="button"
                    onClick={() => openPair(pair.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-berry/40 bg-plum/25 p-3 text-left transition-colors hover:bg-plum/40 active:bg-plum/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-berry" role="img" aria-label="Unread" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">Connection request accepted!</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted">{nameOf(pair.partner)} accepted your connection request. You can now start chatting on QUEERSPACE.</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div ref={invitationsRef} className="scroll-mt-20">
            <SectionHeader title="Invitations" count={pendingReceived.length + pendingSent.length} />
            {!hasInvitations ? (
              <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted"><Inbox className="h-4 w-4 text-subtle" /> Inbox is quiet.</p>
            ) : (
              <ul className="space-y-2">
                {pendingReceived.map((invitation) => {
                  const name = nameOf(invitation.partner);
                  return (
                    <li key={invitation.id}>
                      <button
                        type="button"
                        onClick={() => { setInvitationError(null); setSelectedInvitationId(invitation.id); }}
                        aria-label={`Open connection request from ${name}`}
                        className="flex w-full items-center gap-3 rounded-2xl border border-lavender/25 bg-raised/70 p-3 text-left transition-colors hover:bg-raised active:bg-plum/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
                      >
                        <PartnerAvatar avatar={invitation.partner?.avatar} seed={invitation.id} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg">{name}</p>
                          <p className="mt-0.5 text-xs text-subtle">Wants to connect · {formatShortDate(invitation.createdAt)}</p>
                          {invitation.message && <p className="mt-1 line-clamp-1 [overflow-wrap:anywhere] text-sm text-muted">{invitation.message}</p>}
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                      </button>
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
                    <button type="button" onClick={async () => { const failure = await respondToInvitation(invitation, 'revoke'); if (failure) setError(failure); }} disabled={invitationActionId !== null} className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-muted hover:text-fg disabled:opacity-50">{invitationActionId === invitation.id ? 'Withdrawing…' : 'Withdraw'}</button>
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
              <ul className="space-y-0.5">
                {activePairs.map((pair) => {
                  const name = nameOf(pair.partner);
                  const unreadText = formatUnread(inbox?.unread[pair.id]);
                  const latest = inbox?.last[pair.id];
                  return (
                    <li key={pair.id}>
                      <button
                        type="button"
                        onClick={() => openPair(pair.id)}
                        aria-label={unreadText ? `Open chat with ${name}, ${unreadText} unread` : `Open chat with ${name}`}
                        className={`-mx-2 flex min-h-16 w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-raised/60 active:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${unreadText ? 'bg-berry/[0.07]' : ''}`}
                      >
                        <PartnerAvatar avatar={pair.partner?.avatar} seed={pair.id} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-tight text-fg">{name}</p>
                          {latest ? (
                            <p className={`mt-0.5 truncate text-xs ${unreadText ? 'font-medium text-fg/90' : 'text-subtle'}`}>
                              {latest.mine && <span className="text-subtle">You: </span>}{latest.text}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs text-subtle">Since {formatShortDate(pair.createdAt)}</p>
                          )}
                        </div>
                        {unreadText && (
                          <span data-testid="unread-badge" aria-hidden="true" className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-berry px-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold leading-none tabular-nums text-ink">
                            {unreadText}
                          </span>
                        )}
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

          {/* The end of what is loaded: more arrives when this comes into view, with a small indicator while it does. */}
          <div ref={endSentinel} aria-hidden={!loadingMore && !moreError} className="flex min-h-8 items-center justify-center py-2 text-xs text-subtle">
            {loadingMore && <span role="status" className="inline-flex items-center gap-1.5"><LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-berry" aria-hidden="true" /> Loading more…</span>}
            {moreError && (
              <span role="alert">Couldn’t load more. <button type="button" onClick={() => void loadMore()} className="font-semibold text-berry underline underline-offset-4">Try again</button></span>
            )}
            {nextCursor && !loadingMore && !moreError && typeof IntersectionObserver === 'undefined' && (
              <button type="button" onClick={() => void loadMore()} className="font-semibold text-berry underline underline-offset-4">Show more</button>
            )}
          </div>
        </>
      )}
    </section>
      {selectedInvitation && (
        <Sheet
          title="Connection request"
          size="md"
          trapFocus
          onClose={closeInvitation}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => void answerFromDialog(selectedInvitation, 'decline')} disabled={invitationActionId !== null} className="btn btn-ghost w-full sm:w-auto">
                {invitationAction === 'decline' ? 'Declining…' : 'Decline'}
              </button>
              <button type="button" onClick={() => void answerFromDialog(selectedInvitation, 'accept')} disabled={invitationActionId !== null} className="btn btn-primary w-full sm:w-auto">
                {invitationAction === 'accept' ? 'Accepting…' : 'Accept'}
              </button>
            </div>
          }
        >
          <div className="flex items-center gap-3">
            <PartnerAvatar avatar={selectedInvitation.partner?.avatar} seed={selectedInvitation.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:calc(16px_*_var(--fs,1))] font-semibold leading-tight text-fg">{nameOf(selectedInvitation.partner)}</p>
              <p className="mt-0.5 text-xs text-subtle">Wants to connect · {formatShortDate(selectedInvitation.createdAt)}</p>
            </div>
          </div>
          {selectedInvitation.message
            ? <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-raised/70 px-3 py-2.5 text-sm leading-snug text-fg">{selectedInvitation.message}</p>
            : <p className="mt-3 text-sm text-subtle">No message was included.</p>}
          {invitationError && <p role="alert" className="mt-3 text-sm text-danger">{invitationError}</p>}
        </Sheet>
      )}
      {privacyOpen && (
        <Sheet title="Private connections" size="sm" icon={<ShieldCheck className="h-5 w-5" />} onClose={() => setPrivacyOpen(false)}>
          <p className="text-sm leading-relaxed text-muted">Only you can view your connections. Ending a connection closes it here; no message is sent.</p>
        </Sheet>
      )}
    </>
  );
};
