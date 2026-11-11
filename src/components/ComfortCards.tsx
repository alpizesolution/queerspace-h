import React, { useEffect, useRef, useState } from 'react';
import { Check, Layers, Reply, Shuffle } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { CARD_CATEGORIES, cardsInCategory, categoryLabel, randomCard, type CardCategoryId, type ComfortCard } from '../utils/comfortCards.ts';

/**
 * Comfort Cards in the Signals and Seek composers: a compact picker (a featured random question, six coloured categories, the
 * questions, one persistent Send action) and the card as it looks inside a conversation. Nothing here sends anything by
 * itself: the picker hands the chosen card to the conversation.
 *
 * Colour: one soft accent per category (rose, peach, lavender, magenta, periwinkle, mint), used only as a quiet tint, a thin
 * accent bar and the selected state, so the list stays cohesive and calm on the plum background.
 */

/** The composer button's icon: a small stack of cards. */
export const ComfortCardsIcon: React.FC<{ className?: string }> = ({ className }) => <Layers className={className} aria-hidden="true" />;

/**
 * Accent as "r g b" triplets (used as rgb(var(--accent) / alpha)): `dark` for the dark theme, `light` a deeper shade for the light
 * theme, plus a small emoji per category. The `cc-accent` class (index.css) picks the one that matches the theme.
 */
const LOOK: Record<CardCategoryId, { dark: string; light: string; emoji: string }> = {
  soft: { dark: '244 143 177', light: '163 35 79', emoji: '🌸' },
  know: { dark: '247 178 130', light: '148 69 16', emoji: '🌅' },
  deep: { dark: '183 156 240', light: '106 58 168', emoji: '🌙' },
  love: { dark: '232 121 198', light: '154 31 130', emoji: '💗' },
  fun: { dark: '143 165 245', light: '51 73 176', emoji: '🪐' },
  comfort: { dark: '122 211 184', light: '20 98 82', emoji: '🌿' },
};
/** The accents, for tests that check their contrast in both themes. */
export const CATEGORY_ACCENTS = LOOK;

const accentStyle = (category: string): React.CSSProperties => {
  const look = LOOK[category as CardCategoryId] ?? LOOK.deep;
  return { ['--accent-d' as string]: look.dark, ['--accent-l' as string]: look.light };
};

/** A tiny decorative star; purely visual. */
const Star: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden="true" className={`pointer-events-none select-none leading-none text-lavender/60 ${className}`}>✦</span>
);

interface PickerProps {
  /** Called once with the chosen card when the member taps Send. */
  onSend: (card: ComfortCard) => void;
  onClose: () => void;
}

