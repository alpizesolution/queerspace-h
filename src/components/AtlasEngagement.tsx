import React, { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { reactToMemory } from '../services/atlasService.ts';
import { applyReaction, formatCount, REACTIONS, type Engagement, type ReactionKind } from '../utils/atlas.ts';

interface Props {
  memoryId: string;
  /** The member's own memory: the totals are shown, but nobody reacts to their own words. */
  mine: boolean;
  value: Engagement;
  onChange: (next: Engagement) => void;
}

/**
 * The strip under a memory: how many members opened it (an eye) and the two reactions, a hug and a heart. A member has ONE reaction at
 * most: choosing the other one moves it, choosing the same one again takes it back. The change shows at once and is confirmed (or put
 * back) by the server, which is the only place that counts; a second tap while one is being saved is ignored. Totals only, never who.
 */
export const AtlasEngagement: React.FC<Props> = ({ memoryId, mine, value, onChange }) => {
  const pending = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [memoryId]);

  const choose = async (kind: ReactionKind) => {
    if (pending.current) return;
    pending.current = true;
    setFailed(false);
    const before = latest.current;
    const next = before.mine === kind ? null : kind;
    onChange(applyReaction(before, next));
    const result = await reactToMemory(memoryId, next);
    pending.current = false;
    if (result.ok) onChange(result.value);
    else { onChange(before); setFailed(true); }
  };

  const counts: Record<ReactionKind, number> = { hug: value.hugs, heart: value.hearts };
  return (
    <div data-testid="memory-engagement" className="flex shrink-0 items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))]">
      <span data-testid="memory-views" title="Views" aria-label={`${value.views} ${value.views === 1 ? 'view' : 'views'}`} className="inline-flex items-center gap-1 pr-0.5 tabular-nums text-subtle">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />{formatCount(value.views)}
      </span>
      <div role="group" aria-label="Reactions" className="flex items-center gap-1">
        {REACTIONS.map(({ kind, emoji, label }) => {
          const active = value.mine === kind;
          const count = counts[kind];
          if (mine) {
            // Read-only for the author, and only once somebody has reacted.
            return count > 0 ? (
              <span key={kind} data-testid={`reaction-${kind}`} aria-label={`${count} ${label.toLowerCase()}${count === 1 ? '' : 's'}`} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-raised/40 px-2 tabular-nums text-muted">
                <span aria-hidden="true" className="text-[length:calc(13px_*_var(--fs,1))] leading-none">{emoji}</span>{formatCount(count)}
              </span>
            ) : null;
          }
          return (
            <button
              key={kind}
              type="button"
              data-testid={`reaction-${kind}`}
              onClick={() => void choose(kind)}
              aria-pressed={active}
              aria-label={`${label}, ${count}`}
              title={active ? `Take back your ${label.toLowerCase()}` : label}
              className={`inline-flex h-8 min-w-[2.9rem] cursor-pointer items-center justify-center gap-1 rounded-full border px-2 tabular-nums transition-colors desk:h-7 ${active ? 'border-lavender/60 bg-lavender/15 text-fg' : 'border-line bg-raised/50 text-muted hover:border-line-strong hover:text-fg'}`}
            >
              <span aria-hidden="true" className="text-[length:calc(13px_*_var(--fs,1))] leading-none">{emoji}</span>{formatCount(count)}
            </button>
          );
        })}
      </div>
      {failed && <span role="status" className="text-danger">Not saved</span>}
    </div>
  );
};
