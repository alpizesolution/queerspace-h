import React, { useId, useLayoutEffect, useRef, useState } from 'react';

/** Tailwind needs the class names written out in full. */
const CLAMP: Record<1 | 2 | 3, string> = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' };

/**
 * Whether text that is cut off by a line clamp really has more to show. Measured from the page, so it follows the
 * text size setting and the screen width. It is only measured while collapsed (an open text can't tell), and once
 * found it stays true for as long as the text is the same, so the control never flickers away when it is opened.
 */
export function useClampOverflow<T extends HTMLElement>(expanded: boolean, text: string) {
  const ref = useRef<T | null>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    setOverflows(false);
  }, [text]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, text]);
  return { ref, overflows };
}

/**
 * After a card shrinks, keep it in view: if its top ended up above the screen, bring it back so the reader isn't
 * dropped somewhere further down the feed. Cards that are still in view are left exactly where they are.
 */
export function keepCardInView(from: HTMLElement | null) {
  const card = from?.closest('article');
  if (!card) return;
  requestAnimationFrame(() => {
    if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
  });
}

export const MoreButton: React.FC<{ expanded: boolean; controls?: string; onClick: () => void; more: string; less?: string }> = ({
  expanded, controls, onClick, more, less = 'Show less',
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={expanded}
    aria-controls={controls}
    className="mt-1 inline-flex items-center min-h-6 rounded text-[length:calc(13px_*_var(--fs,1))] font-medium text-lavender hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 cursor-pointer"
  >
    {expanded ? less : more}
  </button>
);

/** Text cut to a few lines, with "Read more" only when there is more to read. Its open state belongs to this one text. */
export const ExpandableText: React.FC<{ text: string; className?: string; lines?: 1 | 2 | 3 }> = ({ text, className = '', lines = 3 }) => {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { ref, overflows } = useClampOverflow<HTMLParagraphElement>(expanded, text);
  const toggle = () => {
    const wasExpanded = expanded;
    setExpanded(!wasExpanded);
    if (wasExpanded) keepCardInView(ref.current);
  };
  return (
    <div>
      <p id={id} ref={ref} className={`${className} ${expanded ? '' : CLAMP[lines]}`}>{text}</p>
      {(overflows || expanded) && <MoreButton expanded={expanded} controls={id} onClick={toggle} more="Read more" />}
    </div>
  );
};
