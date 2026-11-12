import React, { useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { useMinuteClock } from '../hooks/useMemberVibe.ts';
import { publishCurrentVibe, vibeProblemText } from '../services/currentVibeService.ts';
import {
  VIBE_MESSAGE_MAX,
  VIBE_MOODS,
  VIBE_TTL_HOURS,
  VIBE_VISIBILITY_OPTIONS,
  manilaDateTime,
  messageLength,
  messageProblem,
  moodById,
  tidyMessage,
  vibeAccessibleSummary,
  vibeTimes,
  visibilityLabel,
  type VibeMoodId,
  type VibeView,
  type VibeVisibility,
} from '../utils/currentVibe.ts';

/**
 * Current Vibe on screen: a small chip for headers, the card on a profile, the "set yours" prompt and the editor. Nothing here talks
 * to a database: the editor hands the finished status to `publishCurrentVibe`, and the server decides who sees it and when it ends.
 */

/** A small decorative star; purely visual. */
const Star: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden="true" className={`select-none leading-none text-lavender ${className}`}>✦</span>
);

/** The mood as a compact chip beside a name (Seek, the Signals header). Quiet on purpose: an emoji and the mood's name. */
export const VibeChip: React.FC<{ vibe: VibeView; className?: string }> = ({ vibe, className = '' }) => (
  <span
    data-testid="vibe-chip"
    title={vibeAccessibleSummary(vibe)}
    aria-label={`Current Vibe: ${vibe.label}`}
    className={`inline-flex max-w-full items-center gap-1 rounded-full border border-lavender/30 bg-plum/25 px-2 py-0.5 align-middle text-[length:calc(11px_*_var(--fs,1))] font-medium leading-tight text-fg ${className}`}
  >
    <span aria-hidden="true">{vibe.emoji}</span>
    <span className="truncate">{vibe.label}</span>
  </span>
);

interface CardProps {
  vibe: VibeView;
  /** The member's own: shows who can see it and the Edit and Remove actions. */
  self?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  removing?: boolean;
  /** Inside the editor's preview: no actions, and the times read as they will once published. */
  preview?: boolean;
}

