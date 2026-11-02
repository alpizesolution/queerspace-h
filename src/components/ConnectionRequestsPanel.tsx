import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Flag, LoaderCircle, MessageCircle, UserRound, UserX } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { ExpandableText } from './ExpandableText.tsx';
import {
  EMPTY_REQUESTS,
  orderRequests,
  pendingCount,
  postReference,
  STATUS_LABELS,
  type ConnectionRequest,
  type RequestLists,
} from '../utils/connectionRequests.ts';
import { INTENTION_LABELS } from '../utils/lookingFor.ts';
import { formatRelativeTime } from '../utils/relativeTime.ts';
import { answerConnectionRequest, fetchConnectionRequests, reportRequestMember } from '../services/connectionRequestsService.ts';
import { REPORT_REASONS } from '../services/lookingForService.ts';

interface Props {
  /** The live feed's revision: when it changes, the lists are refreshed. */
  rev: number;
  /** A conversation was opened or changed, so the Signals list should refresh too. */
  onChanged: () => void;
  onOpenConversation: (conversationId: string) => void;
  onBlockMember?: (memberId: string) => void;
  initialTab?: 'incoming' | 'sent';
}

type Target = { kind: 'decline' | 'withdraw' | 'block' | 'report' | 'profile'; request: ConnectionRequest };

const nameOf = (r: ConnectionRequest) => r.partner.displayName || 'Anonymous member';

const StatusBadge: React.FC<{ status: ConnectionRequest['status'] }> = ({ status }) => (
  <span className={`inline-flex items-center h-5 px-2 rounded-full text-[length:calc(11px_*_var(--fs,1))] font-semibold ${
    status === 'pending' ? 'bg-plum/30 text-lavender border border-lavender/20'
      : status === 'accepted' ? 'bg-berry/15 text-berry border border-berry/30'
        : 'bg-raised text-subtle border border-line'
  }`}>
    {STATUS_LABELS[status]}
  </span>
);

