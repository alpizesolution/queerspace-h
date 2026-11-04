import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, Search, X } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { fetchGifs } from '../services/gifService.ts';
import { cleanGifQuery, gifProblemText, type GifInfo, type GifProblem } from '../utils/gif.ts';

/** True when the member asks their device for less motion. GIFs then show a still frame until tapped. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** A small "GIF" mark for the composer button, drawn here so the button stays a compact icon. */
export const GifIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
    <path d="M10.2 10.2a2 2 0 1 0 0 3.6V12.4h-1.3" />
    <path d="M12.9 9.6v4.8" />
    <path d="M18 9.6h-2.4v4.8M15.6 12h1.8" />
  </svg>
);

const BUBBLE_MAX_WIDTH = 260;
const BUBBLE_MAX_HEIGHT = 320;
/** The width a GIF is shown at: its own size, but never wider than the bubble or so wide that it would be taller than the limit. */
export const bubbleWidth = (gif: Pick<GifInfo, 'width' | 'height'>): number =>
  Math.round(Math.min(gif.width, BUBBLE_MAX_WIDTH, (BUBBLE_MAX_HEIGHT * gif.width) / gif.height));

/**
 * A GIF inside a message. Its box is sized from the GIF's own dimensions before it loads, so the thread does not jump,
 * and it never grows past the bubble or a sensible height. With reduced motion it shows a still frame; a tap plays it.
 */
