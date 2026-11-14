import React, { useState } from 'react';
import { Check, EyeOff, Flame, Lock, Reply, Shuffle } from 'lucide-react';
import { ConfirmDialog } from './Sheet.tsx';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';
import { revealNeedsDialog } from '../utils/lookingFor.ts';
import {
  NSFW_CATEGORIES,
  nsfwCardById,
  nsfwCardsInCategory,
  nsfwCategoryLabel,
  randomNsfwCard,
  type NsfwCard,
  type NsfwCategoryId,
} from '../utils/nsfwCards.ts';

/**
 * NSFW Cards: a second deck beside the Comfort Cards, with its own mature look (a deep wine surface with one quiet accent per
 * category). The picker part is shown inside the Comfort Cards picker as a second tab; the bubble part is the card in a
 * conversation. Nothing here sends anything by itself.
 *
 * The member's own NSFW setting decides everything that is visible: with "Always hide" no question and no card list is ever
 * rendered; "Ask before revealing" and "Show after confirmation" keep a received card covered until the member chooses to open it.
 */

export const NsfwCardsIcon: React.FC<{ className?: string }> = ({ className }) => <Flame className={className} aria-hidden="true" />;

/** One accent per category, used for a thin bar, the label and the selected state. Checked for contrast on the card surface in a test. */
export const NSFW_LOOK: Record<NsfwCategoryId, { accent: string }> = {
  flirty: { accent: '#ff8fb3' },
  spicy: { accent: '#ff9a6b' },
  intimate: { accent: '#c9a8ff' },
  boundaries: { accent: '#cdd8df' },
};
/** The card's own colours (the same in both app themes: a mature card is always dark). */
export const NSFW_SURFACE = { from: '#21091a', via: '#170711', to: '#10050c', border: '#5e2646', text: '#f8edf2', meta: '#d3b7c4', label: '#e8c4d4' } as const;

const accentOf = (category: string): string => NSFW_LOOK[category as NsfwCategoryId]?.accent ?? NSFW_LOOK.flirty.accent;
const surfaceStyle: React.CSSProperties = {
  backgroundImage: `linear-gradient(135deg, ${NSFW_SURFACE.from}, ${NSFW_SURFACE.via} 55%, ${NSFW_SURFACE.to})`,
  borderColor: NSFW_SURFACE.border,
  color: NSFW_SURFACE.text,
};

// ---------------------------------------------------------------------------------------------------------------- picker

interface DeckProps {
  preference: NsfwPreference;
  category: NsfwCategoryId;
  onCategory: (category: NsfwCategoryId) => void;
  selected: NsfwCard | null;
  onSelect: (card: NsfwCard) => void;
  onOpenSettings?: () => void;
}

