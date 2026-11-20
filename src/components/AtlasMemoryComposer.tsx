import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Globe2, ImagePlus, LoaderCircle, MapPinned, Trash2, UserRound, VenetianMask, X } from 'lucide-react';
import { isValidPick, type PickedPlace } from '../utils/atlasPick.ts';
import { createMemory, encodePhoto, forgetMemoryPhoto, updateMemory, type MemoryDraft } from '../services/atlasService.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';
import { ANONYMOUS_NAME, atlasProblemText, TEXT_MAX, TITLE_MAX, todayInputValue, type AtlasMemory, type IdentityMode } from '../utils/atlas.ts';
import { SUPPORT_IMAGE_TYPES } from '../services/supportImageService.ts';

const fieldClass = 'w-full rounded-xl border border-line bg-ink px-4 text-base sm:text-sm text-fg placeholder:text-subtle focus:border-berry focus:outline-none';

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
 * Pin a memory (or edit one): words, date, an optional picture and who can see it. The place is NOT chosen here: it is tapped on the
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

  return (
    <section aria-label={editing ? 'Edit memory' : 'Pin a memory'} data-testid="pin-panel" className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur-xl desk:rounded-3xl">
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavender/15 text-lavender"><MapPinned className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">{editing ? 'Edit memory' : 'Pin a memory'}</h2>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? 'Show the form' : 'Hide the form to see the map'} data-testid="pin-collapse" className="icon-btn h-9 w-9 desk:hidden">
          {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={onClose} aria-label="Cancel" data-testid="pin-cancel" className="icon-btn h-9 w-9"><X className="h-4 w-4" aria-hidden="true" /></button>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 ${collapsed ? 'hidden' : ''}`}>
      <form id="atlas-memory-form" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="atlas-title" className="mb-1.5 block text-sm font-semibold text-fg">Title</label>
          <input id="atlas-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} placeholder="Our first sunrise" className={`${fieldClass} h-11`} />
        </div>
        <div>
          <label htmlFor="atlas-text" className="mb-1.5 block text-sm font-semibold text-fg">Story <span className="font-normal text-subtle">(optional)</span></label>
          <textarea id="atlas-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX} rows={4} placeholder="What made this place matter?" className={`${fieldClass} resize-none py-3`} />
          <p className="mt-1 text-right text-[length:calc(11.5px_*_var(--fs,1))] text-subtle">{text.length}/{TEXT_MAX}</p>
        </div>
        <div>
          <label htmlFor="atlas-date" className="mb-1.5 block text-sm font-semibold text-fg">Date of the memory</label>
          <input id="atlas-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} h-11`} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-fg">Picture <span className="font-normal text-subtle">(optional)</span></p>
          <input ref={fileRef} type="file" accept={SUPPORT_IMAGE_TYPES.join(',')} className="sr-only" aria-label="Choose a picture" onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
          {showsPhoto || keepsOld ? (
            <div className="flex items-center gap-3">
              {showsPhoto && <img src={showsPhoto} alt="Chosen picture preview" className="h-20 w-20 rounded-xl border border-line object-cover" />}
              {keepsOld && <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted">This memory has a picture.</p>}
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-sm">Replace</button>
                <button type="button" onClick={() => { setPhoto(null); setRemovePhoto(true); }} className="btn btn-ghost btn-sm text-danger" aria-label="Remove picture"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className="btn btn-secondary w-full sm:w-auto">
              {photoBusy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />} {removePhoto ? 'Add a different picture' : 'Add a picture'}
            </button>
          )}
          <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">Camera details such as location are removed from the picture.</p>
        </div>

        <fieldset data-testid="atlas-identity">
          <legend className="mb-1 text-sm font-semibold text-fg">Who should it say wrote this?</legend>
          <div className="grid gap-2" role="radiogroup" aria-label="Who should it say wrote this?">
            {([
              ['profile', UserRound, 'Use my pseudonym', memberName ? `Shown as ${memberName}. Members can open your profile if your profile settings allow it.` : 'Your QUEERSPACE name. Members can open your profile if your profile settings allow it.'],
              ['anonymous', VenetianMask, 'Anonymous', keepsCosmicName ? `Stays ${editing?.displayName}. No name, avatar or profile link.` : 'A random cosmic name, like Nova, Moonbeam or Polaris. No name, avatar or profile link.'],
            ] as const).map(([mode, Icon, label, hint]) => (
              <button key={mode} type="button" role="radio" aria-checked={identityMode === mode} onClick={() => setIdentityMode(mode)} data-testid={`identity-${mode}`} className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${identityMode === mode ? 'border-lavender/60 bg-raised' : 'border-line hover:bg-raised/60'}`}>
                <Icon className="h-4 w-4 shrink-0 text-lavender" aria-hidden="true" />
                <span className="min-w-0"><span className="block text-sm font-semibold text-fg">{label}</span><span className="block text-[length:calc(11.5px_*_var(--fs,1))] leading-snug text-subtle">{hint}</span></span>
              </button>
            ))}
          </div>
          <p className="mt-3 rounded-xl border border-line bg-ink/60 px-3 py-2 text-[length:calc(13px_*_var(--fs,1))] text-muted" data-testid="atlas-identity-preview" aria-live="polite">
            Will be shown as <strong className="text-fg">{identityMode === 'profile' ? memberName || 'your pseudonym' : keepsCosmicName ? editing?.displayName : editing ? 'a new random cosmic name' : 'a random cosmic name'}</strong>
            {identityMode === 'anonymous' && !keepsCosmicName && <span className="text-subtle"> (picked when you {editing ? 'save' : 'publish'})</span>}
          </p>
          <p data-testid="atlas-public-note" className="mt-2 flex items-start gap-2 text-[length:calc(12px_*_var(--fs,1))] leading-snug text-subtle"><Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lavender" aria-hidden="true" />Every memory on ATLAS is visible to all QUEERSPACE members. Your account stays private either way.</p>
        </fieldset>
      </form>
      </div>
      <footer className="shrink-0 border-t border-line px-4 pb-3 pt-3">
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
