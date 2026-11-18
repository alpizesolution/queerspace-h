import React from 'react';

/** Badge text for unread team replies: nothing at zero, the number up to 9, then "9+". */
export function supportBadgeText(count: number): string {
  if (!Number.isFinite(count) || count < 1) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

/**
 * Small violet count beside "Chat with us". It sits in the flow of the label (not over it), so it never covers text on phones,
 * and it does not animate.
 */
export const SupportUnreadBadge: React.FC<{ count: number; className?: string }> = ({ count, className = '' }) => {
  const text = supportBadgeText(count);
  if (!text) return null;
  return (
    <span
      data-testid="support-unread-badge"
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lavender px-1 text-[length:calc(10.5px_*_var(--fs,1))] font-bold leading-none tabular-nums text-ink ${className}`}
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{count === 1 ? '1 new reply from the team' : `${count > 9 ? 'More than 9' : count} new replies from the team`}</span>
    </span>
  );
};
