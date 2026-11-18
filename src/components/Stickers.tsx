import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, Heart, Sticker as StickerGlyph } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import {
  STICKER_PACKS,
  favoriteStickerIds,
  getFavoriteStickers,
  getRecentStickers,
  stickerById,
  stickerUrl,
  stickersInPack,
  toggleFavoriteSticker,
  type Sticker,
} from '../utils/stickers.ts';

/** The composer button's icon. */
export const StickersIcon: React.FC<{ className?: string }> = ({ className }) => <StickerGlyph className={className} aria-hidden="true" />;

const SIZE = { message: 'h-28 w-28 sm:h-32 sm:w-32', grid: 'h-full w-full', preview: 'h-48 w-48 sm:h-56 sm:w-56' } as const;

/**
 * One sticker picture. It shows a quiet placeholder until the image has loaded (the images are lazy) and a small
 * fallback if the file cannot be loaded, so a missing file never leaves a broken-image icon in the conversation.
 */
export const StickerImage: React.FC<{ sticker: Sticker; size: keyof typeof SIZE; eager?: boolean }> = ({ sticker, size, eager }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${SIZE[size]}`}>
      {!loaded && !failed && <span aria-hidden="true" className="absolute inset-1 animate-pulse rounded-2xl bg-raised motion-reduce:animate-none" />}
      {failed ? (
        <span className="px-2 text-center text-[length:calc(12px_*_var(--fs,1))] italic text-subtle">Sticker unavailable</span>
      ) : (
        <img
          src={stickerUrl(sticker)}
          alt={`Sticker: ${sticker.label}`}
          width={512}
          height={512}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full select-none object-contain transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
};

/** A sticker inside a message: standing alone on the conversation background, with transparency kept and no coloured bubble. */
export const StickerBubble: React.FC<{ id: string }> = ({ id }) => {
  const sticker = stickerById(id);
  if (!sticker) return <p className="flex min-h-9 items-center text-[length:calc(14px_*_var(--fs,1))] italic opacity-70">Sticker unavailable</p>;
  return <StickerImage sticker={sticker} size="message" />;
};

type TabId = 'recent' | 'favorites' | string;

/**
 * Choose a sticker: Recent, Favorites and the approved packs. Tapping a sticker previews it; sending is a second tap, like the GIF picker.
 * Recent and favourite stickers are remembered on this device only.
 */
export const StickerPicker: React.FC<{ onSend: (sticker: Sticker) => void; onClose: () => void }> = ({ onSend, onClose }) => {
  const [recent] = useState(() => getRecentStickers());
  const [favorites, setFavorites] = useState(() => favoriteStickerIds());
  const [tab, setTab] = useState<TabId>(() => (recent.length ? 'recent' : STICKER_PACKS[0].id));
  const [selected, setSelected] = useState<Sticker | null>(null);
  const [ready, setReady] = useState(false);

  // The grid draws on the next frame so the sheet opens at once, with a loading state, instead of waiting for 20 images.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const list = useMemo<Sticker[]>(() => {
    if (tab === 'recent') return recent;
    if (tab === 'favorites') return favorites.map((id) => stickerById(id)).filter((s): s is Sticker => Boolean(s));
    return stickersInPack(tab);
  }, [tab, recent, favorites]);

  const tabs: { id: TabId; label: string; icon?: React.ReactNode }[] = [
    { id: 'recent', label: 'Recent', icon: <Clock className="h-3.5 w-3.5" aria-hidden="true" /> },
    { id: 'favorites', label: 'Favorites', icon: <Heart className="h-3.5 w-3.5" aria-hidden="true" /> },
    ...STICKER_PACKS.map((p) => ({ id: p.id, label: p.name })),
  ];

  if (selected) {
    const isFavorite = favorites.includes(selected.id);
    return (
      <Sheet
        title="Send this sticker?"
        size="md"
        onClose={onClose}
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(null)} className="btn btn-secondary flex-1"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="button" onClick={() => onSend(selected)} className="btn btn-primary flex-1">Send sticker</button>
          </div>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2">
          <StickerImage sticker={selected} size="preview" eager />
          <button
            type="button"
            aria-pressed={isFavorite}
            onClick={() => setFavorites(toggleFavoriteSticker(selected.id))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[length:calc(13px_*_var(--fs,1))] font-medium text-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"
          >
            <Heart className={`h-4 w-4 ${isFavorite ? 'fill-berry text-berry' : ''}`} aria-hidden="true" /> {isFavorite ? 'In your favorites' : 'Add to favorites'}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Stickers" size="md" onClose={onClose}>
      <div className="space-y-3">
        <div role="tablist" aria-label="Sticker collections" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[length:calc(12.5px_*_var(--fs,1))] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 active:scale-[0.97] ${
                tab === t.id ? 'border-berry/60 bg-berry/15 text-fg' : 'border-line bg-surface text-muted hover:text-fg'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[40dvh]" aria-busy={!ready}>
          {!ready ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="status" aria-label="Loading stickers">
              {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-square animate-pulse rounded-2xl bg-raised motion-reduce:animate-none" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <p className="text-sm font-medium text-fg">{tab === 'favorites' ? 'No favorites yet' : 'Nothing here yet'}</p>
              <p className="text-xs text-muted">{tab === 'favorites' ? 'Open a sticker and tap “Add to favorites” to keep it close.' : 'Stickers you send will show up here.'}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={tab === 'recent' ? 'Recent stickers' : tab === 'favorites' ? 'Favorite stickers' : STICKER_PACKS.find((p) => p.id === tab)?.name}>
              {list.map((sticker) => (
                <li key={sticker.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(sticker)}
                    aria-label={`Preview sticker: ${sticker.label}`}
                    className="flex aspect-square w-full items-center justify-center rounded-2xl bg-raised/60 p-1 outline-none transition hover:bg-raised active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-berry/70"
                  >
                    <StickerImage sticker={sticker} size="grid" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
};
