import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { MOODS, MOOD_MAX, moodInfo, toggleMood } from '../utils/echoMoods.ts';

/**
 * Optional mood tags, kept small: the composer shows the chosen moods as removable pills and opens the full list on
 * request; a published Echo shows them as quiet pills under its text. Nothing here is a category.
 */

const PILL_ON = 'border-lavender/50 bg-lavender/10 text-lavender';

/** "How are you feeling?" in the composer. Up to two moods; none is fine. */
export function MoodPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const full = value.length >= MOOD_MAX;
  return (
    <div data-testid="mood-picker">
      <div className="flex items-center gap-2 mb-1.5">
        <p className="text-[length:calc(12px_*_var(--fs,1))] font-medium text-muted">How are you feeling? <span className="text-subtle font-normal">Optional, up to {MOOD_MAX}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const mood = moodInfo(id);
          if (!mood) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(toggleMood(value, id))}
              aria-label={`Remove mood ${mood.label}`}
              className={`chip chip-sm !h-7 ${PILL_ON}`}
            >
              <span aria-hidden="true">{mood.emoji}</span> {mood.label}
              <X className="w-3 h-3 opacity-70" aria-hidden="true" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="chip chip-sm !h-7 text-muted"
        >
          {!open && <Plus className="w-3 h-3" aria-hidden="true" />}
          {open ? 'Done' : value.length ? 'Change' : 'Add a mood'}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Moods">
          {MOODS.map((m) => {
            const on = value.includes(m.id);
            const blocked = full && !on;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                disabled={blocked}
                onClick={() => onChange(toggleMood(value, m.id))}
                className={`chip chip-sm !h-7 !px-2.5 ${on ? PILL_ON : ''} ${blocked ? 'opacity-40 cursor-default' : ''}`}
              >
                <span aria-hidden="true">{m.emoji}</span> {m.label}
              </button>
            );
          })}
        </div>
      )}
      {full && open && <p className="mt-1.5 text-[length:calc(11px_*_var(--fs,1))] text-subtle" aria-live="polite">That's two. Remove one to pick a different mood.</p>}
    </div>
  );
}

/** The moods on a published Echo. Renders nothing at all when there are none. */
export function MoodPills({ moods, className = '' }: { moods: readonly string[]; className?: string }) {
  const shown = moods.map(moodInfo).filter((m): m is NonNullable<ReturnType<typeof moodInfo>> => Boolean(m));
  if (shown.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Moods" data-testid="mood-pills">
      {shown.map((m) => (
        <li key={m.id} className="tag !bg-transparent !text-subtle">
          <span aria-hidden="true" className="mr-1">{m.emoji}</span>
          {m.label}
        </li>
      ))}
    </ul>
  );
}
