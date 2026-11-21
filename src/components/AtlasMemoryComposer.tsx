import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, ImagePlus, LoaderCircle, Trash2, UserRound, VenetianMask, X } from 'lucide-react';
import { isValidPick, type PickedPlace } from '../utils/atlasPick.ts';
import { createMemory, encodePhoto, forgetMemoryPhoto, updateMemory, type MemoryDraft } from '../services/atlasService.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';
import { atlasProblemText, formatMemoryDateShort, TEXT_MAX, TITLE_MAX, todayInputValue, type AtlasMemory, type IdentityMode } from '../utils/atlas.ts';
import { SUPPORT_IMAGE_TYPES } from '../services/supportImageService.ts';

interface Props {
  /** Present when editing one of the member's own memories. */
  editing?: AtlasMemory | null;
  /** The member's own QUEERSPACE name, shown in the choice so they can see what "my pseudonym" means. */
  memberName?: string;
  /** The chosen spot, owned by the page because it is the pin on the main ATLAS map (null until one is chosen). Never typed or labelled here. */
  place: PickedPlace | null;
  onClose: () => void;
  onSaved: (memory: AtlasMemory, photoChanged: boolean) => void;
}

/**
 * Pin a memory (or edit one): a title, the story with the photo and date tucked into its corner, and how the author is shown (My pseudonym or Anonymous). The place is NOT chosen here: it is tapped on the
 * main ATLAS map, which stays visible beside (desktop) or above (phone) this panel and keeps its zoom and position. This is a panel on
 * the page, not a dialog over the map, so the map can be zoomed, panned and tapped while the form is open.
 */
