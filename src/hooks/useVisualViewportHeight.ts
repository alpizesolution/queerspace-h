import { useEffect, useState } from 'react';

export interface VisualViewportBox {
  /** Visible height, or null when the browser has no visualViewport (or the user is pinch-zoomed). */
  height: number | null;
  /** How far iOS has scrolled the visible area down inside the layout viewport to reveal the focused input. */
  offsetTop: number;
}

const NONE: VisualViewportBox = { height: null, offsetTop: 0 };

/**
 * Tracks the visible area so full-screen views (chat) can sit exactly above the on-screen keyboard
 * on browsers that overlay it (iOS Safari). iOS shrinks the visual viewport AND scrolls it
 * (offsetTop > 0), so a position:fixed box needs both to stay glued to what's visible.
 */
export function useVisualViewport(): VisualViewportBox {
  const [box, setBox] = useState<VisualViewportBox>(NONE);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pinch-zoom also changes these values; leave the layout alone while zoomed.
      if (vv.scale > 1.01) {
        setBox((prev) => (prev === NONE ? prev : NONE));
        return;
      }
      const height = Math.round(vv.height);
      const offsetTop = Math.max(0, Math.round(vv.offsetTop));
      setBox((prev) => (prev.height === height && prev.offsetTop === offsetTop ? prev : { height, offsetTop }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return box;
}

/** Height-only view of the above, for screens that scroll with the page. */
export function useVisualViewportHeight(): number | null {
  return useVisualViewport().height;
}