/** The NSFW deck inside the picker. With "Always hide" it is a locked panel that holds no card at all. */
export const NsfwDeck: React.FC<DeckProps> = ({ preference, category, onCategory, selected, onSelect, onOpenSettings }) => {
  if (preference === 'hide') {
    return (
      <section data-testid="nsfw-deck-locked" style={surfaceStyle} className="rounded-2xl border px-4 py-5 text-center">
        <Lock className="mx-auto h-5 w-5" style={{ color: NSFW_SURFACE.label }} aria-hidden="true" />
        <h3 className="mt-2 text-[length:calc(16px_*_var(--fs,1))] font-semibold">NSFW Cards are off</h3>
        <p className="mx-auto mt-1 max-w-[22rem] text-[length:calc(13px_*_var(--fs,1))] leading-snug" style={{ color: NSFW_SURFACE.meta }}>
          Your content setting is “Always hide”, so mature cards stay hidden, both to send and to read. You can change it in Settings.
        </p>
        {onOpenSettings && <button type="button" onClick={onOpenSettings} className="btn btn-secondary btn-sm mt-3">Change setting</button>}
      </section>
    );
  }
  const shuffle = () => {
    const next = randomNsfwCard({ not: selected?.id });
    onCategory(next.category);
    onSelect(next);
  };
  const look = NSFW_LOOK[category];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label="About NSFW Cards" style={surfaceStyle} className="relative overflow-hidden rounded-2xl border px-4 py-3.5">
        <p className="text-[length:calc(10px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em]" style={{ color: NSFW_SURFACE.label }}>Adults only · 18+</p>
        <h3 className="mt-0.5 text-[length:calc(17px_*_var(--fs,1))] font-semibold leading-snug">Say it with a little heat.</h3>
        <p className="mt-0.5 text-[length:calc(13px_*_var(--fs,1))] leading-snug" style={{ color: NSFW_SURFACE.meta }}>
          Suggestive, never explicit. Everyone decides what they see, and a “no” or “not yet” is always a good answer.
        </p>
        <button
          type="button"
          onClick={shuffle}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[length:calc(14px_*_var(--fs,1))] font-semibold transition hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
          style={{ backgroundColor: look.accent, color: '#1a0712' }}
        >
          <Shuffle className="h-4 w-4" aria-hidden="true" /> Shuffle question
        </button>
      </section>

      <div role="tablist" aria-label="NSFW card categories" className="flex flex-wrap gap-1.5">
        {NSFW_CATEGORIES.map((c) => {
          const on = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={on}
              title={c.blurb}
              onClick={() => onCategory(c.id)}
              style={on ? { borderColor: NSFW_LOOK[c.id].accent, backgroundColor: `${NSFW_LOOK[c.id].accent}26`, color: NSFW_LOOK[c.id].accent } : { borderColor: `${NSFW_LOOK[c.id].accent}80` }}
              className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[length:calc(12.5px_*_var(--fs,1))] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 active:scale-[0.97] ${on ? '' : 'text-fg hover:bg-raised/60'}`}
            >
              <span aria-hidden="true">{c.emoji}</span>
              <span className="truncate">{c.label}</span>
            </button>
          );
        })}
      </div>
      <p className="-mt-1 text-[length:calc(12.5px_*_var(--fs,1))] text-muted">{NSFW_CATEGORIES.find((c) => c.id === category)?.blurb}</p>

      <ul aria-label={`${nsfwCategoryLabel(category)} questions`} className="-mx-1 flex max-h-[36dvh] flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-1 sm:max-h-[40dvh]">
        {nsfwCardsInCategory(category).map((card) => {
          const on = selected?.id === card.id;
          const accent = accentOf(card.category);
          return (
            <li key={card.id}>
              <button
                id={`card-${card.id}`}
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(card)}
                style={{ ...surfaceStyle, borderColor: on ? accent : NSFW_SURFACE.border }}
                className="group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border py-3 pl-4 pr-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 active:scale-[0.99]"
              >
                <span aria-hidden="true" className={`absolute inset-y-2 left-1.5 w-[3px] rounded-full transition-opacity ${on ? 'opacity-100' : 'opacity-50 group-hover:opacity-80'}`} style={{ backgroundColor: accent }} />
                <span className="min-w-0 flex-1 text-[length:calc(15px_*_var(--fs,1))] leading-relaxed [overflow-wrap:anywhere]">{card.question}</span>
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${on ? 'border-transparent' : 'scale-90 opacity-50'}`} style={on ? { backgroundColor: accent, color: '#1a0712' } : { borderColor: NSFW_SURFACE.border }}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** The picker's Send action for a chosen NSFW card, in the card's own accent. */
export const NsfwSendButton: React.FC<{ card: NsfwCard; onSend: () => void; onCancel: () => void }> = ({ card, onSend, onCancel }) => (
  <div className="flex gap-2">
    <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">Cancel</button>
    <button
      type="button"
      onClick={onSend}
      style={{ backgroundColor: accentOf(card.category), borderColor: accentOf(card.category), color: '#1a0712' }}
      className="btn flex-[2] border font-semibold transition active:scale-[0.98] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
    >
      Send this card 🔥
    </button>
  </div>
);

// ---------------------------------------------------------------------------------------------------------------- bubble

interface BubbleProps {
  card: { id: string; category: string };
  /** The member's own NSFW setting. */
  preference: NsfwPreference;
  /** True when this member sent the card: they chose it, so it is shown as long as their setting allows. */
  mine: boolean;
  canAnswer: boolean;
  onAnswer: () => void;
  pending?: boolean;
  time?: string;
  onOpenSettings?: () => void;
}

/**
 * An NSFW Card in a conversation. Covered (and holding none of its words) when the setting is "Always hide", and for a received
 * card until the member opens it with "Ask before revealing" or "Show after confirmation". The words come from the app's own list.
 */
export const NsfwCardBubble: React.FC<BubbleProps> = ({ card, preference, mine, canAnswer, onAnswer, pending = false, time, onOpenSettings }) => {
  const [revealed, setRevealed] = useState(false);
  const [asking, setAsking] = useState(false);
  const known = nsfwCardById(card.id);
  const accent = accentOf(card.category);
  const label = nsfwCategoryLabel(card.category) || 'Mature';
  const blocked = preference === 'hide';
  const open = !blocked && !!known && (mine || revealed);
  const timeLine = time ? <span className="text-[length:calc(12px_*_var(--fs,1))] tabular-nums" style={{ color: NSFW_SURFACE.meta }}>{time}</span> : <span />;

  const shell = (state: 'blocked' | 'covered' | 'open', children: React.ReactNode) => (
    <div className="min-w-0 max-w-full flex-auto" data-testid="nsfw-card" data-state={state}>
      <div style={surfaceStyle} className="relative overflow-hidden rounded-2xl border py-3 pl-5 pr-4">
        <span aria-hidden="true" className="absolute inset-y-2.5 left-2 w-[3px] rounded-full" style={{ backgroundColor: accent }} />
        <p className="flex items-center gap-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-wide" style={{ color: NSFW_SURFACE.label }}>
          <NsfwCardsIcon className="h-3.5 w-3.5" /> Mature card · <span style={{ color: accent }}>{label}</span>
        </p>
        {children}
      </div>
    </div>
  );

  if (blocked) {
    return shell('blocked', (
      <>
        <p className="mt-2 flex items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))] font-medium"><EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" /> Hidden by your content setting.</p>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          {timeLine}
          {onOpenSettings && <button type="button" onClick={(e) => { e.stopPropagation(); onOpenSettings(); }} className="inline-flex min-h-10 items-center rounded-full border px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold" style={{ borderColor: NSFW_SURFACE.border, color: NSFW_SURFACE.text }}>Change setting</button>}
        </div>
      </>
    ));
  }

  if (!open) {
    return (
      <>
        {shell('covered', (
          <>
            <p className="mt-2 text-[length:calc(14px_*_var(--fs,1))]" style={{ color: NSFW_SURFACE.meta }}>{known ? 'A suggestive question, covered until you choose to open it.' : 'This card can’t be shown.'}</p>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              {timeLine}
              {known && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (revealNeedsDialog(preference)) setAsking(true); else setRevealed(true); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="inline-flex min-h-10 items-center rounded-full px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition hover:brightness-110 active:scale-[0.97]"
                  style={{ backgroundColor: accent, color: '#1a0712' }}
                >
                  Reveal card
                </button>
              )}
            </div>
          </>
        ))}
        {asking && (
          <ConfirmDialog
            title="Show this mature card?"
            message="It is a suggestive question from your connection. You can answer it, or simply ignore it."
            confirmLabel="Show card"
            onConfirm={() => { setAsking(false); setRevealed(true); }}
            onCancel={() => setAsking(false)}
          />
        )}
      </>
    );
  }

  return shell('open', (
    <>
      <p className="mt-1.5 text-[length:calc(16px_*_var(--fs,1))] font-medium leading-snug [overflow-wrap:anywhere]">{known!.question}</p>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        {timeLine}
        {canAnswer && (
          <button
            type="button"
            disabled={pending}
            onClick={(e) => { e.stopPropagation(); onAnswer(); }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Answer this card: ${known!.question}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: accent, color: accent }}
          >
            <Reply className="h-4 w-4" aria-hidden="true" /> Answer
          </button>
        )}
      </div>
    </>
  ));
};
