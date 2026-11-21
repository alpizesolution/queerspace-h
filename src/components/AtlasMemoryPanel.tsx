import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Pencil, Trash2, Users, Lock } from 'lucide-react';
import { MemberAvatar, MemberName } from './ProfileNav.tsx';
import { AtlasPhoto } from './AtlasPhoto.tsx';
import { AtlasEngagement } from './AtlasEngagement.tsx';
import { openMemory } from '../services/atlasService.ts';
import { ANONYMOUS_NAME, AUDIENCE_TEXT, engagementOf, formatMemoryDateShort, memoryLabel, type AtlasMemory, type Engagement, type PlaceGroup } from '../utils/atlas.ts';

interface Props {
  group: PlaceGroup;
  onClose: () => void;
  onEdit: (memory: AtlasMemory) => void;
  onDelete: (memory: AtlasMemory) => void;
  photoVersions: Record<string, number>;
  busyId: string | null;
}

/** The small star used for an anonymous author, beside the name (the same glyph as the star markers, drawn small). */
const AuthorStar: React.FC = () => <span aria-hidden="true" className="atlas-dot !h-2.5 !w-2.5 shrink-0" />;

/**
 * The memory card for one star, kept compact: the photo (if any), the title and words with the date right under them, the place name
 * (only if the author gave one; the exact spot is never known), and one slim row with who wrote it on the left and how many members have
 * opened it and reacted (a hug or a heart) on the right. A star with several memories lets you step through them. The author's own memories
 * add edit and delete, and how their name shows. There is no close button: tapping outside the card (or Escape) dismisses it.
 */
