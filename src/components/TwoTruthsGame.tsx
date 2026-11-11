import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import {
  GAME_TEXT,
  INTRO_MAX,
  STATEMENT_COUNT,
  STATEMENT_MAX,
  challengeProblems,
  resultLine,
  toChallenge,
  type Challenge,
  type ChallengeDraft,
  type ChallengeProblem,
  type GameCard,
} from '../utils/twoTruths.ts';

/**
 * Two Truths and a Lie inside a Signals conversation: the icon for the composer, the sheet where a challenge is written and
 * previewed, and the card in the thread. Nothing here talks to the server: the conversation sends the challenge and the guess.
 * The card uses the Comfort Card colours (index.css, --card-*), which were measured for contrast in both themes.
 */

export const TwoTruthsIcon: React.FC<{ className?: string }> = ({ className }) => <Sparkles className={className} aria-hidden="true" />;

/** A tiny decorative star; purely visual. */
const Star: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden="true" className={`pointer-events-none select-none leading-none text-[var(--card-label)] ${className}`}>✦</span>
);

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-[length:calc(14px_*_var(--fs,1))] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY = `${BUTTON} bg-berry text-ink hover:brightness-110 active:scale-95`;
const SECONDARY = `${BUTTON} border border-line bg-raised text-fg hover:bg-raised/70 active:scale-95`;

/** The three statements, numbered, as a plain read-only list (the preview and the sender's own card). */
const StatementList: React.FC<{ statements: string[]; mark?: number | null; markLabel?: string }> = ({ statements, mark = null, markLabel }) => (
  <ol className="mt-2 space-y-1.5">
    {statements.map((statement, index) => (
      <li key={index} className="flex items-start gap-2 rounded-xl border border-[var(--card-border)]/40 px-3 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-[var(--card-text)]">
        <span className="mt-px shrink-0 font-semibold tabular-nums text-[var(--card-label)]">{index + 1}.</span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{statement}</span>
        {mark === index && markLabel && <span className="shrink-0 rounded-full bg-[var(--card-btn-bg)] px-2 py-0.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold text-[var(--card-btn-text)]">{markLabel}</span>}
      </li>
    ))}
  </ol>
);

interface CreatorProps {
  /** Called once with the finished challenge when the member taps Send Challenge. */
  onSend: (challenge: Challenge) => void;
  onClose: () => void;
}

