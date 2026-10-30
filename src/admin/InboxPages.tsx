import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, Eye, RotateCcw, Trash2, X } from 'lucide-react';
import { deleteInboxItem, loadDisplayName, setInboxStatus } from '../services/adminService.ts';
import type { AdminReport, AdminSuggestion, ReportStatus, SuggestionStatus } from '../services/adminInboxService.ts';
import { liftSuspension, loadSuspensions, suspendUser, type Suspension } from '../services/suspensionService.ts';
import { needsCrisisSupport } from '../services/unsaidService.ts';
import { isAgeReview } from '../utils/ageReview.ts';
import { AgeReviewHelp, AgeReviewTag } from './AgeReviewMarks.tsx';

export interface PageConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

interface PageProps<T> {
  items: T[] | null;
  /** The live listener stopped; the page keeps showing what it has. */
  liveError: boolean;
  onRetryLive: () => void;
  onConfirm: (c: PageConfirm) => void;
  formatAgo: (ms: number) => string;
  /** A submission to jump to (from a toast): its filter opens and it scrolls into view. */
  focusId: string | null;
  onFocusHandled: () => void;
}

const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-center text-sm text-muted py-14">{text}</p>;

const Skeleton: React.FC = () => (
  <div className="space-y-3" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <div key={i} className="card h-24 animate-pulse" />
    ))}
  </div>
);

const LiveNotice: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div role="alert" className="card mb-4 flex items-center gap-3 p-3 text-[length:calc(13px_*_var(--fs,1))] text-muted">
    <span className="flex-1">Live updates paused. What you see may be out of date.</span>
    <button onClick={onRetry} className="font-semibold text-berry underline underline-offset-4">
      Retry
    </button>
  </div>
);

function FilterChips<S extends string>({
  options,
  value,
  counts,
  onChange,
  label,
}: {
  options: readonly (readonly [S, string])[];
  value: S;
  counts: Record<S, number>;
  onChange: (next: S) => void;
  label: string;
}) {
  return (
    <div className="flex gap-2 mb-4 flex-wrap" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} aria-pressed={value === id} onClick={() => onChange(id)} className="chip">
          {text}
          {counts[id] ? <span className="ml-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold text-berry">{counts[id]}</span> : null}
        </button>
      ))}
    </div>
  );
}