/** Incoming and Sent connection requests, with every action the Signals API allows each side. */
export const ConnectionRequestsPanel: React.FC<Props> = ({ rev, onChanged, onOpenConversation, onBlockMember, initialTab = 'incoming' }) => {
  const [lists, setLists] = useState<RequestLists>(EMPTY_REQUESTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<'incoming' | 'sent'>(initialTab);
  const picked = React.useRef(false);
  const setTab = (next: 'incoming' | 'sent') => {
    picked.current = true;
    setTabState(next);
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const result = await fetchConnectionRequests();
    if (result.ok) {
      setLists(result.lists);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lastRev = React.useRef(rev);
  useEffect(() => {
    if (rev === lastRev.current) return;
    lastRev.current = rev;
    void load(true);
  }, [rev, load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Someone who only has sent requests lands on Sent, so they don't open onto an empty list. Their own choice always wins.
  useEffect(() => {
    if (loading || picked.current) return;
    if (lists.incoming.length === 0 && lists.sent.length > 0) setTabState('sent');
  }, [loading, lists]);

  const incoming = useMemo(() => orderRequests(lists.incoming), [lists.incoming]);
  const sent = useMemo(() => orderRequests(lists.sent), [lists.sent]);
  const waitingIn = pendingCount(lists.incoming);
  const waitingOut = pendingCount(lists.sent);

  const answer = async (action: 'accept' | 'decline' | 'withdraw', request: ConnectionRequest, success: string) => {
    if (busyId) return false;
    setBusyId(request.id);
    const result = await answerConnectionRequest(action, request.id);
    setBusyId(null);
    if (!result.ok) {
      setNotice({ text: result.message, ok: false });
      void load(true);
      return false;
    }
    setNotice({ text: result.status === 'expired' ? 'This request expired.' : success, ok: true });
    await load(true);
    onChanged();
    return true;
  };

  const confirm = async () => {
    if (!target) return;
    const { kind, request } = target;
    if (kind === 'decline') await answer('decline', request, 'Request declined.');
    if (kind === 'withdraw') await answer('withdraw', request, 'Request withdrawn.');
    if (kind === 'block') {
      onBlockMember?.(request.memberId);
      // A blocked member's request is closed quietly, so it can't be accepted later.
      await answer('decline', request, 'Blocked. Their request was declined.');
    }
    setTarget(null);
  };

  const sendReport = async () => {
    if (!target) return;
    setBusyId(target.request.id);
    const ok = await reportRequestMember(target.request.memberId, reason);
    setBusyId(null);
    setTarget(null);
    setNotice(ok ? { text: 'Thanks. Our safety team will review this.', ok: true } : { text: 'Couldn’t send your report. Please try again.', ok: false });
  };

  const card = (request: ConnectionRequest, direction: 'incoming' | 'sent') => {
    const ref = postReference(request, INTENTION_LABELS[request.intention] ?? 'Looking For');
    const busy = busyId === request.id;
    const pending = request.status === 'pending';
    return (
      <li key={request.id} className="rounded-2xl border border-line bg-raised/60 p-3.5">
        <div className="flex items-start gap-3">
          <AnimalAvatar avatar={request.partner.avatar ?? undefined} seed={request.memberId} className="w-10 h-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">
              {nameOf(request)} {request.partner.pronouns && <span className="font-normal text-subtle text-[length:calc(13px_*_var(--fs,1))]">{request.partner.pronouns}</span>}
            </p>
            <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
              {direction === 'incoming' ? 'Wants to connect' : 'You asked'} · {request.createdAt ? formatRelativeTime(Date.parse(request.createdAt)) : ''}
            </p>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <p className="mt-2.5 text-[length:calc(12px_*_var(--fs,1))] text-muted">
          About {ref.text}
        </p>
        {ref.notice && <p className="mt-0.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">{ref.notice}</p>}

        {request.message && (
          <div className="mt-2 rounded-xl bg-ink/50 border border-line px-3 py-2">
            <ExpandableText text={request.message} className="text-[length:calc(14px_*_var(--fs,1))] text-fg leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]" />
          </div>
        )}

        {direction === 'incoming' && pending && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTarget({ kind: 'decline', request })} disabled={busy} className="btn btn-secondary btn-sm">Decline</button>
              <button type="button" onClick={() => void answer('accept', request, `Accepted. You can now message ${nameOf(request)}.`)} disabled={busy} className="btn btn-primary btn-sm">
                {busy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Accept
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1 -ml-2 text-[length:calc(12px_*_var(--fs,1))]">
              <button type="button" onClick={() => setTarget({ kind: 'profile', request })} className="inline-flex items-center gap-1 h-8 px-2 rounded-full text-subtle hover:text-fg"><UserRound className="w-3.5 h-3.5" /> View profile</button>
              <button type="button" onClick={() => { setReason(REPORT_REASONS[0]); setTarget({ kind: 'report', request }); }} className="inline-flex items-center gap-1 h-8 px-2 rounded-full text-subtle hover:text-fg"><Flag className="w-3.5 h-3.5" /> Report</button>
              {onBlockMember && <button type="button" onClick={() => setTarget({ kind: 'block', request })} className="inline-flex items-center gap-1 h-8 px-2 rounded-full text-subtle hover:text-danger"><UserX className="w-3.5 h-3.5" /> Block</button>}
            </div>
            <p className="mt-1 text-[length:calc(11px_*_var(--fs,1))] text-subtle leading-snug">Accepting lets them message you. It isn’t consent to dating or anything else.</p>
          </>
        )}

        {direction === 'sent' && pending && (
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setTarget({ kind: 'withdraw', request })} disabled={busy} className="btn btn-ghost btn-sm">{busy ? 'Withdrawing…' : 'Withdraw'}</button>
          </div>
        )}

        {request.status === 'accepted' && request.conversationId && (
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => onOpenConversation(request.conversationId as string)} className="btn btn-primary btn-sm"><MessageCircle className="w-4 h-4" /> Open conversation</button>
          </div>
        )}
      </li>
    );
  };

  const list = tab === 'incoming' ? incoming : sent;

  return (
    <div>
      <div role="tablist" aria-label="Request direction" className="grid grid-cols-2 gap-1 rounded-full border border-line bg-ink p-1 mb-4">
        {([['incoming', 'Incoming', waitingIn], ['sent', 'Sent', waitingOut]] as const).map(([id, label, count]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-9 rounded-full text-[length:calc(13px_*_var(--fs,1))] font-semibold transition-colors cursor-pointer ${tab === id ? 'bg-raised text-fg ring-1 ring-berry/40' : 'text-muted hover:text-fg'}`}>
            {label}{count > 0 && <span className="ml-1.5 text-berry">{count}</span>}
          </button>
        ))}
      </div>

      {notice && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-plum/20 px-3 py-2 text-sm text-fg">
          <Check className={`h-4 w-4 shrink-0 ${notice.ok ? 'text-berry' : 'text-danger'}`} />
          <span className="min-w-0 flex-1">{notice.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Loading requests…</div>
      ) : error ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-berry/30 bg-plum/20 px-3 py-2 text-sm text-fg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="shrink-0 font-semibold text-berry underline underline-offset-4">Retry</button>
        </div>
      ) : list.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">{tab === 'incoming' ? 'No requests yet' : 'You haven’t sent any requests'}</p>
          <p className="mt-1 text-[length:calc(13px_*_var(--fs,1))] text-muted">
            {tab === 'incoming' ? 'When someone is interested in your Looking For post, their request appears here.' : 'Find someone in Cosmos → Looking For and send a connection request.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">{list.map((request) => card(request, tab))}</ul>
      )}

      {target && (target.kind === 'decline' || target.kind === 'withdraw' || target.kind === 'block') && (
        <ConfirmDialog
          title={target.kind === 'decline' ? 'Decline this request?' : target.kind === 'withdraw' ? 'Withdraw your request?' : `Block ${nameOf(target.request)}?`}
          message={
            target.kind === 'decline' ? `No conversation will open. ${nameOf(target.request)} will see it as declined in their Sent list.`
              : target.kind === 'withdraw' ? `${nameOf(target.request)} will no longer be able to accept it.`
                : 'Their request will be declined, you won’t see their posts, and they won’t be able to contact you.'
          }
          confirmLabel={target.kind === 'decline' ? 'Decline' : target.kind === 'withdraw' ? 'Withdraw' : 'Block'}
          tone={target.kind === 'withdraw' ? 'primary' : 'danger'}
          busy={busyId === target.request.id}
          onConfirm={() => void confirm()}
          onCancel={() => { if (!busyId) setTarget(null); }}
        />
      )}

      {target?.kind === 'report' && (
        <Sheet
          title="Report this member"
          size="sm"
          onClose={() => setTarget(null)}
          footer={<button type="button" onClick={() => void sendReport()} disabled={busyId !== null} className="btn btn-primary w-full">{busyId ? 'Sending…' : 'Send report'}</button>}
        >
          <div role="radiogroup" aria-label="Reason" className="space-y-1.5">
            {REPORT_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`flex w-full items-center gap-3 min-h-11 rounded-xl border px-3 text-left text-sm transition-colors cursor-pointer ${reason === r ? 'border-berry bg-raised text-fg' : 'border-line text-muted hover:text-fg'}`}>
                <span className={`h-4 w-4 shrink-0 rounded-full border ${reason === r ? 'border-berry bg-berry' : 'border-line-strong'}`} aria-hidden="true" />
                {r}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">Reports go to our safety team. They are never shown to the other member.</p>
        </Sheet>
      )}

      {target?.kind === 'profile' && (
        <Sheet title="Profile preview" size="sm" onClose={() => setTarget(null)}>
          <div className="flex items-center gap-3">
            <AnimalAvatar avatar={target.request.partner.avatar ?? undefined} seed={target.request.memberId} className="w-14 h-14" />
            <div className="min-w-0">
              <p className="truncate text-[length:calc(17px_*_var(--fs,1))] font-semibold text-fg">{nameOf(target.request)}</p>
              {target.request.partner.pronouns && <p className="text-sm text-subtle">{target.request.partner.pronouns}</p>}
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{target.request.partner.about || 'They haven’t added an about-me yet.'}</p>
          <p className="mt-3 text-xs text-subtle">This is only what they chose to make public.</p>
        </Sheet>
      )}
    </div>
  );
};
