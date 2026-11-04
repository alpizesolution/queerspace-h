import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface Props {
  count: number;
  given: boolean;
  pending?: boolean;
  /** The member's own post: the count is shown, and there is nothing to give. */
  own?: boolean;
  onToggle: () => void;
}

const SPARKS = [
  { x: -14, y: -14 }, { x: 15, y: -12 }, { x: -12, y: 13 }, { x: 14, y: 14 },
];

/** Appreciation for a Cosmos post, the same on Community and Looking For. Compact, keyboard-reachable, one tap to give or take back. */
export const StardustButton: React.FC<Props> = ({ count, given, pending = false, own = false, onToggle }) => {
  const [burst, setBurst] = useState(false);
  const previous = useRef(given);

  // The sparkle plays only when Stardust turns on after the card is showing (not on first render, not on remove).
  useEffect(() => {
    const turnedOn = given && !previous.current;
    previous.current = given;
    if (!turnedOn) return;
    setBurst(true);
    const timer = setTimeout(() => setBurst(false), 700);
    return () => clearTimeout(timer);
  }, [given]);

  if (own) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap h-9 px-2.5 text-[length:calc(13px_*_var(--fs,1))] text-subtle" title="Stardust on your post">
        <Sparkles className="w-[18px] h-[18px]" aria-hidden="true" />
        <span className="tabular-nums">{count}</span>
        <span>Stardust<span className="sr-only"> on your post</span></span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={given}
      aria-busy={pending}
      aria-label={given ? `Given. Remove your Stardust. ${count} Stardust` : `Give Stardust. ${count} Stardust`}
      className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap h-9 px-2.5 rounded-full border text-[length:calc(13px_*_var(--fs,1))] font-medium transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60 ${
        given ? 'border-lavender/30 bg-lavender/10 text-lavender' : 'border-transparent text-muted hover:bg-raised hover:text-fg'
      } ${pending ? 'opacity-70' : ''}`}
    >
      <span className="relative inline-flex">
        <Sparkles className={`w-[18px] h-[18px] ${given ? 'fill-lavender/30' : ''}`} aria-hidden="true" />
        {burst && SPARKS.map((spark, i) => (
          <span key={i} aria-hidden="true" className="stardust-spark" style={{ ['--sx' as string]: `${spark.x}px`, ['--sy' as string]: `${spark.y}px` }} />
        ))}
      </span>
      <span>{given ? 'Given' : 'Give Stardust'}</span>
      <span aria-hidden="true" className="text-subtle">·</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
};

/** A read-only count for lists such as a profile's posts. */
export const StardustCount: React.FC<{ count: number }> = ({ count }) => (
  <span className="inline-flex items-center gap-1">
    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> <span className="tabular-nums">{count}</span>
    <span className="sr-only"> Stardust</span>
  </span>
);