export const GifBubble: React.FC<{ gif: GifInfo; mine: boolean }> = ({ gif }) => {
  const reduced = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const still = reduced && !playing && gif.stillUrl;
  const alt = gif.title ? `GIF: ${gif.title}` : 'GIF';
  if (failed) {
    return <p className="flex min-h-9 items-center text-[length:calc(14px_*_var(--fs,1))] italic opacity-70">GIF unavailable</p>;
  }
  const box = (
    <span className="block overflow-hidden rounded-xl bg-ink/30" style={{ width: bubbleWidth(gif), maxWidth: '100%', aspectRatio: `${gif.width} / ${gif.height}` }}>
      <img
        src={still ? (gif.stillUrl as string) : gif.url}
        alt={alt}
        width={gif.width}
        height={gif.height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
  return (
    <span className="flex flex-col gap-0.5">
      {reduced && gif.stillUrl ? (
        <button type="button" onClick={(event) => { event.stopPropagation(); setPlaying((value) => !value); }} aria-label={playing ? 'Pause GIF' : 'Play GIF'} className="block rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-lavender/70">
          {box}
        </button>
      ) : box}
      <span className="select-none text-[length:calc(9px_*_var(--fs,1))] uppercase tracking-wider opacity-60">GIF · via GIPHY</span>
    </span>
  );
};

type Props = {
  /** The member picked this GIF and confirmed. Called once per opening. */
  onSend: (gif: GifInfo) => void;
  onClose: () => void;
};

const PAGE = 18;
const SEARCH_DELAY_MS = 350;

/**
 * The GIF picker: trending to begin with, a search box, a grid, and a preview before anything is sent. It talks only to
 * this app's server, which holds the GIPHY key.
 */
export const GifPicker: React.FC<Props> = ({ onSend, onClose }) => {
  const reduced = usePrefersReducedMotion();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifInfo[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<GifProblem | null>(null);
  const [selected, setSelected] = useState<GifInfo | null>(null);
  /** Set the instant a send is chosen, so a quick second tap cannot send it twice. */
  const sent = useRef(false);
  const run = useRef(0);

  // What is shown follows the last search typed. A search the member has typed past is cancelled and ignored.
  useEffect(() => {
    const controller = new AbortController();
    const mine = ++run.current;
    setLoading(true);
    setProblem(null);
    setGifs([]);
    setNext(null);
    fetchGifs({ query, limit: PAGE, signal: controller.signal })
      .then((result) => {
        if (mine !== run.current) return;
        if (result.ok) { setGifs(result.page.gifs); setNext(result.page.nextOffset); } else setProblem(result.problem);
        setLoading(false);
      })
      .catch(() => { /* cancelled: a newer search owns the screen */ });
    return () => controller.abort();
  }, [query]);

  // Search as the member types, after a short pause.
  useEffect(() => {
    const clean = cleanGifQuery(text);
    if (clean === query) return;
    const timer = window.setTimeout(() => setQuery(clean), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, query]);

  const retry = useCallback(() => {
    setProblem(null);
    setLoading(true);
    const mine = ++run.current;
    fetchGifs({ query, limit: PAGE }).then((result) => {
      if (mine !== run.current) return;
      if (result.ok) { setGifs(result.page.gifs); setNext(result.page.nextOffset); } else setProblem(result.problem);
      setLoading(false);
    }).catch(() => undefined);
  }, [query]);

  const loadMore = async () => {
    if (next === null || loadingMore) return;
    const mine = run.current;
    setLoadingMore(true);
    const result = await fetchGifs({ query, offset: next, limit: PAGE }).catch(() => null);
    if (mine !== run.current) return;
    setLoadingMore(false);
    if (result?.ok) {
      setGifs((current) => {
        const seen = new Set(current.map((gif) => gif.id));
        return [...current, ...result.page.gifs.filter((gif) => !seen.has(gif.id))];
      });
      setNext(result.page.nextOffset);
    } else if (result) setProblem(result.problem);
  };

  const confirm = () => {
    if (!selected || sent.current) return;
    sent.current = true;
    onSend(selected);
  };

  const attribution = <p className="text-center text-[length:calc(11px_*_var(--fs,1))] text-subtle">Powered by GIPHY</p>;

  if (selected) {
    return (
      <Sheet
        title="Send this GIF?"
        size="md"
        onClose={onClose}
        footer={
          <div className="space-y-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(null)} className="btn btn-secondary flex-1"><ArrowLeft className="h-4 w-4" /> Back</button>
              <button type="button" onClick={confirm} className="btn btn-primary flex-1">Send GIF</button>
            </div>
            {attribution}
          </div>
        }
      >
        <div className="flex max-h-[50dvh] items-center justify-center overflow-hidden rounded-2xl border border-line bg-ink">
          <img
            src={reduced && selected.stillUrl ? selected.stillUrl : selected.url}
            alt={selected.title ? `GIF preview: ${selected.title}` : 'GIF preview'}
            referrerPolicy="no-referrer"
            draggable={false}
            className="max-h-[50dvh] w-auto max-w-full object-contain"
          />
        </div>
        {selected.title && <p className="mt-2 truncate text-center text-xs text-subtle">{selected.title}</p>}
      </Sheet>
    );
  }

  return (
    <Sheet title="Choose a GIF" size="md" onClose={onClose} footer={attribution}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <label htmlFor="gif-search" className="sr-only">Search GIFs</label>
          <input
            id="gif-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 50))}
            placeholder="Search GIFs"
            maxLength={50}
            autoComplete="off"
            enterKeyHint="search"
            className="h-10 w-full rounded-2xl border border-line bg-raised pl-9 pr-9 text-[length:calc(15px_*_var(--fs,1))] text-fg outline-none placeholder:text-subtle focus:border-berry/60"
          />
          {text && (
            <button type="button" onClick={() => { setText(''); setQuery(''); }} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-fg"><X className="h-4 w-4" /></button>
          )}
        </div>
        <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">{query ? `Results for “${query}”` : 'Trending now'}</p>

        <div className="min-h-[40dvh]" aria-busy={loading}>
          {loading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status" aria-label="Loading GIFs">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className={`rounded-xl bg-raised ${reduced ? '' : 'animate-pulse'}`} style={{ aspectRatio: i % 3 === 1 ? '4 / 5' : '1 / 1' }} />)}
            </div>
          ) : problem ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="text-sm text-fg">{gifProblemText(problem)}</p>
              {problem !== 'unavailable' && <button type="button" onClick={retry} className="btn btn-secondary btn-sm">Try again</button>}
            </div>
          ) : gifs.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <p className="text-sm font-medium text-fg">No GIFs found</p>
              <p className="text-xs text-muted">Try a different word, or clear the search to see what is trending.</p>
            </div>
          ) : (
            <>
              <ul className="columns-2 gap-2 sm:columns-3 [&>li]:mb-2" aria-label="GIFs">
                {gifs.map((gif) => (
                  <li key={gif.id} className="break-inside-avoid">
                    <button
                      type="button"
                      onClick={() => setSelected(gif)}
                      aria-label={gif.title ? `Preview GIF: ${gif.title}` : 'Preview GIF'}
                      className="block w-full overflow-hidden rounded-xl bg-raised outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-berry/70"
                      style={{ aspectRatio: `${gif.previewWidth} / ${gif.previewHeight}` }}
                    >
                      <img src={reduced && gif.stillUrl ? gif.stillUrl : gif.previewUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
              {next !== null && (
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn btn-secondary btn-sm mx-auto mt-1 flex">
                  {loadingMore ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…</> : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
};
