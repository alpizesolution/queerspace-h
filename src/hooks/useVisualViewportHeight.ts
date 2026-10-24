import { useEffect, useState } from 'react';

/**
 * Tracks the visible viewport height so full-screen views (chat, rooms) can keep
 * their composer above the on-screen keyboard on browsers that overlay it (iOS Safari).
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(Math.round(vv.height));
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return height;
}
