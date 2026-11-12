import { useEffect, useState } from 'react';
import { fetchBackgroundImage } from '../services/profileBackgroundService.ts';
import type { ProfileBackground } from '../utils/profileBackground.ts';

/**
 * The still picture for an image background, loaded only when the background is an image (presets download nothing). `local` is a
 * picture the member has just chosen in the Studio and not saved yet: it is shown straight away from this device.
 */
export function useBackgroundImage(memberId: string | null, background: ProfileBackground | null | undefined, local: string | null = null): string | null {
  const imageId = background?.kind === 'image' ? background.image ?? null : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (local || !memberId || !imageId) { setUrl(null); return; }
    let cancelled = false;
    void fetchBackgroundImage(memberId, imageId).then((found) => { if (!cancelled) setUrl(found); });
    return () => { cancelled = true; };
  }, [memberId, imageId, local]);
  return local ?? url;
}
