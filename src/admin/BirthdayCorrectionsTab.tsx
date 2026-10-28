import React, { useEffect, useState } from 'react';
import { PendingCorrection, decideCorrection, listPendingCorrections } from '../services/birthdayCorrectionService.ts';

/** Admin review of birthday correction requests. Decisions are audited server-side without storing birthdays. */
export const BirthdayCorrectionsTab: React.FC = () => {
  const [items, setItems] = useState<PendingCorrection[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listPendingCorrections().then(setItems);
  }, []);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id);
    setFailed(false);
    const ok = await decideCorrection(id, decision);
    setBusyId(null);
    if (ok) setItems((current) => (current ?? []).filter((item) => item.id !== id));
    else setFailed(true);
  };

  if (!items) return <p className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">Loading…</p>;
  if (!items.length) return <p className="card p-4 text-[length:calc(13px_*_var(--fs,1))] text-subtle">No birthday corrections waiting.</p>;

  return (
    <div className="space-y-2">
      {failed && <p role="alert" className="text-sm text-danger">That decision could not be saved. Try again.</p>}
      <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[length:calc(14px_*_var(--fs,1))] font-medium text-fg">
                Requested birthday: {item.requestedBirthDate ?? 'unknown'}
                {item.requestedAge !== null && <span className="text-subtle"> · age {item.requestedAge}</span>}
              </p>
              <p className="mt-0.5 break-words text-[length:calc(12px_*_var(--fs,1))] text-subtle">{item.reason || 'No reason given.'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button disabled={busyId !== null} onClick={() => decide(item.id, 'reject')} className="btn btn-secondary btn-sm">Reject</button>
              <button disabled={busyId !== null} onClick={() => decide(item.id, 'approve')} className="btn btn-primary btn-sm">
                {busyId === item.id ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
