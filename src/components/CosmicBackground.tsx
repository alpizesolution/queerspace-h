import React, { useEffect, useState } from 'react';
import { dimColor, type PresetId, type ProfileBackground } from '../utils/profileBackground.ts';

/**
 * One background layer: a class list, and optionally the layers inside it. The artwork and every animation live in src/cosmos.css; this
 * only says which layers each scene is made of, so only the chosen scene is ever put on the page.
 */
interface Layer { cls: string; inside?: Layer[] }

const stars = (tile: string, extra = ''): Layer => ({ cls: `cb cb-tile-up t-${tile} ${extra}`.trim() });

/** What each scene is made of, back to front. Each scene has its own layers and its own motion, they are not one scene in different colours. */
export const SCENES: Record<PresetId, Layer[]> = {
  'nebula-dreams': [
    { cls: 'cb cb-cloud c-a' }, { cls: 'cb cb-cloud c-b' }, { cls: 'cb cb-cloud c-c' },
    stars('stars-s'), stars('stars-m'), stars('stars-l', 'tw'), stars('stars-blue', 'tw-2'),
  ],
  'midnight-universe': [
    { cls: 'cb cb-galaxy g-a' }, { cls: 'cb cb-galaxy g-b' },
    stars('stars-s'), stars('stars-blue'), stars('stars-l'), stars('stars-m', 'tw'),
  ],
  'stardust-bloom': [
    { cls: 'cb cb-breathe b-a', inside: [{ cls: 'cb cb-petals p-a' }] },
    { cls: 'cb cb-breathe b-b', inside: [{ cls: 'cb cb-petals p-b' }] },
    { cls: 'cb cb-core' }, stars('stars-s'), stars('sparkle'),
  ],
  'aurora-galaxy': [
    stars('stars-s'), stars('stars-m'),
    { cls: 'cb cb-horizon' }, { cls: 'cb cb-ribbon r-1' }, { cls: 'cb cb-ribbon r-2' }, { cls: 'cb cb-ribbon r-3' }, { cls: 'cb cb-ribbon r-4' }, { cls: 'cb cb-ribbon r-5' },
  ],
  'celestial-ocean': [
    stars('stars-blue'),
    { cls: 'cb cb-shaft s-a' }, { cls: 'cb cb-shaft s-b' },
    { cls: 'cb cb-wave w-1' }, { cls: 'cb cb-wave w-2' }, { cls: 'cb cb-wave w-3' },
  ],
  'solar-eclipse': [
    stars('stars-s'), stars('stars-dim'), { cls: 'cb cb-flare' },
    { cls: 'cb cb-ring e-rays' }, { cls: 'cb cb-ring e-fine' }, { cls: 'cb cb-ring e-glow' }, { cls: 'cb cb-ring e-disc' },
  ],
  'cosmic-dust': [
    { cls: 'cb cb-wash k-a' }, { cls: 'cb cb-wash k-b' },
    { cls: 'cb-sway sw-1', inside: [stars('dust-s')] },
    { cls: 'cb-sway sw-2', inside: [stars('dust-m')] },
    { cls: 'cb-sway sw-3', inside: [stars('dust-l')] },
  ],
  moonlight: [
    stars('stars-dim'), stars('stars-s'),
    { cls: 'cb cb-halo' }, { cls: 'cb cb-orb' },
    { cls: 'cb cb-wisp m-1' }, { cls: 'cb cb-wisp m-2' }, { cls: 'cb cb-wisp m-3' },
  ],
};

const renderLayers = (layers: Layer[], keyPrefix = ''): React.ReactNode =>
  layers.map((layer, index) => (
    <span key={`${keyPrefix}${index}`} aria-hidden="true" className={layer.cls}>
      {layer.inside ? renderLayers(layer.inside, `${keyPrefix}${index}.`) : null}
    </span>
  ));

/** True while the page is visible. Hidden tabs stop the animation, so a background in a tab nobody is looking at costs nothing. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

interface Props {
  background: ProfileBackground;
  /** For a member's own picture: where it can be loaded from (a blob URL). Null while it loads or if it could not be loaded. */
  imageUrl?: string | null;
  className?: string;
}

/**
 * A full-bleed background: fills whatever container it is put in (the profile page puts it behind everything, fixed to the screen, so it
 * stays in place and keeps moving while the content scrolls over it). It never takes a tap, a scroll or focus.
 *
 * Presets are drawn from CSS layers (no video, nothing to download). A member's own picture is a still image. The member's position and
 * darkness settings apply to both. Motion stops for reduced-motion, for the member's own animation switch, and while the tab is hidden.
 */
export const CosmicBackground: React.FC<Props> = ({ background, imageUrl = null, className = '' }) => {
  const visible = usePageVisible();
  const isImage = background.kind === 'image';
  return (
    <div
      data-testid="cosmic-background"
      data-kind={background.kind}
      data-preset={isImage ? undefined : background.preset}
      data-animate={background.animate ? 'true' : 'false'}
      data-paused={visible ? 'false' : 'true'}
      aria-hidden="true"
      className={`cosmos ${isImage ? 'cosmos-image' : `cosmos-${background.preset}`} ${className}`}
      style={{
        '--bx': background.x,
        '--by': background.y,
        ...(isImage && imageUrl ? { backgroundImage: `url("${imageUrl}")`, backgroundPosition: `${background.x}% ${background.y}%` } : {}),
      } as React.CSSProperties}
    >
      {!isImage && background.preset && <div className="cb-stage">{renderLayers(SCENES[background.preset])}</div>}
      <div className="cb-dim" style={{ background: dimColor(background.dim) }} />
    </div>
  );
};
