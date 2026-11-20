import React, { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Globe2, Lock, MapPin, Pencil, Trash2, Users, X } from 'lucide-react';
import { MemberAvatar, MemberName } from './ProfileNav.tsx';
import { AtlasPhoto } from './AtlasPhoto.tsx';
import { ANONYMOUS_NAME, AUDIENCE_TEXT, formatMemoryDate, type AtlasMemory, type MemoryVisibility, type PlaceGroup } from '../utils/atlas.ts';

const VisibilityIcon: React.FC<{ visibility: MemoryVisibility; className?: string }> = ({ visibility, className = 'h-3.5 w-3.5' }) =>
  visibility === 'private' ? <Lock className={className} aria-hidden="true" /> : visibility === 'friends' ? <Users className={className} aria-hidden="true" /> : <Globe2 className={className} aria-hidden="true" />;

interface Props {
  group: PlaceGroup;
  onClose: () => void;
  onEdit: (memory: AtlasMemory) => void;
  onDelete: (memory: AtlasMemory) => void;
  photoVersions: Record<string, number>;
  busyId: string | null;
}

/**
 * The memory card for one star: photo, title, words, date, the approximate place and (unless the author chose to stay anonymous) who
 * wrote it. A star with several memories lets you step through them. The author's own memories add edit, delete and how the name shows.
 */
export const MemoryPanel: React.FC<Props> = ({ group, onClose, onEdit, onDelete, photoVersions, busyId }) => {
  const [index, setIndex] = useState(0);
  const count = group.memories.length;
  const at = Math.min(index, count - 1);
  const memory = group.memories[at];
  if (!memory) return null;
  const date = formatMemoryDate(memory.date);
  const busy = busyId === memory.id;

  return (
    <article aria-label={`Memory: ${memory.title}`} data-testid="memory-panel" className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur-xl desk:rounded-3xl">
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line-strong desk:hidden" />
        {count > 1 && (
          <div className="flex items-center gap-1 text-[length:calc(12.5px_*_var(--fs,1))] text-muted" role="group" aria-label="Memories at this star">
            <button type="button" onClick={() => setIndex((at + count - 1) % count)} aria-label="Previous memory" className="icon-btn h-9 w-9"><ChevronLeft className="h-4 w-4" /></button>
            <span aria-live="polite">{at + 1} of {count} here</span>
            <button type="button" onClick={() => setIndex((at + 1) % count)} aria-label="Next memory" className="icon-btn h-9 w-9"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label="Close memory" className="icon-btn ml-auto h-9 w-9"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4">
        {memory.hasPhoto && <AtlasPhoto memoryId={memory.id} alt={`Photo for ${memory.title}`} version={photoVersions[memory.id] ?? 0} />}
        <div>
          <h2 className="font-serif text-xl font-semibold leading-snug tracking-tight text-fg [overflow-wrap:anywhere]">{memory.title}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:calc(12.5px_*_var(--fs,1))] text-muted">
            {date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-lavender" aria-hidden="true" />{date}</span>}
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-lavender" aria-hidden="true" />{memory.placeLabel || 'Approximate area'}<span className="text-subtle">· approximate</span></span>
          </p>
        </div>
        {memory.text && <p className="whitespace-pre-wrap text-[length:calc(14.5px_*_var(--fs,1))] leading-relaxed text-fg/90 [overflow-wrap:anywhere]">{memory.text}</p>}

        {memory.mine ? (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="space-y-1">
              <p data-testid="memory-audience" className="inline-flex items-center gap-1.5 text-[length:calc(12.5px_*_var(--fs,1))] text-muted"><VisibilityIcon visibility={memory.visibility} className="h-3.5 w-3.5 text-lavender" />{AUDIENCE_TEXT[memory.visibility]}</p>
              {memory.identity && (
                <p data-testid="memory-identity" className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                  Shown as <span className="font-semibold text-fg">{memory.identity.mode === 'anonymous' ? memory.displayName || ANONYMOUS_NAME : 'your pseudonym'}</span>
                  {memory.identity.mode === 'anonymous' ? ' (anonymous). Your account stays private.' : ''}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onEdit(memory)} disabled={busy} className="btn btn-secondary btn-sm flex-1"><Pencil className="h-4 w-4" aria-hidden="true" /> Edit</button>
              <button type="button" onClick={() => onDelete(memory)} disabled={busy} className="btn btn-ghost btn-sm flex-1 text-danger"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete</button>
            </div>
          </div>
        ) : (
          <footer className="flex items-center gap-3 border-t border-line pt-3">
            {memory.author ? (
              <>
                <MemberAvatar memberId={memory.author.id} avatar={memory.author.avatar} seed={memory.author.id} name={memory.author.displayName ?? undefined} className="h-9 w-9" />
                <div className="min-w-0 text-[length:calc(13px_*_var(--fs,1))]">
                  <p className="truncate font-semibold text-fg"><MemberName memberId={memory.author.id} name={memory.author.displayName ?? 'A QUEERSPACE member'} /></p>
                  {memory.author.pronouns && <p className="truncate text-subtle">{memory.author.pronouns}</p>}
                </div>
              </>
            ) : (
              <>
                {/* Anonymous: a star instead of an avatar, the plain word (never a link), and nothing that points at the account. */}
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lavender/30 bg-lavender/10"><span className="atlas-dot !h-4 !w-4" /></span>
                <p data-testid="memory-author-name" className="min-w-0 truncate text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg">{memory.displayName || ANONYMOUS_NAME}</p>
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-[length:calc(11.5px_*_var(--fs,1))] text-subtle"><VisibilityIcon visibility={memory.visibility} />{memory.visibility === 'friends' ? 'Connections' : 'Shared'}</span>
          </footer>
        )}
      </div>
    </article>
  );
};
