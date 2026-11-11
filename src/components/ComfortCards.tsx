import React, { useRef, useState } from 'react';
import { Layers, Reply, Shuffle } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { CARD_CATEGORIES, cardsInCategory, categoryLabel, randomCard, type CardCategoryId, type ComfortCard } from '../utils/comfortCards.ts';

/**
 * Comfort Cards in the Signals composer: a compact picker (categories, questions, a random one, a preview) and the card as it
 * looks inside a conversation. Nothing here sends anything by itself: the picker hands the chosen card to the conversation.
 */

/** The composer button's icon: a small stack of cards. */
export const ComfortCardsIcon: React.FC<{ className?: string }> = ({ className }) => <Layers className={className} aria-hidden="true" />;

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

  const send = () => {
    if (!selected || sent.current) return;
    sent.current = true;
    onSend(selected);
  };

  return (
    <Sheet
      title="Comfort Cards"
      onClose={onClose}
      icon={<ComfortCardsIcon className="h-4 w-4" />}
      footer={
        selected ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(null)} className="btn btn-secondary flex-1">Cancel</button>
            <button type="button" onClick={send} className="btn btn-primary flex-1">Send card</button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 text-fg">
        {selected ? (
          <div data-testid="card-preview" aria-label="Card preview" role="group">
            <p className="mb-1.5 text-[length:calc(12px_*_var(--fs,1))] font-semibold text-muted">Preview</p>
            <CardFace card={selected} />
            <button type="button" onClick={() => setSelected(randomCard({ not: selected.id }))} className="btn btn-ghost btn-sm mt-2">
              <Shuffle className="h-4 w-4" aria-hidden="true" /> Another random one
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setSelected(randomCard())} className="btn btn-secondary btn-sm self-start">
              <Shuffle className="h-4 w-4" aria-hidden="true" /> Random question
            </button>
            <div role="tablist" aria-label="Card categories" className="flex flex-wrap gap-1.5">
              {CARD_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={`chip chip-sm !h-8 ${category === c.id ? 'border-lavender/50 bg-lavender/10 text-lavender' : ''}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <ul aria-label={`${categoryLabel(category)} questions`} className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
              {cardsInCategory(category).map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(card)}
                    className="w-full rounded-xl border border-line bg-raised/60 px-3 py-2 text-left text-[length:calc(14px_*_var(--fs,1))] leading-snug text-fg transition hover:border-lavender/40 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
                  >
                    {card.question}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
};

/** The card itself: its category, then the question. Used in the preview and, as a bubble, in the conversation. */
const CardFace: React.FC<{ card: Pick<ComfortCard, 'category' | 'question'> }> = ({ card }) => (
  <div className="rounded-2xl border border-lavender/30 bg-gradient-to-br from-plum/40 via-surface to-ink px-4 py-3">
    <p className="flex items-center gap-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-wide text-lavender">
      <ComfortCardsIcon className="h-3.5 w-3.5" /> {categoryLabel(card.category)}
    </p>
    <p className="mt-1.5 text-[length:calc(16px_*_var(--fs,1))] font-medium leading-snug text-fg [overflow-wrap:anywhere]">{card.question}</p>
  </div>
);

/** A Comfort Card inside a message bubble, with an Answer button for either person: the answer is an ordinary reply. */
export const ComfortCardBubble: React.FC<{ card: Pick<ComfortCard, 'category' | 'question'>; canAnswer: boolean; onAnswer: () => void }> = ({ card, canAnswer, onAnswer }) => (
  <div className="min-w-0 max-w-full flex-auto text-fg" data-testid="comfort-card">
    <CardFace card={card} />
    {canAnswer && (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onAnswer(); }}
        onKeyDown={(event) => event.stopPropagation()}
        className="mt-1.5 inline-flex h-8 items-center gap-1 rounded-full border border-lavender/40 bg-plum/30 px-3 text-[length:calc(12px_*_var(--fs,1))] font-semibold text-lavender transition hover:bg-plum/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
        aria-label={`Answer this card: ${card.question}`}
      >
        <Reply className="h-3.5 w-3.5" aria-hidden="true" /> Answer
      </button>
    )}
  </div>
);
