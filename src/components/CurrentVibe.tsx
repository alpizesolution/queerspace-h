import React, { useId, useRef, useState } from 'react';
import { LoaderCircle, SmilePlus } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { publishCurrentVibe, removeCurrentVibe, vibeProblemText } from '../services/currentVibeService.ts';
import {
  COMMON_EMOJI,
  VIBE_MESSAGE_MAX,
  VIBE_TTL_HOURS,
  VIBE_VISIBILITY_OPTIONS,
  expiresIn,
  hasContent,
  manilaDateTime,
  messageLength,
  messageProblem,
  tidyMessage,
  vibeAccessibleSummary,
  vibeTimes,
  type VibeView,
  type VibeVisibility,
} from '../utils/currentVibe.ts';

/**
 * Current Vibe on screen: a custom status shown as a small bubble beside a member's avatar, a quiet "Add status" pill on your own
 * profile when you have none, a compact chip for chat headers, and the editor. Nothing here talks to a database: the editor hands the
 * finished status to the service, and the server decides who sees it and when it ends.
 */

/** The text of a status for a tooltip or a screen reader. */
const said = (vibe: Pick<VibeView, 'emoji' | 'message'>): string => [vibe.emoji, vibe.message].filter(Boolean).join(' ');

/** The two small circles that make the bubble read as a thought drifting off the avatar. Purely decorative. */
const Trail: React.FC = () => (
  <>
    <span aria-hidden="true" className="absolute -left-1 bottom-0 h-1.5 w-1.5 rounded-full border border-lavender/30 bg-ink/90" />
    <span aria-hidden="true" className="absolute -left-2.5 -bottom-1 h-1 w-1 rounded-full border border-lavender/30 bg-ink/90" />
  </>
);

/** A bigger touch area than the small pill itself, so it is comfortable to tap without looking big. */
const TOUCH = "after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-['']";

interface BubbleProps {
  vibe: VibeView;
  /** The member's own status: a tap opens the editor. On someone else's, a tap shows the whole message if it was cut short. */
  self?: boolean;
  onEdit?: () => void;
  className?: string;
}

/**
 * The status bubble. One line with an ellipsis so it stays small beside an avatar; on someone else's profile a tap spreads the whole
 * message over a few lines. The remaining time is in the tooltip, not on the bubble.
 */
export const VibeBubble: React.FC<BubbleProps> = ({ vibe, self = false, onEdit, className = '' }) => {
  const [open, setOpen] = useState(false);
  const label = self ? `Your status: ${said(vibe)}. Edit status` : `Status: ${said(vibe)}`;
  return (
    <div className={`relative inline-flex max-w-full ${className}`}>
      <Trail />
      <button
        type="button"
        data-testid="vibe-bubble"
        onClick={self ? onEdit : () => setOpen((value) => !value)}
        aria-expanded={self ? undefined : open}
        aria-label={label}
        title={`${vibeAccessibleSummary(vibe)}\nClears ${manilaDateTime(vibe.expiresAt)} (Manila time)`}
        className={`relative flex max-w-full items-start gap-1.5 rounded-2xl rounded-bl-md border border-lavender/30 bg-ink/90 px-3 py-1.5 text-left shadow-md shadow-black/25 backdrop-blur-sm transition hover:border-lavender/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${TOUCH}`}
      >
        {vibe.emoji && <span aria-hidden="true" className="text-[length:calc(16px_*_var(--fs,1))] leading-snug">{vibe.emoji}</span>}
        {vibe.message && (
          <span className={`min-w-0 text-[length:calc(13px_*_var(--fs,1))] leading-snug text-fg ${open ? 'whitespace-normal [overflow-wrap:anywhere]' : 'truncate'}`}>{vibe.message}</span>
        )}
      </button>
    </div>
  );
};

