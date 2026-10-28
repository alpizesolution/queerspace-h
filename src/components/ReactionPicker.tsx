import React, { useLayoutEffect, useRef, useState } from 'react';
import { computePickerPlacement, PickerPlacement } from '../utils/pickerPlacement.ts';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

/**
 * Tap (or Enter) toggles; on touch screens a long press opens too. A scroll or drag cancels the press,
 * so scrolling the feed never pops a picker. Text selection and links keep working: clicks on buttons/links
 * and clicks that end a text selection are ignored, and the context menu is blocked only after a touch press.
 */
export function useMessagePress(onToggle: () => void, onOpen: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);
  const lastPointer = useRef<string>('mouse');

  const clear = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      lastPointer.current = e.pointerType;
      longFired.current = false;
      if (e.pointerType !== 'touch') return;
      origin.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        longFired.current = true;
        navigator.vibrate?.(8);
        onOpen();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerUp: clear,
    // The browser cancels the pointer when it starts scrolling.
    onPointerCancel: clear,
    onClick: (e: React.MouseEvent) => {
      if (longFired.current) {
        longFired.current = false;
        return;
      }
      if ((e.target as HTMLElement).closest('a,button')) return;
      if (window.getSelection()?.toString()) return;
      onToggle();
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (lastPointer.current === 'touch') e.preventDefault();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
  };
}

interface ReactionPickerProps {
  reactions: readonly { id: string; emoji: string; label: string }[];
  /** Reaction this device left on the message, shown highlighted. */
  mine?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** The bubble the picker belongs to, and the scrolling chat area it must stay inside. */
  anchorRef: React.RefObject<HTMLElement | null>;
  boundsRef: React.RefObject<HTMLElement | null>;
  alignRight: boolean;
}

/** Small floating emoji toolbar for one message: above it, or below near the top; kept inside the chat area. */
export const ReactionPicker: React.FC<ReactionPickerProps> = ({ reactions, mine, onPick, onClose, anchorRef, boundsRef, alignRight }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PickerPlacement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    const bounds = boundsRef.current;
    if (!el || !anchor || !bounds) return;
    const a = anchor.getBoundingClientRect();
    const b = bounds.getBoundingClientRect();
    setPlacement(computePickerPlacement(a, { width: el.offsetWidth, height: el.offsetHeight }, b, alignRight));
  }, [anchorRef, boundsRef, alignRight]);

  // Make sure the toolbar is fully visible once placed (e.g. below the last message).
  useLayoutEffect(() => {
    if (placement) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [placement]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Pick a reaction"
      className={`absolute z-20 flex items-center gap-0.5 rounded-full border border-line bg-raised/95 p-1 shadow-lg shadow-black/40 backdrop-blur anim-pop ${
        placement?.below ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
      } ${alignRight ? 'right-0' : 'left-0'}`}
      style={{ transform: placement?.shiftX ? `translateX(${placement.shiftX}px)` : undefined, visibility: placement ? 'visible' : 'hidden' }}
    >
      {reactions.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          aria-label={r.label}
          aria-pressed={mine === r.id}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[19px] transition-transform active:scale-90 ${
            mine === r.id ? 'bg-plum/50 ring-1 ring-berry/60' : 'hover:bg-surface'
          }`}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
};

interface ReactableBubbleProps extends Omit<ReactionPickerProps, 'anchorRef'> {
  id: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  className: string;
  children: React.ReactNode;
}

/** A message bubble that opens its own reaction picker on tap, long press or Enter. */
export const ReactableBubble: React.FC<ReactableBubbleProps> = ({ id, open, onToggle, onOpen, className, children, ...picker }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const press = useMessagePress(onToggle, onOpen);
  return (
    <div className="relative max-w-full">
      <div
        ref={anchorRef}
        id={id}
        tabIndex={0}
        {...press}
        className={`${className} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-berry/60 [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none`}
      >
        {children}
        <span className="sr-only">Press Enter to react.</span>
      </div>
      {open && <ReactionPicker {...picker} anchorRef={anchorRef} />}
    </div>
  );
};