export const MemoryComposer: React.FC<Props> = ({ editing = null, memberName, place, onClose, onSaved }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [text, setText] = useState(editing?.text ?? '');
  const [date, setDate] = useState(editing?.date ?? todayInputValue());
  // How the author appears: their own pseudonym unless they choose Anonymous. Every memory is public to members, so there is no audience choice.
  const [identityMode, setIdentityMode] = useState<IdentityMode>(editing?.identity?.mode ?? 'profile');
  // A memory that is already anonymous keeps the cosmic name it has when saved; only a switch TO anonymous (or a new memory) gets a fresh one.
  const keepsCosmicName = identityMode === 'anonymous' && editing?.identity?.mode === 'anonymous' && Boolean(editing.displayName);
  const [photo, setPhoto] = useState<{ encoded: string; preview: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const memoryId = useRef<string>(editing?.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(36).slice(2, 10)}`));
  const today = useMemo(() => todayInputValue(), []);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);
  const located = isValidPick(place);

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!SUPPORT_IMAGE_TYPES.includes(file.type)) { setProblem(atlasProblemText('type')); return; }
    setPhotoBusy(true);
    const encoded = await encodePhoto(file);
    setPhotoBusy(false);
    if (!encoded) { setProblem(atlasProblemText('too-large')); return; }
    setPhoto({ encoded, preview: URL.createObjectURL(file) });
    setRemovePhoto(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) { setProblem('Give your memory a title.'); return; }
    if (!date || date > today) { setProblem('Choose the date of the memory (not in the future).'); return; }
    if (!isValidPick(place)) { setProblem('Choose where it happened by tapping the map.'); return; }
    // Every memory is read by other members, so the community rules apply to all of them.
    const flagged = [cleanTitle, text.trim()].some((value) => value && sanitizeMessageText(value).isBlocked);
    if (flagged) { setProblem(atlasProblemText('content')); return; }
    setSaving(true);
    setProblem(null);
    const draft: MemoryDraft = { title: cleanTitle, text: text.trim(), date, lat: place.lat, lng: place.lng, displayIdentity: { mode: identityMode } };
    const result = editing
      ? await updateMemory(editing.id, { ...draft, ...(photo ? { photo: photo.encoded } : {}), ...(removePhoto && !photo ? { removePhoto: true } : {}) })
      : await createMemory(draft, photo?.encoded ?? null, memoryId.current);
    setSaving(false);
    if (!result.ok) { setProblem(atlasProblemText(result.reason)); return; }
    const photoChanged = Boolean(photo) || removePhoto;
    if (editing && photoChanged) forgetMemoryPhoto(editing.id);
    onSaved(result.value, photoChanged);
  };

  const showsPhoto = photo ? photo.preview : null;
  const keepsOld = Boolean(editing?.hasPhoto) && !removePhoto && !photo;
  const hasPicture = Boolean(showsPhoto || keepsOld);
  const dateText = formatMemoryDateShort(date) || 'Date';
  // The shown-as line appears only when there is a name to show: the member's own pseudonym, or the cosmic name an anonymous memory already has.
  const shownAs = identityMode === 'profile' ? (memberName || 'your pseudonym') : keepsCosmicName ? editing?.displayName : null;
  const cornerBtn = 'flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60';

  return (
    <section aria-label={editing ? 'Edit memory' : 'Pin a memory'} data-testid="pin-panel" className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur-xl desk:rounded-3xl">
      <header className="flex shrink-0 items-center gap-1 px-4 pt-2.5">
        <h2 className="min-w-0 flex-1 truncate font-serif text-lg font-semibold tracking-tight text-fg">{editing ? 'Edit memory' : 'Pin a memory'}</h2>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? 'Show the form' : 'Hide the form to see the map'} data-testid="pin-collapse" className="icon-btn h-9 w-9 desk:hidden">
          {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={onClose} aria-label="Cancel" data-testid="pin-cancel" className="icon-btn h-9 w-9"><X className="h-4 w-4" aria-hidden="true" /></button>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 ${collapsed ? 'hidden' : ''}`}>
      <form id="atlas-memory-form" onSubmit={submit} className="space-y-2.5" noValidate>
        <div>
          <label htmlFor="atlas-title" className="sr-only">Title</label>
          <input id="atlas-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} placeholder="Title" className="h-10 w-full border-0 border-b border-line bg-transparent px-0.5 font-serif text-lg font-semibold text-fg placeholder:font-normal placeholder:text-subtle focus:border-lavender/60 focus:outline-none" />
        </div>

        <div className="rounded-2xl border border-line bg-ink/60 transition-colors focus-within:border-lavender/50">
          <label htmlFor="atlas-text" className="sr-only">Story</label>
          <textarea id="atlas-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX} rows={3} placeholder="What made this place matter?" className="block min-h-[4.5rem] desk:min-h-[7.5rem] w-full resize-none rounded-t-2xl bg-transparent px-3.5 pb-1 pt-2.5 text-base leading-relaxed text-fg placeholder:text-subtle focus:outline-none sm:text-sm" />
          {hasPicture && (
            <div className="flex items-center gap-2.5 px-3 pb-1">
              {showsPhoto && <img src={showsPhoto} alt="Chosen picture preview" className="h-12 w-12 rounded-lg border border-line object-cover" />}
              {keepsOld && <p className="text-[length:calc(12px_*_var(--fs,1))] text-muted">This memory has a picture.</p>}
              <p className="min-w-0 flex-1 text-[length:calc(11.5px_*_var(--fs,1))] leading-snug text-subtle">Camera details such as location are removed.</p>
              <button type="button" onClick={() => { setPhoto(null); setRemovePhoto(true); }} className="icon-btn h-8 w-8 text-danger" aria-label="Remove picture"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          )}
          <div className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
            <span className="pl-1.5 text-[length:calc(11px_*_var(--fs,1))] tabular-nums text-subtle/80" aria-label={`${text.length} of ${TEXT_MAX} characters`}>{text.length}/{TEXT_MAX}</span>
            <span className="ml-auto" />
            <input ref={fileRef} type="file" accept={SUPPORT_IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-label="Choose a picture" onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} aria-label={hasPicture ? 'Replace picture' : 'Add a picture'} title={hasPicture ? 'Replace picture' : 'Add a picture'} className={cornerBtn}>
              {photoBusy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className={`h-4 w-4 ${hasPicture ? 'text-lavender' : ''}`} aria-hidden="true" />}
            </button>
            {/* The date is the existing native date field, laid invisibly over the pill, so a tap opens the platform's own date picker. */}
            <div className={`relative px-2.5 focus-within:ring-2 focus-within:ring-lavender/60 ${cornerBtn}`}>
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              <span className="text-[length:calc(12.5px_*_var(--fs,1))] font-medium tabular-nums text-fg/90" data-testid="atlas-date-text">{dateText}</span>
              <input
                id="atlas-date" type="date" value={date} max={today} aria-label="Date of the memory"
                onChange={(e) => setDate(e.target.value)}
                onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* the browser opens it by itself */ } }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <fieldset data-testid="atlas-identity" className="min-w-0">
          <div className="flex items-center gap-2.5">
            <legend className="float-left text-[length:calc(12.5px_*_var(--fs,1))] font-semibold text-muted">Post as</legend>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-0.5 rounded-full border border-line bg-ink/60 p-0.5" role="radiogroup" aria-label="Post as">
              {([
                ['profile', UserRound, 'My pseudonym'],
                ['anonymous', VenetianMask, 'Anonymous'],
              ] as const).map(([mode, Icon, label]) => (
                <button key={mode} type="button" role="radio" aria-checked={identityMode === mode} onClick={() => setIdentityMode(mode)} data-testid={`identity-${mode}`} className={`flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-[length:calc(12.5px_*_var(--fs,1))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60 ${identityMode === mode ? 'bg-raised text-fg ring-1 ring-lavender/50' : 'text-muted hover:text-fg'}`}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${identityMode === mode ? 'text-lavender' : ''}`} aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
          {shownAs && <p className="mt-1.5 truncate pl-1 text-[length:calc(12px_*_var(--fs,1))] text-muted" data-testid="atlas-identity-preview" aria-live="polite">Shown as <strong className="font-semibold text-fg">{shownAs}</strong></p>}
          <p data-testid="atlas-public-note" className="mt-1.5 pl-1 text-[length:calc(11.5px_*_var(--fs,1))] leading-snug text-subtle">Your account stays private either way.</p>
        </fieldset>
      </form>
      </div>
      <footer className="shrink-0 px-4 pb-3 pt-1">
        {problem && <p role="alert" className="pb-2 text-[length:calc(12.5px_*_var(--fs,1))] text-danger">{problem}</p>}
        {!located && !problem && <p data-testid="pin-needs-location" className="pb-2 text-[length:calc(12.5px_*_var(--fs,1))] text-muted">Tap the map to choose a spot to continue.</p>}
        <button type="submit" form="atlas-memory-form" disabled={saving || photoBusy || !located} className="btn btn-primary w-full">
          {saving ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : editing ? 'Save changes' : 'Pin this memory'}
        </button>
      </footer>
    </section>
  );
};

export default MemoryComposer;