/** On your own profile, when you have no live status: a small dashed pill in the same spot as the bubble. Never shown on anyone else's. */
export const AddStatusPill: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="add-status"
    className={`relative inline-flex min-h-8 items-center gap-1.5 rounded-2xl rounded-bl-md border border-dashed border-lavender/45 bg-ink/90 px-3 text-[length:calc(13px_*_var(--fs,1))] font-medium text-lavender backdrop-blur-sm transition hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${TOUCH} ${className}`}
  >
    <SmilePlus className="h-4 w-4" aria-hidden="true" /> Add status
  </button>
);

/** The status as a compact chip beside a name in a chat header (Seek, Signals): the emoji and a short, cut-off message. */
export const VibeChip: React.FC<{ vibe: VibeView; className?: string }> = ({ vibe, className = '' }) => (
  <span
    data-testid="vibe-chip"
    title={vibeAccessibleSummary(vibe)}
    aria-label={`Status: ${said(vibe)}`}
    className={`inline-flex min-w-0 max-w-[9.5rem] items-center gap-1 rounded-full border border-lavender/30 bg-plum/25 px-2 py-0.5 align-middle text-[length:calc(11px_*_var(--fs,1))] font-medium leading-tight text-fg ${className}`}
  >
    {vibe.emoji && <span aria-hidden="true">{vibe.emoji}</span>}
    {vibe.message && <span className="truncate">{vibe.message}</span>}
  </span>
);

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-[length:calc(14px_*_var(--fs,1))] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY = `${BUTTON} bg-berry text-ink hover:brightness-110 active:scale-95`;
const SECONDARY = `${BUTTON} border border-line bg-raised text-fg hover:bg-raised/70 active:scale-95`;

interface SheetProps {
  /** Their current status, to edit; absent when setting one for the first time. */
  existing?: VibeView | null;
  /** Called with the saved status once it has been saved. */
  onPublished: (vibe: VibeView) => void;
  /** Called once the status has been cleared. */
  onCleared?: () => void;
  onClose: () => void;
}

