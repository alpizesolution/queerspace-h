import React from 'react';
import { MessageCircleHeart } from 'lucide-react';

/** Label for an age-review item in the Reports list. */
export const AgeReviewTag: React.FC = () => (
  <span className="tag !text-berry !bg-berry/10">Age review</span>
);

/** What the admin can do with an age-review item, and the way to the member's support thread. */
export const AgeReviewHelp: React.FC<{ onOpenSupport: () => void }> = ({ onOpenSupport }) => (
  <div className="mt-2 rounded-xl bg-raised px-3 py-2.5">
    <p className="text-[length:calc(13px_*_var(--fs,1))] leading-snug text-muted">
      Their birthday isn’t stored, so it can’t be checked here. If they message us, follow up in their support chat.
    </p>
    <button type="button" onClick={onOpenSupport} className="btn btn-secondary btn-sm mt-2">
      <MessageCircleHeart className="w-4 h-4" /> Open support chat
    </button>
  </div>
);