const absolute = (ms: number) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** Opens the item's filter and scrolls it into view with a brief highlight; runs once per requested id. */
function useFocusItem<T extends { id: string }, S extends string>(
  focusId: string | null,
  items: T[] | null,
  statusOf: (item: T) => S,
  setFilter: (s: S) => void,
  onHandled: () => void
) {
  useEffect(() => {
    if (!focusId || !items) return;
    const item = items.find((i) => i.id === focusId);
    if (!item) return;
    setFilter(statusOf(item));
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`inbox-item-${focusId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('ring-2', 'ring-berry/70');
      window.setTimeout(() => el?.classList.remove('ring-2', 'ring-berry/70'), 2200);
      onHandled();
    }, 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, items === null]);
}

function useActionError() {
  const [failed, setFailed] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setFailed(false);
    try {
      await action();
    } catch (err) {
      console.warn('[Admin] Action failed:', err);
      setFailed(true);
    }
  };
  const notice = failed ? (
    <p role="alert" className="mb-3 text-[length:calc(13px_*_var(--fs,1))] text-danger">
      Couldn’t save that change. Check your connection and try again.
    </p>
  ) : null;
  return { run, notice };
}

// ---------------------------------------------------------------- Suggestions

const SUGGESTION_FILTERS = [
  ['open', 'New'],
  ['reviewed', 'Reviewed'],
  ['in_progress', 'In progress'],
  ['implemented', 'Implemented'],
  ['archived', 'Archived'],
] as const;

const SUGGESTION_LABEL: Record<SuggestionStatus, string> = Object.fromEntries(SUGGESTION_FILTERS) as Record<SuggestionStatus, string>;

const SUGGESTION_ACTIONS: { to: SuggestionStatus; label: string; icon: typeof Check }[] = [
  { to: 'reviewed', label: 'Reviewed', icon: Eye },
  { to: 'in_progress', label: 'In progress', icon: RotateCcw },
  { to: 'implemented', label: 'Implemented', icon: Check },
  { to: 'archived', label: 'Archive', icon: X },
];

const EMPTY_SUGGESTIONS: Record<SuggestionStatus, string> = {
  open: 'Inbox zero. Nothing new.',
  reviewed: 'Nothing reviewed yet.',
  in_progress: 'Nothing in progress.',
  implemented: 'Nothing implemented yet.',
  archived: 'Nothing archived.',
};

export const SuggestionsPage: React.FC<PageProps<AdminSuggestion>> = ({ items, liveError, onRetryLive, onConfirm, formatAgo, focusId, onFocusHandled }) => {
  const [filter, setFilter] = useState<SuggestionStatus>('open');
  const { run, notice } = useActionError();
  useFocusItem(focusId, items, (s: AdminSuggestion) => s.status, setFilter, onFocusHandled);
  const counts = useMemo(() => {
    const c = { open: 0, reviewed: 0, in_progress: 0, implemented: 0, archived: 0 } as Record<SuggestionStatus, number>;
    items?.forEach((s) => (c[s.status] += 1));
    return c;
  }, [items]);
  const visible = items?.filter((s) => s.status === filter) ?? [];

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
        {items && <span className="text-[length:calc(13px_*_var(--fs,1))] text-muted tabular-nums">{counts.open} pending</span>}
      </div>
      {liveError && <LiveNotice onRetry={onRetryLive} />}
      {notice}
      <FilterChips label="Suggestion status" options={SUGGESTION_FILTERS} value={filter} counts={counts} onChange={setFilter} />
      {!items ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        <Empty text={EMPTY_SUGGESTIONS[filter]} />
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => (
            <li key={s.id} id={`inbox-item-${s.id}`} className="card p-4 transition-shadow">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="tag capitalize">{s.category}</span>
                {s.status !== 'open' && <span className="tag !text-lavender">{SUGGESTION_LABEL[s.status]}</span>}
                <span className="text-[length:calc(12px_*_var(--fs,1))] text-subtle" title={absolute(s.createdAt)}>
                  {formatAgo(s.createdAt)} · {absolute(s.createdAt)}
                </span>
              </div>
              <p className="text-[length:calc(15px_*_var(--fs,1))] text-fg leading-relaxed whitespace-pre-wrap break-words">{s.text}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {SUGGESTION_ACTIONS.filter((a) => a.to !== s.status).map(({ to, label, icon: Icon }) => (
                  <button key={to} onClick={() => run(() => setInboxStatus('suggestions', s.id, to))} className="btn btn-secondary btn-sm">
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
                {s.status !== 'open' && (
                  <button onClick={() => run(() => setInboxStatus('suggestions', s.id, 'open'))} className="btn btn-secondary btn-sm">
                    <RotateCcw className="w-4 h-4" /> Mark new
                  </button>
                )}
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this suggestion?',
                      message: 'It’s removed for good.',
                      confirmLabel: 'Delete',
                      run: () => deleteInboxItem('suggestions', s.id),
                    })
                  }
                  className="icon-btn w-9 h-9 ml-auto"
                  aria-label="Delete suggestion"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Reports

const REPORT_FILTERS = [
  ['open', 'Open'],
  ['reviewing', 'Reviewing'],
  ['resolved', 'Resolved'],
  ['dismissed', 'Dismissed'],
] as const;

const REPORT_LABEL: Record<ReportStatus, string> = Object.fromEntries(REPORT_FILTERS) as Record<ReportStatus, string>;

const EMPTY_REPORTS: Record<ReportStatus, string> = {
  open: 'No open reports. All calm.',
  reviewing: 'Nothing under review.',
  resolved: 'Nothing resolved yet.',
  dismissed: 'Nothing dismissed.',
};

/** How many reports a member needs before the pile counts as urgent. */
export const URGENT_REPORT_COUNT = 3;

/** An age review, repeated reports about one member, or wording that suggests someone is at risk. */
export function isUrgentReport(r: AdminReport, reportsAboutTarget: number): boolean {
  if (r.status !== 'open' && r.status !== 'reviewing') return false;
  if (r.targetType === 'user' && isAgeReview(r.reason)) return true;
  if (r.targetType === 'user' && reportsAboutTarget >= URGENT_REPORT_COUNT) return true;
  return needsCrisisSupport(r.reason);
}

function describeTarget(r: AdminReport, names: Record<string, string | null>): string {
  if (r.reason.startsWith('Unsaid:')) return 'Unsaid post';
  if (r.targetType === 'user') return names[r.targetId] ? `User “${names[r.targetId]}”` : 'User';
  if (r.targetType === 'message') return 'Message';
  return 'Post';
}

export const ReportsPage: React.FC<PageProps<AdminReport> & { onOpenSupport: (uid: string) => void }> = ({
  items,
  liveError,
  onRetryLive,
  onConfirm,
  formatAgo,
  focusId,
  onFocusHandled,
  onOpenSupport,
}) => {
  const [filter, setFilter] = useState<ReportStatus>('open');
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [suspensions, setSuspensions] = useState<Record<string, Suspension>>({});
  const { run, notice } = useActionError();
  useFocusItem(focusId, items, (r: AdminReport) => r.status, setFilter, onFocusHandled);
  const counts = useMemo(() => {
    const c = { open: 0, reviewing: 0, resolved: 0, dismissed: 0 } as Record<ReportStatus, number>;
    items?.forEach((r) => (c[r.status] += 1));
    return c;
  }, [items]);
  const visible = items?.filter((r) => r.status === filter) ?? [];
  // How many reports each user has, so repeat offenders stand out.
  const reportCounts = useMemo(() => {
    const out: Record<string, number> = {};
    items?.forEach((r) => {
      if (r.targetType === 'user') out[r.targetId] = (out[r.targetId] ?? 0) + 1;
    });
    return out;
  }, [items]);
  const urgentOpen = items?.filter((r) => isUrgentReport(r, reportCounts[r.targetId] ?? 0) && r.status === 'open').length ?? 0;

  useEffect(() => {
    loadSuspensions().then(setSuspensions).catch(() => {});
  }, []);

  useEffect(() => {
    const missing = [...new Set(visible.filter((r) => r.targetType === 'user').map((r) => r.targetId))].filter((id) => !(id in names));
    missing.forEach((id) => loadDisplayName(id).then((name) => setNames((prev) => ({ ...prev, [id]: name }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((r) => r.id).join()]);

  const confirmSuspend = (r: AdminReport) =>
    onConfirm({
      title: `Suspend ${names[r.targetId] ? `“${names[r.targetId]}”` : 'this user'}?`,
      message: 'They can still read and message support, but can’t match, chat or post until you lift it.',
      confirmLabel: 'Suspend',
      run: async () => {
        await suspendUser(r.targetId, r.reason, r.id);
        setSuspensions((prev) => ({ ...prev, [r.targetId]: { uid: r.targetId, source: 'admin', reason: r.reason, createdAt: Date.now() } }));
      },
    });

  const confirmLift = (r: AdminReport) =>
    onConfirm({
      title: 'Lift this suspension?',
      message: 'They can match, chat and post again right away.',
      confirmLabel: 'Lift suspension',
      run: async () => {
        await liftSuspension(r.targetId);
        setSuspensions((prev) => {
          const next = { ...prev };
          delete next[r.targetId];
          return next;
        });
      },
    });

  const setStatus = (r: AdminReport, to: ReportStatus) => run(() => setInboxStatus('reports', r.id, to));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        {items && (
          <span className="text-[length:calc(13px_*_var(--fs,1))] text-muted tabular-nums">
            {counts.open} open{urgentOpen ? <span className="text-danger"> · {urgentOpen} urgent</span> : null}
          </span>
        )}
      </div>
      <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mb-4">Flagged Unsaid posts can be restored or removed under Moderation.</p>
      {liveError && <LiveNotice onRetry={onRetryLive} />}
      {notice}
      <FilterChips label="Report status" options={REPORT_FILTERS} value={filter} counts={counts} onChange={setFilter} />
      {!items ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        <Empty text={EMPTY_REPORTS[filter]} />
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => {
            const urgent = isUrgentReport(r, reportCounts[r.targetId] ?? 0);
            return (
              <li key={r.id} id={`inbox-item-${r.id}`} className={`card p-4 transition-shadow ${urgent ? '!border-danger/60' : ''}`}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {urgent && (
                    <span className="tag !text-danger !bg-danger/10">
                      <AlertTriangle className="w-3 h-3 mr-1 inline" aria-hidden="true" />
                      Urgent
                    </span>
                  )}
                  {r.targetType === 'user' && isAgeReview(r.reason) && <AgeReviewTag />}
                  <span className="tag !text-danger">{describeTarget(r, names)}</span>
                  {r.status !== 'open' && <span className="tag !text-lavender">{REPORT_LABEL[r.status]}</span>}
                  {suspensions[r.targetId] && (
                    <span className="tag !text-danger !bg-danger/10">Suspended{suspensions[r.targetId].source === 'auto-underage' ? ' · auto' : ''}</span>
                  )}
                  {(reportCounts[r.targetId] ?? 0) > 1 && (
                    <span className="text-[length:calc(12px_*_var(--fs,1))] font-medium text-danger">{reportCounts[r.targetId]} reports</span>
                  )}
                  <span className="text-[length:calc(12px_*_var(--fs,1))] text-subtle" title={absolute(r.createdAt)}>
                    {formatAgo(r.createdAt)} · {absolute(r.createdAt)}
                  </span>
                </div>
                <p className="text-[length:calc(15px_*_var(--fs,1))] text-fg">{r.reason.replace(/^Unsaid:\s*/, '')}</p>
                <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle mt-1 font-mono break-all">
                  {r.targetType === 'user' ? 'user' : 'id'}: {r.targetId}
                </p>
                {r.targetType === 'user' && isAgeReview(r.reason) && <AgeReviewHelp onOpenSupport={() => onOpenSupport(r.targetId)} />}
                <div className="flex flex-wrap gap-2 mt-3">
                  {r.status === 'open' && (
                    <button onClick={() => setStatus(r, 'reviewing')} className="btn btn-secondary btn-sm">
                      <Eye className="w-4 h-4" /> Start review
                    </button>
                  )}
                  {(r.status === 'open' || r.status === 'reviewing') && (
                    <>
                      <button onClick={() => setStatus(r, 'resolved')} className="btn btn-secondary btn-sm">
                        <Check className="w-4 h-4" /> Resolve
                      </button>
                      <button onClick={() => setStatus(r, 'dismissed')} className="btn btn-secondary btn-sm">
                        <X className="w-4 h-4" /> Dismiss
                      </button>
                    </>
                  )}
                  {(r.status === 'resolved' || r.status === 'dismissed') && (
                    <button onClick={() => setStatus(r, 'open')} className="btn btn-secondary btn-sm">
                      <RotateCcw className="w-4 h-4" /> Reopen
                    </button>
                  )}
                  {r.targetType === 'user' &&
                    r.targetId &&
                    (suspensions[r.targetId] ? (
                      <button onClick={() => confirmLift(r)} className="btn btn-secondary btn-sm">
                        <RotateCcw className="w-4 h-4" /> Lift suspension
                      </button>
                    ) : (
                      <button onClick={() => confirmSuspend(r)} className="btn btn-secondary btn-sm !text-danger">
                        <Ban className="w-4 h-4" /> Suspend
                      </button>
                    ))}
                  <button
                    onClick={() =>
                      onConfirm({
                        title: 'Delete this report?',
                        message: 'It’s removed for good.',
                        confirmLabel: 'Delete',
                        run: () => deleteInboxItem('reports', r.id),
                      })
                    }
                    className="icon-btn w-9 h-9 ml-auto"
                    aria-label="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
