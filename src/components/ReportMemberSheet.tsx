import React, { useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { REPORT_REASONS } from '../services/lookingForService.ts';
import { reportRequestMember } from '../services/connectionRequestsService.ts';

/** Reports a member to the safety team through the existing Reports workflow. The report is never shown to the member. */
export const ReportMemberSheet: React.FC<{
  memberId: string;
  context: string;
  onClose: () => void;
  onDone: (ok: boolean) => void;
}> = ({ memberId, context, onClose, onDone }) => {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [sending, setSending] = useState(false);
  return (
    <Sheet
      title="Report this member"
      size="sm"
      onClose={() => { if (!sending) onClose(); }}
      footer={
        <button
          type="button"
          disabled={sending}
          onClick={async () => { setSending(true); const ok = await reportRequestMember(memberId, `${context}: ${reason}`); setSending(false); onDone(ok); }}
          className="btn btn-primary w-full"
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
      }
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
  );
};
