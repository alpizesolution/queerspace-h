import React, { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { nextResetLabel, QUOTA_EVENT } from '../utils/quotaGuard.ts';

/** Shown once when the free Firestore quota runs out for the day (see utils/quotaGuard.ts). */
export const QuotaNotice: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(QUOTA_EVENT, show);
    return () => window.removeEventListener(QUOTA_EVENT, show);
  }, []);

  if (!open) return null;
  return (
    <Sheet
      title="Our little universe is resting!"
      icon={<Moon className="w-5 h-5 text-lavender" />}
      size="sm"
      onClose={() => setOpen(false)}
      footer={
        <button onClick={() => setOpen(false)} className="btn btn-primary w-full">
          Okay
        </button>
      }
    >
      <p>Daily stars reset at {nextResetLabel()}. See you soon 💜</p>
    </Sheet>
  );
};
