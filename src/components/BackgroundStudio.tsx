import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, ImagePlus, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { CosmicBackground } from './CosmicBackground.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { auth } from '../lib/firebase.ts';
import { useBackgroundImage } from '../hooks/useBackgroundImage.ts';
import { prepareBackgroundImage, uploadBackgroundImage, uploadProblemText } from '../services/profileBackgroundService.ts';
import {
  BACKGROUND_PRESETS,
  DIM_MAX,
  imageBackground,
  presetBackground,
  sameBackground,
  type PresetId,
  type ProfileBackground,
} from '../utils/profileBackground.ts';

interface Props {
  /** What the profile has now (null = the default look). */
  initial: ProfileBackground | null;
  /** Used for the sample profile in the preview only. */
  displayName: string;
  avatar?: string;
  aboutMe?: string;
  /** The signed-in member, for loading their saved picture. Defaults to the current user. */
  memberId?: string | null;
  /** The member chose "Use this background" (null = back to the default look). Nothing is saved until they save their profile. */
  onApply: (background: ProfileBackground | null) => void;
  onClose: () => void;
}

const reducedMotionNow = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Customization Studio for the profile background: pick one of eight animated galaxies or upload a still picture, place it, darken it,
 * switch the animation off, and preview it behind a sample of the whole profile before keeping it. Everything here is a draft; the
 * profile only changes when the member applies it and then saves their profile.
 */