export const ComfortCardPicker: React.FC<PickerProps> = ({ onSend, onClose }) => {
  const [category, setCategory] = useState<CardCategoryId>(CARD_CATEGORIES[0].id);
  const [selected, setSelected] = useState<ComfortCard | null>(null);
  /** Set the instant Send is chosen, so a quick second tap cannot send it twice. */
  const sent = useRef(false);
  /** After a shuffle the chosen question may be further down the list: bring it into view (a manual tap never moves the list). */
  const reveal = useRef(false);

  useEffect(() => {
    if (!reveal.current || !selected) return;
    reveal.current = false;
    document.getElementById(`card-${selected.id}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const send = () => {
    if (!selected || sent.current) return;
    sent.current = true;
    onSend(selected);
  };

  /** Shuffle: a random question from the whole collection, never the one already chosen; its category opens so it can be seen. */
  const shuffle = () => {
    const next = randomCard({ not: selected?.id });
    reveal.current = true;
    setCategory(next.category);
    setSelected(next);
  };

  return (
    <Sheet
      title="Comfort Cards"
      onClose={onClose}
      icon={<ComfortCardsIcon className="h-4 w-4 text-lavender" />}
      footer={
        selected ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(null)} className="btn btn-secondary flex-1">Cancel</button>
            <button
              type="button"
              onClick={send}
              style={accentStyle(selected.category)}
              className="cc-accent btn flex-[2] border border-[rgb(var(--accent))] bg-[rgb(var(--accent))] font-semibold text-ink shadow-[0_6px_20px_-8px_rgb(var(--accent)/0.7)] transition active:scale-[0.98] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
            >
              Send this card ✨
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex min-w-0 flex-col gap-3 text-fg">
        <p className="-mt-1 flex items-center gap-1.5 text-[length:calc(13px_*_var(--fs,1))] text-muted">
          <Star className="text-[length:calc(10px_*_var(--fs,1))]" /> Little questions, meaningful connections. <Star className="text-[length:calc(8px_*_var(--fs,1))]" />
        </p>

        {/* Featured: a random question. */}
        <section
          aria-label="Daily icebreaker"
          className="relative overflow-hidden rounded-2xl border border-lavender/25 bg-gradient-to-br from-plum/60 via-surface to-[rgb(143_165_245/0.12)] px-4 py-3.5"
        >
          <Star className="absolute right-4 top-3 text-[length:calc(13px_*_var(--fs,1))]" />
          <Star className="absolute right-10 top-7 text-[length:calc(8px_*_var(--fs,1))] opacity-70" />
          <Star className="absolute bottom-3 right-7 text-[length:calc(10px_*_var(--fs,1))] opacity-60" />
          <p className="text-[length:calc(10px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-lavender">Daily icebreaker</p>
          <h3 className="mt-0.5 text-[length:calc(17px_*_var(--fs,1))] font-semibold leading-snug text-fg">Let’s make a little connection.</h3>
          <p className="mt-0.5 max-w-[24rem] text-[length:calc(13px_*_var(--fs,1))] leading-snug text-muted">Draw a question at random and see where it takes you.</p>
          <button
            type="button"
            onClick={shuffle}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-[#f48fb1] via-[#d49af0] to-[#8fa5f5] px-4 text-[length:calc(14px_*_var(--fs,1))] font-semibold text-[#1c1022] shadow-[0_6px_18px_-8px_rgba(212,154,240,0.8)] transition hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" /> Shuffle question
          </button>
        </section>

        {/* Categories. */}
        <div role="tablist" aria-label="Card categories" className="flex flex-wrap gap-1.5">
          {CARD_CATEGORIES.map((c) => {
            const on = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setCategory(c.id)}
                style={accentStyle(c.id)}
                className={`cc-accent inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[length:calc(12.5px_*_var(--fs,1))] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 active:scale-[0.97] ${
                  on
                    ? 'border-[rgb(var(--accent)/0.65)] bg-[rgb(var(--accent)/0.2)] text-[rgb(var(--accent))] shadow-[0_0_14px_-4px_rgb(var(--accent)/0.6)]'
                    : 'border-[rgb(var(--accent)/0.65)] bg-[rgb(var(--accent)/0.07)] text-fg hover:bg-[rgb(var(--accent)/0.13)]'
                }`}
              >
                <span aria-hidden="true">{LOOK[c.id].emoji}</span>
                <span className="truncate">{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* Questions of the chosen category: this list scrolls on its own, so the chips above and the Send action below stay put. */}
        <ul aria-label={`${categoryLabel(category)} questions`} className="-mx-1 flex max-h-[40dvh] flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-1 sm:max-h-[44dvh]">
          {cardsInCategory(category).map((card) => {
            const on = selected?.id === card.id;
            return (
              <li key={card.id} style={accentStyle(card.category)} className="cc-accent">
                <button
                  id={`card-${card.id}`}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(card)}
                  className={`group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border py-3 pl-4 pr-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 active:scale-[0.99] ${
                    on
                      ? 'border-[rgb(var(--accent)/0.7)] bg-[rgb(var(--accent)/0.16)] shadow-[0_6px_22px_-10px_rgb(var(--accent)/0.75)]'
                      : 'border-[rgb(var(--accent)/0.65)] bg-[rgb(var(--accent)/0.05)] hover:border-[rgb(var(--accent)/0.85)] hover:bg-[rgb(var(--accent)/0.1)]'
                  }`}
                >
                  <span aria-hidden="true" className={`absolute inset-y-2 left-1.5 w-[3px] rounded-full bg-[rgb(var(--accent))] transition-opacity ${on ? 'opacity-90' : 'opacity-45 group-hover:opacity-70'}`} />
                  <span className="min-w-0 flex-1 text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-fg [overflow-wrap:anywhere]">{card.question}</span>
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                      on ? 'border-transparent bg-[rgb(var(--accent))] text-ink scale-100' : 'border-line scale-90 opacity-50'
                    }`}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
};

/**
 * The card itself, as a bubble in the conversation. It has its own surface and colours (index.css, --card-*), never the ones of
 * the message bubble around it, so it reads the same in a pink outgoing bubble, a dark or pale incoming one, in either theme. The
 * category accent is only a thin bar and a star; every piece of text uses the card's own text colours.
 */
const CardFace: React.FC<{ card: Pick<ComfortCard, 'category' | 'question'>; footer?: React.ReactNode }> = ({ card, footer }) => (
  <div
    style={accentStyle(card.category)}
    className="cc-accent relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] py-3 pl-5 pr-4 text-[var(--card-text)]"
  >
    <span aria-hidden="true" className="absolute inset-y-2.5 left-2 w-[3px] rounded-full bg-[rgb(var(--accent))]" />
    <Star className="absolute right-3 top-2 text-[length:calc(10px_*_var(--fs,1))] !text-[rgb(var(--accent))]" />
    <p className="flex items-center gap-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-wide text-[var(--card-label)]">
      <ComfortCardsIcon className="h-3.5 w-3.5" /> {categoryLabel(card.category)}
    </p>
    <p className="mt-1.5 text-[length:calc(16px_*_var(--fs,1))] font-medium leading-snug text-[var(--card-text)] [overflow-wrap:anywhere]">{card.question}</p>
    {footer}
  </div>
);

interface BubbleProps {
  card: Pick<ComfortCard, 'category' | 'question'>;
  /** False hides the Answer button altogether (the connection has ended). */
  canAnswer: boolean;
  onAnswer: () => void;
  /** The card is still being sent: Answer is shown but cannot be used yet. */
  pending?: boolean;
  /** When it was sent, shown on the card itself so it is always readable on the card's own surface. */
  time?: string;
}

/** A Comfort Card inside a message bubble, with an Answer button for either person: the answer is an ordinary reply. */
export const ComfortCardBubble: React.FC<BubbleProps> = ({ card, canAnswer, onAnswer, pending = false, time }) => (
  <div className="min-w-0 max-w-full flex-auto" data-testid="comfort-card">
    <CardFace
      card={card}
      footer={
        (canAnswer || time) ? (
          <div className="mt-2.5 flex items-center justify-between gap-3">
            {time ? <span className="text-[length:calc(12px_*_var(--fs,1))] tabular-nums text-[var(--card-meta)]">{time}</span> : <span />}
            {canAnswer && (
              <button
                type="button"
                disabled={pending}
                onClick={(event) => { event.stopPropagation(); onAnswer(); }}
                onKeyDown={(event) => event.stopPropagation()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--card-btn-border)] bg-[var(--card-btn-bg)] px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-[var(--card-btn-text)] transition-colors hover:bg-[var(--card-btn-hover)] active:bg-[var(--card-btn-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--card-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card-bg)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--card-btn-disabled-bg)] disabled:text-[var(--card-btn-disabled-text)]"
                aria-label={`Answer this card: ${card.question}`}
              >
                <Reply className="h-4 w-4" aria-hidden="true" /> Answer
              </button>
            )}
          </div>
        ) : null
      }
    />
  </div>
);
