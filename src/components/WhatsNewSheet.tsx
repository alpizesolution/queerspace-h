import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Sparkles } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import {
  AppUpdate,
  categoryLabel,
  loadPublishedUpdates,
  loadReadIds,
  markUpdateRead,
} from '../services/appUpdatesService.ts';

const DATE_FORMAT = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

export function formatUpdateDate(ms: number | null): string {
  return ms ? DATE_FORMAT.format(new Date(ms)) : '';
}

interface WhatsNewSheetProps {
  onClose: () => void;
  /** Called after the panel closes so the unread dot can be recomputed. */
  onChanged: () => void;
}

export const WhatsNewSheet: React.FC<WhatsNewSheetProps> = ({ onClose, onChanged }) => {
  const [items, setItems] = useState<AppUpdate[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState('loading');
    Promise.all([loadPublishedUpdates(), loadReadIds()])
      .then(([page, read]) => {
        setItems(page.items);
        setNextBefore(page.nextBefore);
        setReadIds(read);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(load, [load]);
  useEffect(() => () => onChanged(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (update: AppUpdate) => {
    const opening = openId !== update.id;
    setOpenId(opening ? update.id : null);
    if (!opening || readIds.has(update.id)) return;
    // Only this update is marked; the dot clears when none are left.
    setReadIds((prev) => new Set(prev).add(update.id));
    markUpdateRead(update.id).catch(() => {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(update.id);
        return next;
      });
    });
  };

  const showEarlier = () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    loadPublishedUpdates(nextBefore)
      .then((page) => {
        setItems((prev) => [...prev, ...page.items.filter((u) => !prev.some((p) => p.id === u.id))]);
        setNextBefore(page.nextBefore);
      })
      .catch(() => setState('error'))
      .finally(() => setLoadingMore(false));
  };

  return (
    <Sheet title="What's New" icon={<Sparkles className="w-5 h-5 text-lavender" />} onClose={onClose}>
      <div className="px-5 pb-6">
        {state === 'loading' && <p className="py-8 text-center text-sm text-muted" role="status">Loading updates…</p>}

        {state === 'error' && (
          <div className="py-8 text-center" role="alert">
            <p className="text-sm text-muted">We couldn’t load updates right now.</p>
            <button type="button" onClick={load} className="chip mt-3">Try again</button>
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Nothing new yet. We’ll post updates here.</p>
        )}

        {state === 'ready' && items.length > 0 && (
          <ul className="divide-y divide-line">
            {items.map((update) => {
              const open = openId === update.id;
              const unread = !readIds.has(update.id);
              return (
                <li key={update.id}>
                  <button
                    type="button"
                    onClick={() => toggle(update)}
                    aria-expanded={open}
                    className="w-full flex items-start gap-3 py-3.5 text-left cursor-pointer"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] text-subtle font-semibold">
                        {categoryLabel(update.category)}
                        <span className="normal-case tracking-normal font-normal">{formatUpdateDate(update.publishedAt)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">
                        {update.title}
                        {unread && (
                          <span className="w-2 h-2 rounded-full bg-berry shrink-0">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronDown className={`mt-5 w-4 h-4 shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <div className="pb-4 anim-fade">
                      <p className="whitespace-pre-line text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">{update.body}</p>
                      {update.link && (
                        <a
                          href={update.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-[length:calc(14px_*_var(--fs,1))] font-medium text-lavender hover:underline"
                        >
                          {update.link.label}
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {state === 'ready' && nextBefore !== null && (
          <button type="button" onClick={showEarlier} disabled={loadingMore} className="chip mt-3 w-full justify-center">
            {loadingMore ? 'Loading…' : 'Show earlier updates'}
          </button>
        )}
      </div>
    </Sheet>
  );
};
