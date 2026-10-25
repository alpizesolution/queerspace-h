import React, { useRef, useState } from 'react';
import { Reply } from 'lucide-react';

const TRIGGER_PX = 56;
const MAX_PX = 76;

interface SwipeToReplyProps {
  onReply: () => void;
  /** A tap without a swipe, e.g. to show the message's actions. */
  onTap?: () => void;
  className?: string;
  /** Render the children as-is, with no swipe. */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Drag a message to the right to reply, like in messaging apps. Vertical scrolling stays
 * with the browser (touch-action: pan-y), so only sideways drags move the bubble.
 */
export const SwipeToReply: React.FC<SwipeToReplyProps> = ({ onReply, onTap, className = '', disabled = false, children }) => {
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const armed = useRef(false);

  const reset = () => {
    start.current = null;
    armed.current = false;
    setOffset(0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!moved.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      moved.current = true;
      // A mostly vertical move is a scroll, not a swipe.
      if (Math.abs(dy) > Math.abs(dx) || dx < 0) {
        start.current = null;
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    const next = Math.max(0, Math.min(MAX_PX, dx * 0.7));
    if (next >= TRIGGER_PX && !armed.current) {
      armed.current = true;
      navigator.vibrate?.(8);
    } else if (next < TRIGGER_PX) {
      armed.current = false;
    }
    setOffset(next);
  };

  const onPointerUp = () => {
    if (!start.current && !moved.current) return;
    const fire = armed.current;
    const wasTap = !moved.current;
    reset();
    if (fire) onReply();
    else if (wasTap) onTap?.();
  };

  const progress = Math.min(1, offset / TRIGGER_PX);

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={`relative touch-pan-y ${offset ? 'select-none' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          progress >= 1 ? 'bg-berry text-ink' : 'bg-raised text-muted'
        }`}
        style={{ opacity: progress, transform: `translateY(-50%) scale(${0.6 + 0.4 * progress})` }}
      >
        <Reply className="w-4 h-4" />
      </span>
      <div
        className={offset === 0 ? 'transition-transform duration-200 ease-out' : ''}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
};
