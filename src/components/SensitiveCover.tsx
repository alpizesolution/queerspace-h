import React from 'react';
import { EyeOff } from 'lucide-react';

/** Soft placeholder lines standing in for hidden text, so nothing sensitive is in the page until it is revealed. */
const CoverLines: React.FC = () => (
  <div aria-hidden="true" className="space-y-2 blur-[3px] select-none">
    <div className="h-4 w-4/5 rounded-full bg-line-strong/60" />
    <div className="h-3 w-full rounded-full bg-line/70" />
    <div className="h-3 w-11/12 rounded-full bg-line/70" />
    <div className="h-3 w-2/3 rounded-full bg-line/70" />
  </div>
);

/**
 * The cover for a mature post that is not open: the author's content warning, and either a Reveal action or, when the
 * member's setting is "always hide", a way to the setting. None of the post's own text is ever passed in here.
 */
export const SensitiveCover: React.FC<{
  contentWarning: string | null;
  blocked: boolean;
  onReveal: () => void;
  onOpenSettings?: () => void;
}> = ({ contentWarning, blocked, onReveal, onOpenSettings }) => (
  <div className="mt-3 relative rounded-2xl border border-line bg-ink/40 overflow-hidden">
    <div className="absolute inset-0 p-4"><CoverLines /></div>
    <div className="relative flex flex-col items-center gap-1.5 bg-surface/60 px-4 py-4 text-center">
      <EyeOff className="w-5 h-5 text-lavender" aria-hidden="true" />
      <p className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">Sensitive content</p>
      {contentWarning && <p className="text-[length:calc(12px_*_var(--fs,1))] text-muted [overflow-wrap:anywhere]">{contentWarning}</p>}
      {blocked ? (
        <>
          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">Hidden by your content setting.</p>
          {onOpenSettings && <button type="button" onClick={onOpenSettings} className="btn btn-secondary btn-sm">Change setting</button>}
        </>
      ) : (
        <button type="button" onClick={onReveal} className="btn btn-secondary btn-sm">Reveal content</button>
      )}
    </div>
  </div>
);
