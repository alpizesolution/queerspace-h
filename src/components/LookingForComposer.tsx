import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { PostMeta } from './LookingForBody.tsx';
import type { UserPreferences } from '../types.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';
import { PHILIPPINE_REGIONS_AND_LOCATIONS } from '../utils/philippines-locations.ts';
import {
  cleanTag,
  draftFromPost,
  EMPTY_DRAFT,
  INTENTIONS,
  INTENTION_LABELS,
  LIMITS,
  LOOKING_FOR_FLAIRS,
  NSFW_INTENTION,
  type DraftErrors,
  lookingForPostId,
  validateDraft,
  type LookingForDraft,
  type LookingForPost,
} from '../utils/lookingFor.ts';
import { ownAgeFrom, saveLookingForPost } from '../services/lookingForService.ts';

const field =
  'w-full px-4 rounded-xl bg-ink border border-line text-base sm:text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-berry';

const Label: React.FC<{ htmlFor?: string; children: React.ReactNode; hint?: string }> = ({ htmlFor, children, hint }) => (
  <div className="mb-1.5">
    <label htmlFor={htmlFor} className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg">{children}</label>
    {hint && <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">{hint}</p>}
  </div>
);

const Switch: React.FC<{ checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; id: string; disabled?: boolean }> = ({ checked, onChange, label, description, id, disabled }) => (
  <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="text-[length:calc(14px_*_var(--fs,1))] font-medium text-fg">{label}</label>
      {description && <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle leading-snug">{description}</p>}
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'border-berry bg-berry' : 'border-line bg-raised'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg transition-all ${checked ? 'left-[26px] !bg-ink' : 'left-0.5'}`} />
    </button>
  </div>
);

interface Props {
  userPrefs: UserPreferences;
  /** The member's post being edited, or null for a new one. */
  editing: LookingForPost | null;
  /** Posts already on the board, to warn when a new post would replace one of the member's own. */
  ownPostIds: string[];
  uid: string | null;
  onClose: () => void;
  onSaved: (edited: boolean) => void;
}

export const LookingForComposer: React.FC<Props> = ({ userPrefs, editing, ownPostIds, uid, onClose, onSaved }) => {
  const [draft, setDraft] = useState<LookingForDraft>(() => (editing ? draftFromPost(editing) : { ...EMPTY_DRAFT, showPhoto: Boolean(userPrefs.avatar) }));
  const [tagInput, setTagInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ownAge = ownAgeFrom(userPrefs);
  const errors = useMemo(() => validateDraft(draft, ownAge), [draft, ownAge]);
  const set = <K extends keyof LookingForDraft>(key: K, value: LookingForDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  // NSFW Connection is always mature; leaving it clears the mark it added.
  const chooseIntention = (id: (typeof INTENTIONS)[number]) => setDraft((d) => ({ ...d, intention: id, isNsfw: id === NSFW_INTENTION ? true : d.intention === NSFW_INTENTION ? false : d.isNsfw }));
  const alwaysMature = draft.intention === NSFW_INTENTION;
  const replacesOwn = !editing && uid && draft.intention && ownPostIds.includes(lookingForPostId(uid, draft.intention));

  const addTag = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const tag = cleanTag(tagInput);
    if (tag && draft.tags.length < LIMITS.tags && !draft.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) set('tags', [...draft.tags, tag]);
    setTagInput('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || saving) return;
    const cleaned: LookingForDraft = { ...draft };
    for (const key of ['title', 'intro', 'lookingFor', 'contentWarning'] as const) {
      // The content warning is optional, and the filter treats an empty text as blocked, so only real text is checked.
      if (!draft[key].trim()) {
        cleaned[key] = '';
        continue;
      }
      const result = sanitizeMessageText(draft[key].trim());
      if (result.isBlocked) {
        setProblem('Something here goes against our community guidelines, so it can’t be posted.');
        return;
      }
      cleaned[key] = result.cleanText;
    }
    // Cleaning can shorten a text, so the minimum is checked again on what will actually be saved.
    const cleanedErrors = validateDraft(cleaned, ownAge);
    if (cleanedErrors.intro || cleanedErrors.lookingFor) {
      setProblem('After cleaning, one of the sections is shorter than the minimum. Please add a little more.');
      return;
    }
    setSaving(true);
    setProblem(null);
    const result = await saveLookingForPost(userPrefs, cleaned);
    setSaving(false);
    if (result === 'ok') onSaved(Boolean(editing) || Boolean(replacesOwn));
    else if (result === 'denied') setProblem('We couldn’t post this. Make sure your profile is saved, your birthday is saved, and you wait a minute between new posts.');
    else setProblem('Couldn’t post. Check your connection and try again.');
  };

  const shown = (key: keyof DraftErrors) => (submitted ? errors[key] : undefined);
  const aboutMe = draft.intro.trim().length;
  const aboutYou = draft.lookingFor.trim().length;

  return (
    <Sheet
      title={editing ? 'Edit your post' : 'New Looking For post'}
      size="lg"
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <button type="submit" form="qs-looking-for" disabled={saving} className="btn btn-primary w-full">
          {saving ? 'Posting…' : editing ? 'Save changes' : 'Post'}
        </button>
      }
    >
      <form id="qs-looking-for" onSubmit={submit} noValidate className="space-y-5">
        <fieldset>
          <legend className="sr-only">What kind of connection</legend>
          <Label>What are you here for?</Label>
          <div role="radiogroup" aria-label="Relationship intention" className="flex flex-wrap gap-2">
            {INTENTIONS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={draft.intention === id}
                disabled={Boolean(editing) && draft.intention !== id}
                onClick={() => chooseIntention(id)}
                className={`chip ${id === NSFW_INTENTION ? (draft.intention === id ? '!bg-danger/20 !text-danger !border-danger/60' : '!text-danger/90 !border-danger/30') : draft.intention === id ? '!bg-fg !text-ink !border-fg' : ''} disabled:opacity-40`}
              >
                {INTENTION_LABELS[id]}
              </button>
            ))}
          </div>
          {shown('intention') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('intention')}</p>}
          {replacesOwn && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">You already have a post for this. Posting will update it.</p>}
        </fieldset>

        <fieldset>
          <legend className="sr-only">Who you are looking for</legend>
          <Label hint={ownAge !== null ? `You’ll post as ${ownAge}, from your profile.` : undefined}>Looking for</Label>
          <div role="radiogroup" aria-label="Looking for flair" className="flex flex-wrap gap-1.5">
            {LOOKING_FOR_FLAIRS.map((flair) => (
              <button
                key={flair}
                type="button"
                role="radio"
                aria-checked={draft.flair === flair}
                onClick={() => set('flair', flair)}
                className={`chip !px-2.5 !py-1 text-[length:calc(12px_*_var(--fs,1))] ${draft.flair === flair ? '!bg-fg !text-ink !border-fg' : ''}`}
              >
                {flair}
              </button>
            ))}
          </div>
          {shown('flair') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('flair')}</p>}
          {shown('age') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('age')}</p>}
        </fieldset>

        <div>
          <Label htmlFor="lf-title">Title</Label>
          <input id="lf-title" value={draft.title} onChange={(e) => set('title', e.target.value.slice(0, LIMITS.title))} maxLength={LIMITS.title} placeholder="Looking for kasama mag-coffee" className={`${field} h-11`} />
          {shown('title') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('title')}</p>}
          {draft.intention && (
            <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-raised/40 px-3 py-2.5">
              <PostMeta age={ownAge ?? undefined} flair={draft.flair || undefined} intention={draft.intention} />
              <p className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg leading-snug [overflow-wrap:anywhere]">{draft.title.trim() || 'Your title'}</p>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="lf-intro">About me</Label>
          <textarea id="lf-intro" value={draft.intro} onChange={(e) => set('intro', e.target.value.slice(0, LIMITS.intro))} maxLength={LIMITS.intro} rows={4} aria-describedby="lf-intro-count" placeholder="Tell us about yourself! Share your personality, hobbies, interests, lifestyle, and little things that make you who you are." className={`${field} py-2.5 resize-none`} />
          <p id="lf-intro-count" className={`mt-1 text-right text-[length:calc(12px_*_var(--fs,1))] ${aboutMe >= LIMITS.minSection ? 'text-subtle' : submitted ? 'text-danger' : 'text-subtle'}`}>{aboutMe}/{LIMITS.intro} · at least {LIMITS.minSection}</p>
          {shown('intro') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('intro')}</p>}
        </div>

        <div>
          <Label htmlFor="lf-looking">About you</Label>
          <textarea id="lf-looking" value={draft.lookingFor} onChange={(e) => set('lookingFor', e.target.value.slice(0, LIMITS.lookingFor))} maxLength={LIMITS.lookingFor} rows={4} aria-describedby="lf-looking-count" placeholder="Describe the person you’d like to meet, their personality, interests, and the kind of connection you hope to build." className={`${field} py-2.5 resize-none`} />
          <p id="lf-looking-count" className={`mt-1 text-right text-[length:calc(12px_*_var(--fs,1))] ${aboutYou >= LIMITS.minSection ? 'text-subtle' : submitted ? 'text-danger' : 'text-subtle'}`}>{aboutYou}/{LIMITS.lookingFor} · at least {LIMITS.minSection}</p>
          {shown('lookingFor') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('lookingFor')}</p>}
        </div>

        <div>
          <Label hint={`Optional. Ages ${LIMITS.minAge} to ${LIMITS.maxAge}.`}>Preferred age range</Label>
          <div className="flex items-center gap-2">
            <input aria-label="Youngest preferred age" inputMode="numeric" value={draft.ageMin} onChange={(e) => set('ageMin', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="From" className={`${field} h-11`} />
            <span className="text-subtle" aria-hidden="true">–</span>
            <input aria-label="Oldest preferred age" inputMode="numeric" value={draft.ageMax} onChange={(e) => set('ageMax', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="To" className={`${field} h-11`} />
          </div>
          {shown('ageMin') && <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">{shown('ageMin')}</p>}
        </div>

        <div>
          <Label htmlFor="lf-region" hint="Optional. City or province only, never an exact place.">Location</Label>
          <select id="lf-region" value={draft.region} onChange={(e) => set('region', e.target.value)} className={`${field} h-11`}>
            <option value="">Don’t show a location</option>
            {PHILIPPINE_REGIONS_AND_LOCATIONS.map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.provincesAndCities.map((place) => <option key={place} value={place}>{place}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="lf-tag" hint={`Up to ${LIMITS.tags} interests.`}>Interests</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {draft.tags.map((tag) => (
              <span key={tag} className="tag inline-flex items-center gap-1">
                {tag}
                <button type="button" onClick={() => set('tags', draft.tags.filter((t) => t !== tag))} aria-label={`Remove ${tag}`} className="-mr-1 p-1 text-subtle hover:text-fg"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          {draft.tags.length < LIMITS.tags && (
            <div className="flex gap-2">
              <input
                id="lf-tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value.slice(0, LIMITS.tagLength))}
                onKeyDown={(e) => { if (e.key === 'Enter') addTag(e); }}
                placeholder="Books, K-drama, Valorant…"
                enterKeyHint="done"
                className={`${field} h-11`}
              />
              <button type="button" onClick={addTag} disabled={!cleanTag(tagInput)} className="btn btn-secondary btn-sm shrink-0">Add</button>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-line bg-raised/40 p-4">
          <Switch id="lf-show-photo" checked={draft.showPhoto} onChange={(v) => set('showPhoto', v)} label="Show my avatar" description="Otherwise your post uses a generic avatar." />
        </div>

        <div className="space-y-3 rounded-2xl border border-line bg-raised/40 p-4">
          <Switch id="lf-nsfw" checked={draft.isNsfw || alwaysMature} disabled={alwaysMature} onChange={(v) => set('isNsfw', v)} label="Mark as NSFW" description={alwaysMature ? 'NSFW Connection posts are always marked mature.' : 'Hide mature or sexually suggestive content behind a content warning.'} />
          {(draft.isNsfw || alwaysMature) && (
            <div>
              <Label htmlFor="lf-warning" hint="Optional. Shown on the cover, so keep it brief and free of explicit detail.">Content warning</Label>
              <input id="lf-warning" value={draft.contentWarning} onChange={(e) => set('contentWarning', e.target.value.slice(0, LIMITS.contentWarning))} maxLength={LIMITS.contentWarning} placeholder="e.g. Mature themes" className={`${field} h-11`} />
            </div>
          )}
          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle leading-snug">
            NSFW is a warning, not permission. Explicit sexual imagery, non-consensual or exploitative content and anything involving minors are never allowed.
          </p>
        </div>

        {problem && <p className="text-[length:calc(13px_*_var(--fs,1))] text-danger" role="alert">{problem}</p>}
      </form>
    </Sheet>
  );
};
