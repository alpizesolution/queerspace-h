import React, { useState } from 'react';
import { Check, Dices, Shuffle } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { Sheet } from './Sheet.tsx';
import { isValidAvatar, randomAvatar } from '../utils/avatar.ts';
import { UserPreferences } from '../types.ts';
import { MY_VIBE_OPTIONS, PRONOUN_OPTIONS, SEXUAL_ORIENTATIONS, GENDER_IDENTITIES, GENDER_EXPRESSIONS, generateSapphicPseudonym } from '../utils/matching-logic.ts';
import { ProfileFields } from '../utils/preferences.ts';
interface ProfileEditorSheetProps { currentPrefs: UserPreferences; onClose: () => void; onSave: (profile: ProfileFields) => void; }
/** Anonymous profile: a pseudonym and illustrated avatar, never a required photo or real name. */
export const ProfileEditorSheet: React.FC<ProfileEditorSheetProps> = ({ currentPrefs, onClose, onSave }) => {
  const [displayName, setDisplayName] = useState(currentPrefs.displayName || 'Sapphic Guest');
  const [avatar, setAvatar] = useState(() => isValidAvatar(currentPrefs.avatar) ? currentPrefs.avatar : randomAvatar());
  const [pronouns, setPronouns] = useState(currentPrefs.customPronouns ? 'Self-described' : currentPrefs.pronouns || 'she/her');
  const [customPronouns, setCustomPronouns] = useState(currentPrefs.customPronouns || '');
  const [aboutMe, setAboutMe] = useState((currentPrefs.aboutMe || '').slice(0, 160));
  const [myVibe, setMyVibe] = useState(currentPrefs.myVibe && (MY_VIBE_OPTIONS as readonly string[]).includes(currentPrefs.myVibe) ? currentPrefs.myVibe : '');
  const [sexualOrientation, setSexualOrientation] = useState(currentPrefs.sexualOrientation || '');
  const [sexualOrientationCustom, setSexualOrientationCustom] = useState(currentPrefs.sexualOrientationCustom || '');
  const [genderIdentity, setGenderIdentity] = useState(currentPrefs.genderIdentity || '');
  const [genderIdentityCustom, setGenderIdentityCustom] = useState(currentPrefs.genderIdentityCustom || '');
  const [genderExpression, setGenderExpression] = useState<string[]>((currentPrefs.genderExpression || []).slice(0, 2));
  const [genderExpressionSearch, setGenderExpressionSearch] = useState('');
  const [showSexualOrientation, setShowSexualOrientation] = useState(currentPrefs.showSexualOrientationOnProfile ?? false);
  const [showGenderIdentity, setShowGenderIdentity] = useState(currentPrefs.showGenderIdentityOnProfile ?? false);
  const [showGenderExpression, setShowGenderExpression] = useState(currentPrefs.showGenderExpressionOnProfile ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const handleSubmit = () => {
    const name = displayName.trim();
    const pronounValue = pronouns === 'Self-described' ? customPronouns.trim() : pronouns;
    const next: ProfileFields = {
      displayName: name || 'Sapphic Guest', avatar, pronouns: pronounValue || 'she/her',
      customPronouns: pronouns === 'Self-described' ? customPronouns.trim() || undefined : undefined,
      aboutMe: aboutMe.trim().slice(0, 160), myVibe: myVibe || undefined,
      sexualOrientation: sexualOrientation || undefined,
      sexualOrientationCustom: sexualOrientation === 'Self-described' ? sexualOrientationCustom.trim() || undefined : undefined,
      genderIdentity: genderIdentity || undefined,
      genderIdentityCustom: genderIdentity === 'Self-described' ? genderIdentityCustom.trim() || undefined : undefined,
      genderExpression: genderExpression as NonNullable<UserPreferences['genderExpression']>,
      showSexualOrientationOnProfile: showSexualOrientation,
      showGenderIdentityOnProfile: showGenderIdentity,
      showGenderExpressionOnProfile: showGenderExpression,
      showSogieOnProfile: showSexualOrientation || showGenderIdentity || showGenderExpression,
      showLocationOnProfile: currentPrefs.showLocationOnProfile ?? true,
    };
    const validation: Record<string, string> = {};
    if (name.length < 2) validation.displayName = 'Choose a display name with at least 2 characters.';
    if (name.length > 25) validation.displayName = 'Your display name must be 25 characters or fewer.';
    if (pronouns === 'Self-described' && !customPronouns.trim()) validation.pronouns = 'Add your pronouns or choose another option.';
    if (Object.keys(validation).length) { setErrors(validation); return; }
    setErrors({}); onSave(next);
  };
  const errorList = Object.values(errors).filter(Boolean);
  return <Sheet title="Your profile" onClose={onClose} size="lg" footer={<>
    {errorList.length > 0 && <p role="alert" className="mb-2 text-[13px] text-danger">{errorList[0]}</p>}
    <button type="button" onClick={handleSubmit} className="btn btn-primary w-full h-12 text-[15px]">Save profile</button>
  </>}>
    <div className="space-y-7 text-fg">
      <section>
        <button type="button" onClick={() => setAvatar((current) => randomAvatar(current))} className="group flex items-center gap-3 mb-4 -ml-1 p-1 pr-3 rounded-full hover:bg-raised transition-colors" aria-label="Shuffle your anonymous avatar">
          <span className="relative"><AnimalAvatar key={avatar} avatar={avatar} seed={displayName} className="w-12 h-12 anim-pop" /><span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-raised border border-line flex items-center justify-center text-muted"><Shuffle className="w-3 h-3" /></span></span>
          <span className="text-left"><span className="block text-[13px] font-semibold text-fg">Anonymous avatar</span><span className="block text-[12px] text-subtle">Tap to change · no photos</span></span>
        </button>
        <label htmlFor="qs-name" className="label">Display name</label>
        <div className="flex gap-2"><div className="relative flex-1 min-w-0">
          <input id="qs-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Lavender Lark" maxLength={25} autoComplete="off" aria-invalid={!!errors.displayName} className="input pr-11" />
          <button type="button" onClick={() => setDisplayName(generateSapphicPseudonym().name)} className="icon-btn absolute right-0.5 top-0.5 w-10 h-10" title="Random pseudonym" aria-label="Generate a random pseudonym"><Dices className="w-[18px] h-[18px]" /></button>
        </div><select value={pronouns} onChange={(e) => setPronouns(e.target.value)} aria-label="Pronouns" className="input w-[8.25rem] sm:w-40 shrink-0">
          {[...PRONOUN_OPTIONS, ...(PRONOUN_OPTIONS.includes(pronouns) ? [] : [pronouns])].map((p) => <option key={p} value={p}>{p}</option>)}
        </select></div>
        {errors.displayName && <p className="mt-1.5 text-[13px] text-danger">{errors.displayName}</p>}
        {pronouns === 'Self-described' && <input type="text" value={customPronouns} onChange={(e) => setCustomPronouns(e.target.value)} placeholder="Your pronouns" aria-label="Custom pronouns" maxLength={20} className="input mt-2" />}
        {errors.pronouns && <p className="mt-1.5 text-[13px] text-danger">{errors.pronouns}</p>}
      </section>
      <section>
        <div className="flex items-baseline justify-between mb-2"><label htmlFor="qs-about-me" className="label !mb-0">About Me <span className="font-normal text-subtle">· optional</span></label><span className={`text-xs tabular-nums ${aboutMe.length >= 150 ? 'text-berry' : 'text-subtle'}`}>{aboutMe.length}/160</span></div>
        <textarea id="qs-about-me" value={aboutMe} onChange={(e) => setAboutMe(e.target.value.slice(0, 160))} maxLength={160} rows={3} placeholder="A little about your world…" className="input resize-none" aria-describedby="qs-about-hint" />
        <p id="qs-about-hint" className="mt-1.5 text-xs text-subtle">Keep it short, personal, and as anonymous as you like.</p>
      </section>
      <section><p className="label">My Vibe <span className="font-normal text-subtle">· optional</span></p><p className="mb-2 text-xs text-subtle">Pick a personality or interest, not a gender label.</p><div className="flex flex-wrap gap-2">
        {MY_VIBE_OPTIONS.map((vibe) => { const selected = myVibe === vibe; return <button key={vibe} type="button" aria-pressed={selected} onClick={() => setMyVibe((current) => current === vibe ? '' : vibe)} className="chip">{selected && <Check className="w-3.5 h-3.5 text-berry" />}{vibe}</button>; })}
      </div><p className="mt-2 text-xs text-subtle">Choose the label that feels right to you, or leave it blank.</p></section>
      <section className="space-y-4 rounded-2xl border border-line p-4">
        <div><p className="label !mb-1">SOGIE <span className="font-normal text-subtle">· optional</span></p><p className="text-xs text-subtle">Share only what feels comfortable. Each field has its own visibility switch and is hidden by default.</p></div>
        <div className="space-y-2">
          <label className="label" htmlFor="qs-orientation">Sexual orientation</label>
          <select id="qs-orientation" value={sexualOrientation} onChange={(e) => setSexualOrientation(e.target.value)} className="input">
            <option value="">Prefer not to share</option>{SEXUAL_ORIENTATIONS.filter((v) => v !== 'Prefer not to say').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {sexualOrientation === 'Self-described' && <input value={sexualOrientationCustom} onChange={(e) => setSexualOrientationCustom(e.target.value.slice(0, 40))} maxLength={40} placeholder="Describe in your own words" aria-label="Self-described sexual orientation" className="input" />}
          <label className="flex items-center justify-between gap-3 text-sm"><span>Show sexual orientation on my profile</span><input type="checkbox" className="check" checked={showSexualOrientation} onChange={(e) => setShowSexualOrientation(e.target.checked && Boolean(sexualOrientation))} disabled={!sexualOrientation} /></label>
        </div>
        <div className="space-y-2">
          <label className="label" htmlFor="qs-gender-identity">Gender identity</label>
          <select id="qs-gender-identity" value={genderIdentity} onChange={(e) => setGenderIdentity(e.target.value)} className="input">
            <option value="">Prefer not to share</option>{GENDER_IDENTITIES.filter((v) => v !== 'Prefer not to say').map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {genderIdentity === 'Self-described' && <input value={genderIdentityCustom} onChange={(e) => setGenderIdentityCustom(e.target.value.slice(0, 40))} maxLength={40} placeholder="Describe in your own words" aria-label="Self-described gender identity" className="input" />}
          <label className="flex items-center justify-between gap-3 text-sm"><span>Show gender identity on my profile</span><input type="checkbox" className="check" checked={showGenderIdentity} onChange={(e) => setShowGenderIdentity(e.target.checked && Boolean(genderIdentity))} disabled={!genderIdentity} /></label>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label !mb-0">Gender expression <span className="font-normal text-subtle">· optional</span></p>
            <span className="text-xs text-subtle tabular-nums">{genderExpression.length} selected</span>
          </div>
          <p className="text-xs text-subtle">Choose up to 2 labels that best describe your gender presentation.</p>
          <input
            type="search"
            value={genderExpressionSearch}
            onChange={(e) => setGenderExpressionSearch(e.target.value)}
            placeholder="Search gender expressions…"
            aria-label="Search gender expression options"
            className="input"
          />
          <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto rounded-xl border border-line p-3" role="group" aria-label="Gender expression options">
            {GENDER_EXPRESSIONS.filter((value) => value.toLowerCase().includes(genderExpressionSearch.trim().toLowerCase())).map((value) => {
              const selected = genderExpression.includes(value);
              return <button key={value} type="button" aria-pressed={selected} onClick={() => setGenderExpression((old) => {
                if (value === 'Prefer not to say') return old.includes(value) ? [] : [value];
                if (selected) return old.filter((v) => v !== value);
                if (old.length >= 2) return old;
                return [...old.filter((v) => v !== 'Prefer not to say'), value];
              })} className="chip">{selected && <Check className="w-3.5 h-3.5 text-berry" />}{value}</button>;
            })}
            {GENDER_EXPRESSIONS.filter((value) => value.toLowerCase().includes(genderExpressionSearch.trim().toLowerCase())).length === 0 && <p className="w-full py-2 text-sm text-subtle">No matching options.</p>}
          </div>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Show gender expression on my profile</span><input type="checkbox" className="check" checked={showGenderExpression} onChange={(e) => setShowGenderExpression(e.target.checked && genderExpression.length > 0)} disabled={!genderExpression.length} /></label>
        </div>
      </section>
      <p className="text-xs text-subtle">Your birthday and My Type preferences stay private. You never need to share your real name or photo.</p>
    </div>
  </Sheet>;
};