export const TwoTruthsCreator: React.FC<CreatorProps> = ({ onSend, onClose }) => {
  const [statements, setStatements] = useState<string[]>(() => Array(STATEMENT_COUNT).fill(''));
  const [lie, setLie] = useState<number | null>(null);
  const [intro, setIntro] = useState('');
  const [previewing, setPreviewing] = useState(false);
  /** Problems are only shown once the member has tried to go on, so a fresh form is not covered in warnings. */
  const [tried, setTried] = useState(false);
  /** Set the instant Send is chosen, so a quick second tap cannot send it twice. */
  const sent = useRef(false);
  const group = useId();

  const draft: ChallengeDraft = { statements, lie, intro };
  const problems: ChallengeProblem | null = challengeProblems(draft);
  const shown = tried ? problems : null;

  const preview = () => {
    setTried(true);
    if (!problems) setPreviewing(true);
  };

  const send = () => {
    const challenge = toChallenge(draft);
    if (!challenge || sent.current) return;
    sent.current = true;
    onSend(challenge);
  };

  const field = 'block min-h-11 w-full min-w-0 rounded-xl border border-line bg-raised px-3 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg outline-none placeholder:text-subtle focus:border-berry/60';

  return (
    <Sheet
      title="Two Truths and a Lie"
      icon={<Sparkles className="h-5 w-5 text-lavender" aria-hidden="true" />}
      onClose={onClose}
      trapFocus
      footer={
        previewing ? (
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={() => setPreviewing(false)}>Edit</button>
            <button type="button" className={`${PRIMARY} flex-[2]`} onClick={send}><Sparkles className="h-4 w-4" aria-hidden="true" /> Send Challenge</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={onClose}>Cancel</button>
            <button type="button" className={`${PRIMARY} flex-[2]`} onClick={preview}>Preview</button>
          </div>
        )
      }
    >
      {previewing ? (
        <div data-testid="two-truths-preview">
          <p className="text-xs text-muted">This is how it will look to them. Only you will know which one is the lie until they guess.</p>
          <div className="relative mt-3 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 text-[var(--card-text)]">
            <p className="flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] font-semibold uppercase tracking-wide text-[var(--card-label)]"><Star /> {GAME_TEXT}</p>
            {intro.trim() && <p className="mt-1.5 text-[length:calc(14px_*_var(--fs,1))] [overflow-wrap:anywhere]">{intro.trim()}</p>}
            <StatementList statements={statements.map((s) => s.replace(/\s+/g, ' ').trim())} mark={lie} markLabel="Your lie" />
            <p className="mt-2.5 text-[length:calc(13px_*_var(--fs,1))] text-[var(--card-meta)]">Which one do you think is the lie?</p>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); preview(); }} noValidate className="space-y-3">
          <p className="text-xs text-muted">Write two true things and one lie about yourself, then say which is the lie. They’ll guess.</p>
          <fieldset className="min-w-0 space-y-2.5 border-0 p-0">
            <legend className="sr-only">Your three statements. Choose the one that is the lie.</legend>
            {statements.map((text, index) => {
              const id = `${group}-s${index}`;
              const error = shown?.statements[index];
              return (
                <div key={index}>
                  <label htmlFor={id} className="mb-1 block text-xs font-semibold text-fg">Statement {index + 1}</label>
                  <div className="flex items-center gap-2">
                    <input
                      id={id}
                      value={text}
                      onChange={(event) => setStatements((list) => list.map((s, i) => (i === index ? event.target.value.slice(0, STATEMENT_MAX) : s)))}
                      maxLength={STATEMENT_MAX}
                      autoComplete="off"
                      placeholder={index === 0 ? 'Something about you…' : index === 1 ? 'Another one…' : 'And one more…'}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-e` : undefined}
                      className={field}
                    />
                    <label className={`flex min-h-11 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition focus-within:ring-2 focus-within:ring-fg ${lie === index ? 'border-berry bg-plum/40 text-fg' : 'border-line text-muted hover:bg-raised'}`}>
                      <input type="radio" name={`${group}-lie`} checked={lie === index} onChange={() => setLie(index)} className="h-4 w-4 accent-[var(--color-berry)]" aria-label={`Statement ${index + 1} is the lie`} />
                      Lie
                    </label>
                  </div>
                  {error && <p id={`${id}-e`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
                </div>
              );
            })}
          </fieldset>
          {shown?.lie && <p role="alert" className="text-xs text-danger">{shown.lie}</p>}
          <div>
            <label htmlFor={`${group}-intro`} className="mb-1 block text-xs font-semibold text-fg">A short note <span className="font-normal text-muted">(optional)</span></label>
            <input id={`${group}-intro`} value={intro} onChange={(event) => setIntro(event.target.value.slice(0, INTRO_MAX))} maxLength={INTRO_MAX} autoComplete="off" placeholder="Think you can spot it?" className={field} />
            {shown?.intro && <p role="alert" className="mt-1 text-xs text-danger">{shown.intro}</p>}
          </div>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1}>Preview</button>
        </form>
      )}
    </Sheet>
  );
};

interface CardProps {
  game: GameCard;
  /** True when the viewer made this challenge. */
  mine: boolean;
  partnerName: string;
  /** Still being sent: nothing can be done with it yet. */
  pending?: boolean;
  /** A guess is on its way to the server. */
  guessing?: boolean;
  /** Why the last guess did not go through, if it did not. */
  error?: string | null;
  time?: string;
  onGuess: (index: number) => void;
}

/** The game in the conversation: three statements, a guess for the recipient, and the same result for both once it is answered. */
export const TwoTruthsCard: React.FC<CardProps> = ({ game, mine, partnerName, pending = false, guessing = false, error, time, onGuess }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const complete = game.status === 'complete';
  /** True when this card was open when it appeared and then completed, so only a reveal that happens while watching is animated. */
  const wasOpen = useRef(!complete);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (complete && wasOpen.current) setRevealed(true);
    if (!complete) wasOpen.current = true;
  }, [complete]);

  const stop = { onClick: (event: React.MouseEvent) => event.stopPropagation(), onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation() };
  const guessable = game.canGuess && !complete && !pending;
  const result = complete ? resultLine(game, !mine, partnerName) : null;

  return (
    <div
      data-testid="two-truths-card"
      data-status={game.status}
      className="cc-accent relative w-full min-w-0 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 text-left text-[var(--card-text)] shadow-lg shadow-black/20"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] font-semibold uppercase tracking-wide text-[var(--card-label)]">
          <span className="min-w-0">{GAME_TEXT}</span>
        </p>
        <span data-testid="two-truths-status" className="shrink-0 whitespace-nowrap rounded-full border border-[var(--card-border)]/60 px-2 py-0.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold text-[var(--card-meta)]">
          <Star className="mr-1 text-[0.8em]" />{complete ? 'Answered' : pending ? 'Sending' : mine ? 'Waiting' : 'Your turn'}
        </span>
      </div>
      {game.intro && <p className="mt-1.5 text-[length:calc(14px_*_var(--fs,1))] leading-snug [overflow-wrap:anywhere]">{game.intro}</p>}

      {guessable ? (
        <>
          <div role="radiogroup" aria-label="Which one do you think is the lie?" className="mt-2 space-y-1.5">
            {game.statements.map((statement, index) => {
              const on = selected === index;
              return (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={guessing}
                  onClick={(event) => { event.stopPropagation(); setSelected(index); }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={`flex min-h-11 w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-[length:calc(15px_*_var(--fs,1))] leading-snug transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--card-focus)] disabled:cursor-not-allowed ${on ? 'border-[var(--card-focus)] bg-[var(--card-btn-bg)] ring-1 ring-[var(--card-focus)]' : 'border-[var(--card-border)]/50 hover:bg-[var(--card-btn-bg)]/60'}`}
                >
                  <span className="mt-px shrink-0 font-semibold tabular-nums text-[var(--card-label)]">{index + 1}.</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{statement}</span>
                  {on && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--card-label)]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      ) : complete ? (
        <ol className={`mt-2 space-y-1.5 ${revealed ? 'anim-reveal' : ''}`} aria-label="Result">
          {game.statements.map((statement, index) => {
            const isLie = index === game.lie;
            const guessed = index === game.guess;
            return (
              <li
                key={index}
                data-lie={isLie ? 'true' : undefined}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[length:calc(15px_*_var(--fs,1))] leading-snug ${isLie ? 'border-[var(--card-focus)] bg-[var(--card-btn-bg)]' : 'border-[var(--card-border)]/40'}`}
              >
                <span className="mt-px shrink-0 font-semibold tabular-nums text-[var(--card-label)]">{index + 1}.</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{statement}</span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold">
                  <span className="inline-flex items-center gap-0.5 text-[var(--card-label)]">
                    {isLie ? <><X className="h-3 w-3" aria-hidden="true" /> The lie</> : <><Check className="h-3 w-3" aria-hidden="true" /> Truth</>}
                  </span>
                  {guessed && <span className="text-[var(--card-meta)]">{mine ? `${partnerName}’s guess` : 'Your guess'}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <StatementList statements={game.statements} />
      )}

      {result ? (
        <div role="status" className={`mt-2.5 ${revealed ? 'anim-reveal' : ''}`}>
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-snug [overflow-wrap:anywhere]">{result.title}</p>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-[var(--card-meta)]">{result.detail}</p>
        </div>
      ) : (
        <p className="mt-2.5 text-[length:calc(13px_*_var(--fs,1))] leading-snug text-[var(--card-meta)]">
          {mine ? `Waiting for ${partnerName} to guess…` : 'Which one do you think is the lie?'}
        </p>
      )}

      {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}

      <div className="mt-2.5 flex items-center justify-between gap-3">
        {time ? <span className="text-[length:calc(12px_*_var(--fs,1))] tabular-nums text-[var(--card-meta)]">{time}</span> : <span />}
        {guessable && (
          <button
            type="button"
            disabled={selected === null || guessing}
            {...stop}
            onClick={(event) => { event.stopPropagation(); if (selected !== null && !guessing) onGuess(selected); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--card-btn-border)] bg-[var(--card-btn-bg)] px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-[var(--card-btn-text)] transition-colors hover:bg-[var(--card-btn-hover)] active:bg-[var(--card-btn-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--card-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card-bg)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--card-btn-disabled-bg)] disabled:text-[var(--card-btn-disabled-text)]"
          >
            {guessing ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking…</> : 'Submit Guess'}
          </button>
        )}
      </div>
    </div>
  );
};