export const MemoryPanel: React.FC<Props> = ({ group, onClose, onEdit, onDelete, photoVersions, busyId }) => {
  const [index, setIndex] = useState(0);
  const [engaged, setEngaged] = useState<Record<string, Engagement>>({});
  const count = group.memories.length;
  const at = Math.min(index, count - 1);
  const memory = group.memories[at];
  const memoryId = memory?.id;
  const opened = useRef(new Set<string>());

  // Opening the card is what counts a view (once per member, decided by the server) and tells the card this member's own reaction.
  useEffect(() => {
    if (!memoryId || opened.current.has(memoryId)) return undefined;
    opened.current.add(memoryId);
    let live = true;
    void openMemory(memoryId).then((result) => { if (live && result.ok) setEngaged((all) => ({ ...all, [memoryId]: result.value })); else if (!result.ok) opened.current.delete(memoryId); });
    return () => { live = false; };
  }, [memoryId]);

  // No close button: a tap or click anywhere outside the card dismisses it (touch and mouse alike), and so does Escape. A press that
  // starts inside the card, a drag that pans the map, a star (it opens that memory), the Recent strip and any dialog are not dismissals.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let timer: number | undefined;
    let down: { x: number; y: number; inside: boolean } | null = null;
    const keeps = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-testid="memory-panel"], .atlas-star, [data-atlas-keep], [role="dialog"], [role="alertdialog"], [role="status"]'));
    const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, inside: keeps(event.target) }; };
    const onClick = (event: MouseEvent) => {
      const start = down;
      down = null;
      if (keeps(event.target) || (start && (start.inside || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8))) return;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) closeRef.current(); };
    // Listening starts a tick later so the very click that opened the card is not mistaken for an outside tap.
    timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!memory) return null;
  const date = formatMemoryDateShort(memory.date);
  const busy = busyId === memory.id;
  const engagement = engaged[memory.id] ?? engagementOf(memory);
  const setEngagement = (next: Engagement) => setEngaged((all) => ({ ...all, [memory.id]: next }));
  const engagementStrip = <AtlasEngagement memoryId={memory.id} mine={memory.mine} value={engagement} onChange={setEngagement} />;

  return (
    <article aria-label={`Memory: ${memoryLabel(memory)}`} data-testid="memory-panel" className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur-xl desk:rounded-3xl">
      <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-line-strong desk:hidden" />
      {count > 1 && (
        <header className="flex shrink-0 items-center px-3 pb-0.5 pt-3.5 desk:pt-2.5">
          <div className="flex items-center text-[length:calc(12px_*_var(--fs,1))] text-muted" role="group" aria-label="Memories at this star">
            <button type="button" onClick={() => setIndex((at + count - 1) % count)} aria-label="Previous memory" className="icon-btn h-8 w-8"><ChevronLeft className="h-4 w-4" /></button>
            <span aria-live="polite" className="tabular-nums">{at + 1}/{count}</span>
            <button type="button" onClick={() => setIndex((at + 1) % count)} aria-label="Next memory" className="icon-btn h-8 w-8"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </header>
      )}

      <div className={`min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-3 ${count > 1 ? '' : 'pt-5 desk:pt-3.5'}`}>
        {memory.hasPhoto && <AtlasPhoto memoryId={memory.id} alt={`Photo for ${memoryLabel(memory)}`} version={photoVersions[memory.id] ?? 0} />}
        <div>
          {memory.title && <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight text-fg [overflow-wrap:anywhere]">{memory.title}</h2>}
          {memory.placeLabel && (
            <p data-testid="memory-place" className="mt-0.5 flex items-center gap-1 text-[length:calc(12px_*_var(--fs,1))] text-muted"><MapPin className="h-3 w-3 shrink-0 text-lavender" aria-hidden="true" /><span className="min-w-0 truncate">{memory.placeLabel}</span></p>
          )}
        </div>
        {memory.text && <p data-testid="memory-text" className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${memory.title ? 'text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-fg/90' : 'font-serif text-[length:calc(16px_*_var(--fs,1))] leading-relaxed text-fg'}`}>{memory.text}</p>}
        {date && <time dateTime={memory.date ?? undefined} data-testid="memory-date" className="block text-[length:calc(11.5px_*_var(--fs,1))] tabular-nums text-muted">{date}</time>}

        {memory.mine ? (
          <div className="space-y-2 pt-0.5">
            {memory.visibility !== 'public' && (
              <p data-testid="memory-audience" className="inline-flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-muted">{memory.visibility === 'friends' ? <Users className="h-3 w-3 text-lavender" aria-hidden="true" /> : <Lock className="h-3 w-3 text-lavender" aria-hidden="true" />}{AUDIENCE_TEXT[memory.visibility]}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              {memory.identity && (
                <p data-testid="memory-identity" title={memory.identity.mode === 'anonymous' ? 'Your account stays private' : undefined} className="flex min-w-0 items-center gap-1.5 text-[length:calc(12.5px_*_var(--fs,1))] text-subtle">
                  <AuthorStar />
                  <span className="min-w-0 truncate">Shown as <span className="font-semibold text-fg">{memory.identity.mode === 'anonymous' ? memory.displayName || ANONYMOUS_NAME : 'your pseudonym'}</span></span>
                </p>
              )}
              {engagementStrip}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onEdit(memory)} disabled={busy} className="btn btn-secondary btn-sm flex-1"><Pencil className="h-4 w-4" aria-hidden="true" /> Edit</button>
              <button type="button" onClick={() => onDelete(memory)} disabled={busy} className="btn btn-ghost btn-sm flex-1 text-danger"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete</button>
            </div>
          </div>
        ) : (
          <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-1.5 text-[length:calc(12.5px_*_var(--fs,1))]">
              {memory.author ? (
                <>
                  <MemberAvatar memberId={memory.author.id} avatar={memory.author.avatar} seed={memory.author.id} name={memory.author.displayName ?? undefined} className="h-5 w-5" />
                  <span className="min-w-0 truncate font-semibold text-fg"><MemberName memberId={memory.author.id} name={memory.author.displayName ?? 'A QUEERSPACE member'} /></span>
                  {memory.author.pronouns && <span className="min-w-0 truncate text-subtle">{memory.author.pronouns}</span>}
                </>
              ) : (
                <>
                  {/* Anonymous: a small star, the plain word (never a link), and nothing that points at the account. */}
                  <AuthorStar />
                  <span data-testid="memory-author-name" className="min-w-0 truncate font-semibold text-fg">{memory.displayName || ANONYMOUS_NAME}</span>
                </>
              )}
              {memory.visibility === 'friends' && <Users className="h-3 w-3 shrink-0 text-subtle" aria-label="Connections only" role="img" />}
            </div>
            {engagementStrip}
          </footer>
        )}
      </div>
    </article>
  );
};