/** A compact sheet: an emoji and a short message of your own, a live preview of the bubble, who can see it, then Save (or Clear). */
export const CurrentVibeSheet: React.FC<SheetProps> = ({ existing = null, onPublished, onCleared, onClose }) => {
  const [emoji, setEmoji] = useState(existing?.emoji ?? '');
  const [message, setMessage] = useState(existing?.message ?? '');
  const [visibility, setVisibility] = useState<VibeVisibility>(existing?.visibility ?? 'everyone');
  // The picker starts open for a new status, so choosing an emoji is the obvious first step; it closes once one is chosen.
  const [picking, setPicking] = useState(!existing?.emoji);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set the instant Save or Clear is chosen, so a quick second tap cannot send it twice. */
  const sending = useRef(false);
  const group = useId();

  const problem = messageProblem(message);
  const left = VIBE_MESSAGE_MAX - messageLength(message);
  const canSave = hasContent(emoji, message) && problem === null;

  const save = async () => {
    if (!canSave || sending.current) return;
    sending.current = true;
    setBusy('save');
    setError(null);
    const result = await publishCurrentVibe({ emoji, message, visibility });
    sending.current = false;
    setBusy(null);
    if (!result.ok) { setError(vibeProblemText(result.reason)); return; }
    if (result.vibe) onPublished(result.vibe);
  };

  const clear = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy('clear');
    setError(null);
    const result = await removeCurrentVibe();
    sending.current = false;
    setBusy(null);
    if (!result.ok) { setError(vibeProblemText(result.reason)); return; }
    onCleared?.();
  };

  const now = new Date();
  const preview: VibeView | null = hasContent(emoji, message)
    ? { emoji, message: tidyMessage(message) || null, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + VIBE_TTL_HOURS * 3_600_000).toISOString() }
    : null;

  return (
    <Sheet
      title={existing ? 'Edit status' : 'Set your status'}
      onClose={() => { if (!busy) onClose(); }}
      trapFocus
      footer={
        <div className="flex gap-2">
          {existing && (
            <button type="button" className={`${SECONDARY} px-4 text-danger`} onClick={() => void clear()} disabled={busy !== null}>
              {busy === 'clear' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Clear
            </button>
          )}
          <button type="button" className={`${SECONDARY} flex-1`} onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button type="button" className={`${PRIMARY} flex-[1.4]`} onClick={() => void save()} disabled={!canSave || busy !== null}>
            {busy === 'save' ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div data-testid="status-preview" className="flex min-h-12 items-center rounded-2xl border border-line bg-raised/60 px-3 py-2.5">
          {preview ? <VibeBubble vibe={preview} className="max-w-full" /> : <p className="text-xs text-muted">Pick an emoji or write a few words to see your status here.</p>}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPicking((value) => !value)}
              aria-expanded={picking}
              aria-label={emoji ? `Emoji: ${emoji}. Change emoji` : 'Choose an emoji'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-raised text-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/70 ${picking ? 'border-berry' : 'border-line hover:bg-raised/70'}`}
            >
              {emoji ? <span aria-hidden="true">{emoji}</span> : <SmilePlus className="h-5 w-5 text-muted" aria-hidden="true" />}
            </button>
            <input
              id={`${group}-msg`}
              aria-label="Your status message"
              value={message}
              onChange={(event) => setMessage([...event.target.value].slice(0, VIBE_MESSAGE_MAX).join(''))}
              autoComplete="off"
              placeholder="What’s on your mind?"
              aria-describedby={`${group}-count`}
              aria-invalid={problem ? true : undefined}
              className="block min-h-11 w-full min-w-0 rounded-xl border border-line bg-raised px-3 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg outline-none placeholder:text-muted focus:border-berry/60"
            />
          </div>
          <p id={`${group}-count`} className={`mt-1 text-right text-xs tabular-nums ${left < 0 ? 'text-danger' : 'text-muted'}`} aria-live="polite">
            {left < 0 ? `${-left} too many` : `${left} characters left`}
          </p>
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}

          {picking && (
            <div data-testid="emoji-picker" role="group" aria-label="Common emoji" className="mt-1 grid grid-cols-6 gap-1 rounded-2xl border border-line bg-raised/50 p-1.5">
              {COMMON_EMOJI.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Use ${option}`}
                  aria-pressed={emoji === option}
                  onClick={() => { setEmoji(option); setPicking(false); }}
                  className={`flex h-11 items-center justify-center rounded-xl text-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/70 ${emoji === option ? 'bg-plum/50 ring-1 ring-berry' : 'hover:bg-raised'}`}
                >
                  <span aria-hidden="true">{option}</span>
                </button>
              ))}
              {emoji && (
                <button type="button" onClick={() => { setEmoji(''); setPicking(false); }} className="col-span-6 mt-0.5 min-h-11 rounded-xl text-xs font-semibold text-muted transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/70">
                  No emoji, just words
                </button>
              )}
            </div>
          )}
        </div>

        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-xs font-semibold text-fg">Who can see my status?</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {VIBE_VISIBILITY_OPTIONS.map((option) => (
              <label
                key={option.id}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-1.5 text-center text-[length:calc(13px_*_var(--fs,1))] font-medium transition focus-within:ring-2 focus-within:ring-berry/70 ${visibility === option.id ? 'border-berry bg-plum/30 text-fg' : 'border-line text-muted hover:bg-raised/60'}`}
              >
                <input type="radio" name={`${group}-vis`} value={option.id} checked={visibility === option.id} onChange={() => setVisibility(option.id)} className="sr-only" aria-label={option.label} />
                {option.short}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{VIBE_VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label}. {VIBE_VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.hint}</p>
        </fieldset>

        <p className="text-xs text-muted">
          {existing ? `${vibeTimes(existing)}. Saving starts the ${VIBE_TTL_HOURS} hours again.` : `Clears on its own ${VIBE_TTL_HOURS} hours after you save it.`}
          {existing ? <span className="sr-only"> It clears in {expiresIn(existing.expiresAt)}.</span> : null}
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Sheet>
  );
};