/** The status on a profile: the mood, the message and when it was updated and ends. Compact, and the same in both themes. */
export const CurrentVibeCard: React.FC<CardProps> = ({ vibe, self = false, onEdit, onRemove, removing = false, preview = false }) => {
  const now = useMinuteClock();
  const label = useId();
  return (
    <section
      data-testid={preview ? 'current-vibe-preview' : 'current-vibe'}
      aria-labelledby={label}
      className="rounded-2xl border border-lavender/25 bg-gradient-to-br from-plum/30 via-raised/50 to-raised/50 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p id={label} className="flex items-center gap-1.5 whitespace-nowrap text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-muted">
          <Star /> Current Vibe
        </p>
        {self && !preview && (
          <div className="-mr-1.5 flex items-center">
            <button type="button" onClick={onEdit} className="inline-flex min-h-11 whitespace-nowrap items-center gap-1 rounded-full px-2.5 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-berry transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit Mood
            </button>
            <button type="button" onClick={onRemove} disabled={removing} className="inline-flex min-h-11 whitespace-nowrap items-center gap-1 rounded-full px-2.5 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-muted transition hover:bg-raised hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 disabled:opacity-50">
              {removing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} Remove Mood
            </button>
          </div>
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-2 text-[length:calc(20px_*_var(--fs,1))] font-semibold leading-tight text-fg">
        <span aria-hidden="true" className="text-[length:calc(26px_*_var(--fs,1))] leading-none">{vibe.emoji}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{vibe.label}</span>
      </p>
      {vibe.message && <p className="mt-1.5 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg [overflow-wrap:anywhere]">“{vibe.message}”</p>}
      <p className="mt-2 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-muted" title={`Expires ${manilaDateTime(vibe.expiresAt)} (Manila time)`}>
        {preview ? `Expires in ${VIBE_TTL_HOURS} hours` : vibeTimes(vibe, now)}
      </p>
      {self && !preview && vibe.visibility && (
        <p className="mt-0.5 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-muted">Visible to: {visibilityLabel(vibe.visibility)}</p>
      )}
    </section>
  );
};

/** Shown on the member's own profile when they have no live status: a quiet way to set one. Never shown on anyone else's. */
export const SetVibePrompt: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="set-current-vibe"
    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-lavender/35 px-3.5 py-2.5 text-[length:calc(14px_*_var(--fs,1))] font-semibold text-lavender transition hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
  >
    <Sparkles className="h-4 w-4" aria-hidden="true" /> Set your Current Vibe
  </button>
);

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-[length:calc(14px_*_var(--fs,1))] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY = `${BUTTON} bg-berry text-ink hover:brightness-110 active:scale-95`;
const SECONDARY = `${BUTTON} border border-line bg-raised text-fg hover:bg-raised/70 active:scale-95`;

interface SheetProps {
  /** Their current status, to edit; absent when setting one for the first time. */
  existing?: VibeView | null;
  /** Called with the saved status once it has been published. */
  onPublished: (vibe: VibeView) => void;
  onClose: () => void;
}

/** A compact sheet to pick a mood, add an optional short message, choose who can see it, preview it, and publish. */
export const CurrentVibeSheet: React.FC<SheetProps> = ({ existing = null, onPublished, onClose }) => {
  const [moodId, setMoodId] = useState<VibeMoodId | null>(existing?.moodId ?? null);
  const [message, setMessage] = useState(existing?.message ?? '');
  const [visibility, setVisibility] = useState<VibeVisibility>(existing?.visibility ?? 'everyone');
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set the instant Publish is chosen, so a quick second tap cannot send it twice. */
  const sending = useRef(false);
  const group = useId();

  const mood = moodById(moodId);
  const problem = messageProblem(message);
  const length = messageLength(tidyMessage(message));
  const canPreview = mood !== null && problem === null;

  const publish = async () => {
    if (!mood || problem || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await publishCurrentVibe({ moodId: mood.id, message, visibility });
    sending.current = false;
    setBusy(false);
    if (!result.ok) { setError(vibeProblemText(result.reason)); return; }
    if (result.vibe) onPublished(result.vibe);
  };

  const now = new Date();
  const previewVibe: VibeView | null = mood
    ? { moodId: mood.id, emoji: mood.emoji, label: mood.label, message: tidyMessage(message) || null, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + VIBE_TTL_HOURS * 3_600_000).toISOString(), visibility }
    : null;

  return (
    <Sheet
      title="Current Vibe"
      icon={<Sparkles className="h-5 w-5 text-lavender" aria-hidden="true" />}
      onClose={() => { if (!busy) onClose(); }}
      trapFocus
      footer={
        previewing ? (
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={() => setPreviewing(false)} disabled={busy}>Edit</button>
            <button type="button" className={`${PRIMARY} flex-[2]`} onClick={() => void publish()} disabled={busy}>
              {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Publishing…</> : 'Publish'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={onClose}>Cancel</button>
            <button type="button" className={`${PRIMARY} flex-[2]`} onClick={() => setPreviewing(true)} disabled={!canPreview}>Preview</button>
          </div>
        )
      }
    >
      {previewing && previewVibe ? (
        <div data-testid="vibe-preview">
          <p className="text-xs text-muted">This is how it will look. It ends {VIBE_TTL_HOURS} hours after you publish, and you can change or remove it any time.</p>
          <div className="mt-3"><CurrentVibeCard vibe={previewVibe} self preview /></div>
          <p className="mt-2 text-xs text-muted">Visible to: {visibilityLabel(visibility)}</p>
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">How are you feeling right now? It stays for {VIBE_TTL_HOURS} hours.</p>
          <div role="radiogroup" aria-label="Choose a mood" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {VIBE_MOODS.map((option) => {
              const on = moodId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMoodId(option.id)}
                  className={`relative flex min-h-[3.5rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/70 ${on ? 'border-berry bg-plum/40 ring-1 ring-berry' : 'border-line bg-raised hover:bg-raised/70'}`}
                >
                  <span aria-hidden="true" className="text-xl leading-none">{option.emoji}</span>
                  <span className={`w-full truncate text-[length:calc(11px_*_var(--fs,1))] font-medium ${on ? 'text-fg' : 'text-muted'}`}>{option.label}</span>
                  {on && <Check className="absolute right-1 top-1 h-3 w-3 text-berry" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div>
            <label htmlFor={`${group}-msg`} className="mb-1 block text-xs font-semibold text-fg">Add a short note <span className="font-normal text-muted">(optional)</span></label>
            <input
              id={`${group}-msg`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              autoComplete="off"
              placeholder="Taking life one day at a time."
              aria-describedby={`${group}-count`}
              aria-invalid={problem ? true : undefined}
              className="block min-h-11 w-full min-w-0 rounded-xl border border-line bg-raised px-3 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg outline-none placeholder:text-muted focus:border-berry/60"
            />
            <p id={`${group}-count`} className={`mt-1 text-right text-xs tabular-nums ${problem ? 'text-danger' : 'text-muted'}`} aria-live="polite">
              {length}/{VIBE_MESSAGE_MAX}
            </p>
            {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          </div>

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1.5 text-xs font-semibold text-fg">Who can see my Current Vibe?</legend>
            <div className="space-y-1.5">
              {VIBE_VISIBILITY_OPTIONS.map((option) => (
                <label key={option.id} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition focus-within:ring-2 focus-within:ring-berry/70 ${visibility === option.id ? 'border-berry bg-plum/30' : 'border-line hover:bg-raised/60'}`}>
                  <input type="radio" name={`${group}-vis`} checked={visibility === option.id} onChange={() => setVisibility(option.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-berry)]" />
                  <span className="min-w-0">
                    <span className="block text-[length:calc(14px_*_var(--fs,1))] font-medium leading-snug text-fg">{option.label}</span>
                    <span className="block text-xs leading-snug text-muted">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </Sheet>
  );
};
