import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { fetchMemoryPhoto } from '../services/atlasService.ts';
import type { AtlasMemory } from '../utils/atlas.ts';

export type RecentStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A small picture of the memory, fetched through the same permission-checked request as the card (no public link); a star when there is none. */
const Thumb: React.FC<{ memory: AtlasMemory }> = ({ memory }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (memory.hasPhoto) void fetchMemoryPhoto(memory.id).then((found) => { if (live) setUrl(found); });
    return () => { live = false; };
  }, [memory.id, memory.hasPhoto]);
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
  ) : (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-ink/60"><span className="atlas-dot" /></span>
  );
};

interface Props {
  memories: AtlasMemory[];
  status: RecentStatus;
  open: boolean;
  onToggle: () => void;
  onPick: (memory: AtlasMemory) => void;
  onRetry: () => void;
}

/**
 * Recent Memories: a collapsed-by-default strip above the map. Opened, it shows (at most) the newest three community memories from the
 * last 24 hours; choosing one flies the map to it and opens its card. It is only a shortcut: every memory stays on the map, and nothing
 * here creates, hides or limits a memory.
 */
export const AtlasRecent: React.FC<Props> = ({ memories, status, open, onToggle, onPick, onRetry }) => {
  const panelId = useId();
  return (
    <section aria-label="Recent memories" className="shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="recent-toggle"
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-full border border-line bg-surface/80 px-3.5 text-left text-[length:calc(13px_*_var(--fs,1))] font-semibold text-muted transition-colors hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60"
      >
        <span aria-hidden="true" className="atlas-dot" />
        <span className="flex-1">Recent memories</span>
        {open && status === 'ready' && memories.length > 0 && <span className="text-subtle">{memories.length}</span>}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="mt-2" data-testid="recent-panel">
          {status === 'loading' && <p role="status" className="px-2 py-2 text-[length:calc(12.5px_*_var(--fs,1))] text-subtle">Looking for new stars…</p>}
          {status === 'error' && (
            <p role="alert" className="flex items-center gap-2 px-2 py-2 text-[length:calc(12.5px_*_var(--fs,1))] text-muted">
              Couldn’t load recent memories.
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold text-lavender underline underline-offset-2"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</button>
            </p>
          )}
          {status === 'ready' && memories.length === 0 && <p className="px-2 py-2 text-[length:calc(12.5px_*_var(--fs,1))] text-subtle">No new memories in the last 24 hours. Explore the map to find older ones.</p>}
          {status === 'ready' && memories.length > 0 && (
            <ul className="grid gap-1.5 sm:grid-cols-3" aria-label="Memories from the last 24 hours">
              {memories.slice(0, 3).map((memory) => (
                <li key={memory.id}>
                  <button type="button" onClick={() => onPick(memory)} className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-raised/60 px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60">
                    <Thumb memory={memory} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">{memory.title}</span>
                      <span className="block truncate text-[length:calc(12px_*_var(--fs,1))] text-subtle">{memory.placeLabel || 'Approximate area'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

export default AtlasRecent;