export const BackgroundStudio: React.FC<Props> = ({ initial, displayName, avatar, aboutMe, memberId, onApply, onClose }) => {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ProfileBackground | null>(initial);
  // A picture chosen in this Studio, shown from this device straight away (it is not on the profile until saved).
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fullPreview, setFullPreview] = useState(false);
  const owner = memberId ?? auth?.currentUser?.uid ?? null;
  const imageUrl = useBackgroundImage(owner, draft, localUrl);
  const reduced = reducedMotionNow();

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  useEffect(() => {
    // Captured first, so Escape closes only the Studio and not the profile editor underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (fullPreview) setFullPreview(false); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, fullPreview]);

  const choosePreset = (preset: PresetId) => {
    setProblem(null);
    // Keep the member's position, darkness and animation choices when they try another galaxy.
    setDraft((current) => presetBackground(preset, current ? { x: current.x, y: current.y, animate: current.animate, ...(current.kind === 'preset' ? { dim: current.dim } : {}) } : {}));
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const prepared = await prepareBackgroundImage(file);
      if (!prepared) { setProblem(uploadProblemText('type')); return; }
      const result = await uploadBackgroundImage(prepared);
      if (!result.ok) { setProblem(uploadProblemText(result.reason)); return; }
      setLocalUrl(URL.createObjectURL(prepared));
      setDraft((current) => imageBackground(result.image, current ? { x: current.x, y: current.y, ...(current.kind === 'image' ? { dim: current.dim } : {}) } : {}));
    } finally {
      setUploading(false);
    }
  };

  const update = (over: Partial<ProfileBackground>) => setDraft((current) => (current ? { ...current, ...over } : current));
  const isImage = draft?.kind === 'image';
  const changed = !sameBackground(draft, initial);
  const range = 'h-2 w-full cursor-pointer accent-[var(--color-berry)]';

  // In a portal, so it covers the whole screen whatever the sheet it was opened from does with its own layout.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="background-studio" className="theme-cosmos fixed inset-0 z-[70] flex flex-col bg-ink text-fg">
      {draft && <CosmicBackground background={draft} imageUrl={imageUrl} />}
      <header className="relative z-10 flex items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <h2 id={titleId} className="rounded-full bg-black/40 px-3 py-1.5 text-[length:calc(14px_*_var(--fs,1))] font-semibold backdrop-blur">Customize background</h2>
        <button type="button" onClick={onClose} aria-label="Close without changing" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-black/40 text-fg backdrop-blur"><X className="h-5 w-5" /></button>
      </header>

      {/* A sample of the whole profile over the background, so the member sees the real result (glass surfaces, text, the lot). */}
      <div className="relative z-[1] flex-1 overflow-y-auto overscroll-contain glass-surfaces">
        <div className="mx-auto w-full max-w-xl px-4 pb-6 pt-14" data-testid="studio-sample-profile">
          <AnimalAvatar avatar={avatar} seed={displayName} className="h-20 w-20 ring-4 ring-ink shadow-lg shadow-black/30" />
          <p className="mt-3 text-[length:calc(24px_*_var(--fs,1))] font-semibold leading-tight tracking-tight">{displayName || 'Your name'}</p>
          <p className="mt-3 whitespace-pre-wrap text-[length:calc(15px_*_var(--fs,1))] leading-relaxed">{aboutMe || 'A little about your world will appear here.'}</p>
          <div className="mt-4 rounded-2xl border border-line bg-raised/50 p-3.5 text-[length:calc(14px_*_var(--fs,1))]">
            <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">About</p>
            <div className="mt-2 flex justify-between"><span className="text-subtle">Looking for</span><span>Friendship</span></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="tag">#stargazing</span><span className="tag">#books</span><span className="tag">#night owls</span></div>
        </div>
      </div>

      {fullPreview ? (
        <div className="relative z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center">
          <button type="button" onClick={() => setFullPreview(false)} className="btn btn-secondary btn-sm">Back to controls</button>
        </div>
      ) : (
        <div className="relative z-10 max-h-[58vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[rgb(14_7_22_/_0.82)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl" data-testid="studio-controls">
          <div className="mx-auto w-full max-w-xl space-y-4">
            <section aria-label="Animated galaxies">
              <p className="label flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Animated galaxies</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Galaxy presets">
                {BACKGROUND_PRESETS.map((preset) => {
                  const selected = draft?.kind === 'preset' && draft.preset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => choosePreset(preset.id)}
                      title={preset.motion}
                      className={`group overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${selected ? 'border-berry ring-2 ring-berry/50' : 'border-white/15'}`}
                    >
                      {/* A still thumbnail: only the one chosen background ever animates. */}
                      <span aria-hidden="true" className="block h-12" style={{ backgroundImage: `radial-gradient(120% 90% at 30% 20%, ${preset.swatch[1]}, transparent 60%), radial-gradient(100% 80% at 80% 90%, ${preset.swatch[2]}55, transparent 60%), linear-gradient(${preset.swatch[0]}, ${preset.swatch[0]})` }} />
                      <span className="block px-2 py-1.5">
                        <span className="block text-[length:calc(12px_*_var(--fs,1))] font-semibold leading-tight">{preset.name}</span>
                        <span className="mt-0.5 inline-block rounded-full bg-white/10 px-1.5 py-px text-[length:calc(10px_*_var(--fs,1))] uppercase tracking-wide text-lavender">Animated</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-label="Your own image">
              <p className="label">Your own image</p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-secondary btn-sm">
                  {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  {isImage ? 'Choose a different image' : 'Upload an image'}
                </button>
                <span className={`rounded-full px-1.5 py-px text-[length:calc(10px_*_var(--fs,1))] uppercase tracking-wide ${isImage ? 'bg-white/20 text-fg' : 'bg-white/10 text-subtle'}`}>Still image</span>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload a background image" data-testid="background-file" onChange={(e) => void onFile(e)} />
              <p className="mt-1.5 text-xs text-subtle">JPEG, PNG or WebP. Pictures are static (never animated), cleaned of camera details, and shown only on your profile.</p>
              {problem && <p role="alert" className="mt-1.5 text-[length:calc(13px_*_var(--fs,1))] text-danger">{problem}</p>}
            </section>

            {draft && (
              <section aria-label="Adjust" className="space-y-3">
                <div>
                  <label htmlFor="bg-x" className="label !mb-1 flex justify-between"><span>Position, left to right</span><span className="tabular-nums text-subtle">{draft.x}</span></label>
                  <input id="bg-x" type="range" min={0} max={100} value={draft.x} onChange={(e) => update({ x: Number(e.target.value) })} className={range} />
                </div>
                <div>
                  <label htmlFor="bg-y" className="label !mb-1 flex justify-between"><span>Position, top to bottom</span><span className="tabular-nums text-subtle">{draft.y}</span></label>
                  <input id="bg-y" type="range" min={0} max={100} value={draft.y} onChange={(e) => update({ y: Number(e.target.value) })} className={range} />
                </div>
                <div>
                  <label htmlFor="bg-dim" className="label !mb-1 flex justify-between"><span>Darkness</span><span className="tabular-nums text-subtle">{draft.dim}%</span></label>
                  <input id="bg-dim" type="range" min={0} max={DIM_MAX} value={draft.dim} onChange={(e) => update({ dim: Number(e.target.value) })} className={range} />
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">Animation</span>
                    <span className="block text-xs text-subtle">
                      {isImage ? 'Your own image is always still.' : reduced ? 'Your device asks for reduced motion, so the background stays still for you.' : 'Slow, gentle motion. Turn off for a still frame.'}
                    </span>
                  </span>
                  <input type="checkbox" role="switch" className="check" aria-label="Animation" checked={draft.animate && !isImage} disabled={isImage} onChange={(e) => update({ animate: e.target.checked })} />
                </label>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={() => { setProblem(null); setDraft(null); setLocalUrl(null); }} disabled={!draft} className="btn btn-secondary btn-sm"><RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset to default</button>
              <button type="button" onClick={() => setFullPreview(true)} disabled={!draft} className="btn btn-secondary btn-sm"><Eye className="h-4 w-4" aria-hidden="true" /> Preview whole profile</button>
            </div>
            <div className="flex gap-2 border-t border-white/10 pt-3">
              <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={() => onApply(draft)} disabled={uploading || !changed} className="btn btn-primary flex-1">Use this background</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};
