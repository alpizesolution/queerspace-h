import React, { useEffect, useState } from 'react';
import { MessageCircleHeart } from 'lucide-react';
import { CleanupResult, PendingCorrection, decideCorrection, listPendingCorrections, runAgePrivacyCleanup } from '../services/birthdayCorrectionService.ts';
import { AgeReviewDetails } from './AgeReviewMarks.tsx';

interface TabConfirm { title: string; message: string; confirmLabel: string; run: () => Promise<void> }
type Decision = 'approve' | 'reject' | 'request-info';
const REASON_MIN = 3;

/** Admin review of birthday correction requests. Decisions are audited server-side without storing birthdays. */
export const BirthdayCorrectionsTab: React.FC<{ onConfirm?: (c: TabConfirm) => void; onOpenSupport?: (uid: string) => void }> = ({ onConfirm, onOpenSupport }) => {
  const [items, setItems] = useState<PendingCorrection[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listPendingCorrections().then(setItems);
  }, []);

  // Reject and "ask for more information" need a reason the member will see (dates in it are removed server-side).
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<{ id: string; decision: 'reject' | 'request-info' } | null>(null);

  const decide = async (id: string, decision: Decision, reason?: string) => {
    setBusyId(id);
    setFailed(false);
    const ok = await decideCorrection(id, decision, reason);
    setBusyId(null);
    if (!ok) { setFailed(true); throw new Error('Decision failed'); }
    setAsking(null);
    // Asking for information keeps the request open; approving or rejecting finishes it.
    if (decision === 'request-info') listPendingCorrections().then(setItems);
    else setItems((current) => (current ?? []).filter((item) => item.id !== id));
  };

  const confirmDecision = (item: PendingCorrection, decision: Decision) => {
    const reason = (reasons[item.id] ?? '').trim();
    const flagged = item.review?.record.manualReview || (item.review?.correction?.flags.length ?? 0) > 0;
    const copy: Record<Decision, { title: string; message: string; label: string }> = {
      approve: {
        title: 'Approve this birthday?',
        message: `The requested birthday replaces the saved one${item.review?.approvedBirthDate ? ' (the current one is kept in their history)' : ''}, and access is re-checked against the 18+ rule. The member is notified.${flagged ? ' This request is flagged, so check the details first.' : ''}`,
        label: 'Approve',
      },
      reject: { title: 'Reject this request?', message: 'Their saved birthday stays as it is. The member is told and sees your reason.', label: 'Reject' },
      'request-info': { title: 'Ask for more information?', message: 'The request stays open and the member sees your question in their support chat.', label: 'Send question' },
    };
    const run = () => decide(item.id, decision, decision === 'approve' ? undefined : reason);
    if (onConfirm) onConfirm({ title: copy[decision].title, message: copy[decision].message, confirmLabel: copy[decision].label, run });
    else if (window.confirm(`${copy[decision].title} ${copy[decision].message}`)) void run().catch(() => {});
  };

  const [cleanup, setCleanup] = useState<CleanupResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);

  const runCleanup = async (dryRun: boolean) => {
    setCleaning(true);
    setCleanupFailed(false);
    const result = await runAgePrivacyCleanup(dryRun);
    setCleaning(false);
    if (result) setCleanup(result);
    else setCleanupFailed(true);
  };

  const cleanupPanel = (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">Age privacy cleanup</h2>
      <p className="mt-1 text-[length:calc(12px_*_var(--fs,1))] text-subtle">
        Removes legacy age fields from profiles and queue entries. Nothing else is touched, and it is safe to run again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={cleaning} onClick={() => runCleanup(true)} className="btn btn-secondary btn-sm">Dry run</button>
        <button disabled={cleaning} onClick={() => runCleanup(false)} className="btn btn-primary btn-sm">{cleaning ? 'Working…' : 'Run cleanup'}</button>
      </div>
      {cleanupFailed && <p role="alert" className="mt-2 text-sm text-danger">Could not run the cleanup. Try again.</p>}
      {cleanup && (
        <p role="status" className="mt-2 text-[length:calc(13px_*_var(--fs,1))] text-fg">
          {cleanup.dryRun ? 'Dry run' : 'Done'}: {cleanup.profiles.changed} of {cleanup.profiles.scanned} profiles and {cleanup.queue.changed} of {cleanup.queue.scanned} queue entries {cleanup.dryRun ? 'would be' : 'were'} cleaned.
        </p>
      )}
    </section>
  );

  if (!items) return <p className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">Loading…</p>;
  if (!items.length) {
    return (
      <div>
        <p className="card p-4 text-[length:calc(13px_*_var(--fs,1))] text-subtle">No birthday corrections waiting.</p>
        {cleanupPanel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {failed && <p role="alert" className="text-sm text-danger">That decision could not be saved. Try again.</p>}
      <ul className="space-y-3">
        {items.map((item) => {
          const review = item.review;
          const reason = (reasons[item.id] ?? '').trim();
          const isAsking = asking?.id === item.id;
          return (
            <li key={item.id} className="card min-w-0 p-4">
              <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle font-mono break-all">
                user: {item.id}{item.status === 'info-requested' ? ' · waiting for the member’s answer' : ''}
              </p>
              <p className="mt-1 text-[length:calc(14px_*_var(--fs,1))] font-medium text-fg">
                Requested birthday: {item.requestedBirthDate ?? 'unknown'}
                {item.requestedAge !== null && <span className="text-subtle"> · age {item.requestedAge}</span>}
              </p>
              {review ? <AgeReviewDetails review={review} /> : (
                <p className="mt-0.5 break-words text-[length:calc(12px_*_var(--fs,1))] text-subtle">{item.reason || 'No reason given.'}</p>
              )}
              {item.createdAt && <p className="mt-2 text-[length:calc(12px_*_var(--fs,1))] text-subtle">Submitted {new Date(item.createdAt).toLocaleString()}</p>}
              {isAsking && (
                <div className="mt-3">
                  <label htmlFor={`reason-${item.id}`} className="label">
                    {asking?.decision === 'reject' ? 'Reason for rejecting' : 'What do you need to know?'} <span className="font-normal text-subtle">· required, shown to the member, no birthdays</span>
                  </label>
                  <textarea id={`reason-${item.id}`} rows={2} maxLength={300} value={reasons[item.id] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [item.id]: e.target.value }))} className="input" />
                  <div className="mt-2 flex gap-2">
                    <button disabled={busyId !== null || reason.length < REASON_MIN} onClick={() => confirmDecision(item, asking!.decision)} className="btn btn-primary btn-sm">Continue</button>
                    <button onClick={() => setAsking(null)} className="btn btn-secondary btn-sm">Cancel</button>
                  </div>
                </div>
              )}
              {!isAsking && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId !== null} onClick={() => setAsking({ id: item.id, decision: 'reject' })} className="btn btn-secondary btn-sm">Reject</button>
                  {item.status !== 'info-requested' && (
                    <button disabled={busyId !== null} onClick={() => setAsking({ id: item.id, decision: 'request-info' })} className="btn btn-secondary btn-sm">Ask for more information</button>
                  )}
                  {onOpenSupport && (
                    <button onClick={() => onOpenSupport(item.id)} className="btn btn-secondary btn-sm"><MessageCircleHeart className="w-4 h-4" /> Open support chat</button>
                  )}
                  <button disabled={busyId !== null} onClick={() => confirmDecision(item, 'approve')} className="btn btn-primary btn-sm">
                    {busyId === item.id ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cleanupPanel}
    </div>
  );
};
