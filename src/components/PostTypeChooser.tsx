import React from 'react';
import { POST_KINDS, type PostKind } from '../utils/postIntent.ts';

/** Two choices at the top of a composer: what the post is for. Switching never clears what was written. */
export const PostTypeChooser: React.FC<{ value: PostKind; onChange: (kind: PostKind) => void }> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="What kind of post" className="grid gap-2 sm:grid-cols-2">
    {POST_KINDS.map((kind) => {
      const on = value === kind.id;
      return (
        <button
          key={kind.id}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => { if (!on) onChange(kind.id); }}
          className={`rounded-2xl border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${on ? 'border-berry bg-raised ring-1 ring-berry/50' : 'border-line bg-surface hover:border-berry/40'}`}
        >
          <span className="block text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">{kind.label}</span>
          <span className="mt-0.5 block text-[length:calc(12px_*_var(--fs,1))] leading-snug text-subtle">{kind.description}</span>
        </button>
      );
    })}
  </div>
);
