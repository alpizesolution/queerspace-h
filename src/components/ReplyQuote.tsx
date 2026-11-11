import React from 'react';

/**
 * The quoted message shown inside a reply bubble: a slim accent bar, the original sender on one line, and the quoted
 * text on one line. Both truncate with an ellipsis, so a long name or a long quote can never make the bubble tall or
 * split a word. The full name and text stay in the accessible label (and the quote itself is never shortened in data).
 *
 * `tone` picks solid, theme-aware colours (no opacity-faded text) for the bubble it sits in.
 */
export type ReplyQuoteTone = 'plum' | 'raised' | 'accent';

const TONES: Record<ReplyQuoteTone, { bar: string; name: string; text: string }> = {
  // Your own bubble in the Galaxy room and Seek chat (plum): the berry accent and muted grey are too faint on plum, so use the main text colour.
  plum: { bar: 'bg-fg', name: 'text-fg', text: 'text-fg' },
  // Other people's bubbles (a raised surface).
  raised: { bar: 'bg-berry', name: 'text-berry', text: 'text-muted' },
  // Signals: your own messages sit on the solid accent with dark "ink" text.
  accent: { bar: 'bg-ink', name: 'text-ink', text: 'text-ink' },
};

interface ReplyQuoteProps {
  author: string;
  text: string;
  tone?: ReplyQuoteTone;
  /** When given, the quote is a button (jump to the original message); otherwise it is plain text. */
  onClick?: () => void;
  className?: string;
}

export const ReplyQuote: React.FC<ReplyQuoteProps> = ({ author, text, tone = 'raised', onClick, className = '' }) => {
  const t = TONES[tone];
  const body = (
    <>
      <span aria-hidden="true" className={`w-[3px] shrink-0 self-stretch rounded-full ${t.bar}`} />
      <span className="min-w-0 flex-1">
        <span data-testid="reply-quote-author" className={`block overflow-hidden text-ellipsis whitespace-nowrap text-[length:calc(12px_*_var(--fs,1))] font-semibold leading-tight ${t.name}`}>{author}</span>
        <span data-testid="reply-quote-text" className={`block overflow-hidden text-ellipsis whitespace-nowrap text-[length:calc(13px_*_var(--fs,1))] leading-snug ${t.text}`}>{text}</span>
      </span>
    </>
  );
  // `w-0 min-w-full`: the quote takes the bubble's width but adds nothing to it, so a long single-line quote can never push the
  // bubble wider than the screen. The zero-height spacer gives the bubble a sensible minimum width (capped, so it also fits a narrow phone).
  const base = `mb-1.5 flex w-0 min-w-full items-stretch gap-2 text-left ${className}`;
  const spacer = <span aria-hidden="true" className="block h-0 w-[min(12rem,45vw)]" />;
  if (!onClick) return <><div className={base} aria-label={`Replying to ${author}: ${text}`} role="group">{body}</div>{spacer}</>;
  return (
    <>
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`${base} cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60`}
      aria-label={`Replying to ${author}: ${text}`}
    >
      {body}
    </button>
    {spacer}
    </>
  );
};
