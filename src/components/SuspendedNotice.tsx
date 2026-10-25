import React from 'react';
import { ShieldAlert } from 'lucide-react';

/** Shown to an account the team has paused. It can still read, and reach the team to appeal. */
export const SuspendedNotice: React.FC<{ onContact: () => void }> = ({ onContact }) => (
  <div role="alert" className="mx-4 mt-4 sm:mx-auto sm:max-w-2xl card border-danger/40 p-4 flex items-start gap-3">
    <ShieldAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
    <div className="min-w-0">
      <p className="text-[14px] font-semibold text-fg">Your account is paused</p>
      <p className="mt-1 text-[13px] text-muted leading-snug">
        Someone reported this account, so matching, chatting and posting are paused while the team reviews it. You can
        still read. If you think this is a mistake, message us.
      </p>
      <button onClick={onContact} className="mt-2 text-[13px] font-medium text-berry underline cursor-pointer">
        Chat with us
      </button>
    </div>
  </div>
);
