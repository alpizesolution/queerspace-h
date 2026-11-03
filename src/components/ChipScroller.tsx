import React, { useEffect, useRef } from 'react';

interface Props<T extends string> {
  items: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  /** Classes for one chip when it is the active one, and when it is not. */
  chipClass?: (id: T, active: boolean) => string;
  /** Extends the row to the screen edges on small screens. Off when something sits beside it. */
  bleed?: boolean;
  className?: string;
}

const defaultChip = (_id: string, active: boolean) => (active ? '!bg-fg !text-ink !border-fg' : '');

/**
 * One line of pills that scrolls sideways on a phone and never wraps or clips: swipe to reach every one, the scrollbar is
 * hidden, there is room at both ends so the first and last pill can be fully reached, and the chosen pill is brought
 * into view. Used for the Community categories and the Looking For categories.
 */
export function ChipScroller<T extends string>({ items, active, onSelect, label, chipClass = defaultChip, bleed = false, className = '' }: Props<T>) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = row.current;
    const chip = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !chip) return;
    const target = chip.offsetLeft - (container.clientWidth - chip.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, container.scrollWidth - container.clientWidth));
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left, behavior: calm ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      className={`flex min-w-0 touch-pan-x items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none ${bleed ? '-mx-4 px-4 sm:mx-0 sm:px-0' : ''} ${className}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onSelect(item.id)}
          className={`chip shrink-0 ${chipClass(item.id, active === item.id)}`}
        >
          {item.label}
        </button>
      ))}
      {/* Trailing room: padding at the end of a scrolling row is dropped by some browsers, which would clip the last pill. */}
      <span aria-hidden="true" className="w-2 shrink-0 sm:hidden" />
    </div>
  );
}
