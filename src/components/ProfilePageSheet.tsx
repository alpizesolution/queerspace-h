import React from 'react';
import { ArrowRight, LockKeyhole, Pencil, Sparkles } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { UserPreferences } from '../types.ts';
import { INTENTION_LABELS } from '../utils/matching-logic.ts';
import { calculateAge } from '../utils/ageEligibility.ts';

interface ProfilePageSheetProps {
  currentPrefs: UserPreferences;
  onClose: () => void;
  onEditProfile: () => void;
  onEditPreferences: () => void;
}

/** Private self-view for the member; only the public fields are visible to other members. */
export const ProfilePageSheet: React.FC<ProfilePageSheetProps> = ({ currentPrefs, onClose, onEditProfile, onEditPreferences }) => {
  const age = currentPrefs.birthDate ? calculateAge(currentPrefs.birthDate) : null;
  const myType = currentPrefs.applyGenderExpressionFilter
    ? (currentPrefs.preferredGenderExpressions || []).filter((value) => value !== 'Any / No preference')
    : [];
  return <Sheet title="My profile" onClose={onClose} size="lg" footer={
    <button type="button" onClick={onEditProfile} className="btn btn-primary w-full h-12"><Pencil className="w-4 h-4" /> Edit profile</button>
  }>
    <div className="space-y-6 text-fg">
      <section className="flex items-center gap-4">
        <AnimalAvatar avatar={currentPrefs.avatar} seed={currentPrefs.displayName || 'guest'} className="w-[68px] h-[68px]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight truncate">{currentPrefs.displayName || 'Anonymous member'}</h2>
          <p className="text-sm text-muted mt-1">{[age !== null ? String(age) : '', currentPrefs.pronouns].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-subtle mt-1">Anonymous member</p>
        </div>
      </section>
      {!currentPrefs.profileComplete && <div className="rounded-2xl border border-berry/30 bg-raised p-3 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-berry shrink-0 mt-0.5" />
        <div><p className="text-sm font-medium">Finish your profile</p><p className="text-xs text-muted mt-1">Save your anonymous details before joining discovery.</p></div>
      </div>}
      <section className="rounded-2xl border border-line bg-raised/60 p-4 space-y-2">
        <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] font-semibold text-subtle">About Me</p>
        {currentPrefs.aboutMe?.trim() ? <p className="text-sm leading-6 whitespace-pre-wrap break-words">{currentPrefs.aboutMe}</p> : <p className="text-sm text-subtle">Nothing here yet.</p>}
        <p className="text-[length:calc(11px_*_var(--fs,1))] text-subtle">{(currentPrefs.aboutMe || '').length}/160 characters</p>
      </section>
      <section className="space-y-2">
        <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] font-semibold text-subtle">My Vibe</p>
        {currentPrefs.myVibe ? <span className="inline-flex items-center rounded-full border border-berry/30 bg-berry/10 px-3 py-1.5 text-sm font-medium text-fg">{currentPrefs.myVibe}</span> : <p className="text-sm text-subtle">Optional · not set</p>}
      </section>
      <section className="space-y-2">
        <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] font-semibold text-subtle">Personal Style</p>
        {currentPrefs.personalStyle ? <span className="inline-flex items-center rounded-full border border-berry/30 bg-berry/10 px-3 py-1.5 text-sm font-medium text-fg">{currentPrefs.personalStyle}</span> : <p className="text-sm text-subtle">Optional · not set</p>}
      </section>
      {(currentPrefs.showSexualOrientationOnProfile || currentPrefs.showGenderIdentityOnProfile || currentPrefs.showGenderExpressionOnProfile) && <section className="space-y-3">
        <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] font-semibold text-subtle">SOGIE · shared fields</p>
        {currentPrefs.showSexualOrientationOnProfile && currentPrefs.sexualOrientation && <p className="text-sm"><span className="text-muted">Sexual orientation</span><span className="block">{currentPrefs.sexualOrientation === 'Self-described' ? currentPrefs.sexualOrientationCustom : currentPrefs.sexualOrientation}</span></p>}
        {currentPrefs.showGenderIdentityOnProfile && currentPrefs.genderIdentity && <p className="text-sm"><span className="text-muted">Gender identity</span><span className="block">{currentPrefs.genderIdentity === 'Self-described' ? currentPrefs.genderIdentityCustom : currentPrefs.genderIdentity}</span></p>}
        {currentPrefs.showGenderExpressionOnProfile && currentPrefs.genderExpression?.length && <p className="text-sm"><span className="text-muted">Gender expression</span><span className="block">{currentPrefs.genderExpression.join(', ')}</span></p>}
        <p className="text-xs text-subtle">Only the fields you chose to show are shared.</p>
      </section>}
      <section className="space-y-2">
        <p className="text-[length:calc(11px_*_var(--fs,1))] uppercase tracking-[0.14em] font-semibold text-subtle">Looking for</p>
        <p className="text-sm">{INTENTION_LABELS[currentPrefs.intention] || 'Open to Anything'}</p>
      </section>
      <section className="rounded-2xl border border-line p-4 space-y-3">
        <div className="flex items-start gap-2">
          <LockKeyhole className="w-4 h-4 text-lavender shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-sm font-semibold">My Type <span className="text-xs font-normal text-subtle">· only you</span></p>
            <p className="text-xs text-muted mt-1">{myType.length ? myType.join(', ') : 'No preferred vibes selected'}</p>
          </div>
        </div>
        <button type="button" onClick={onEditPreferences} className="btn btn-secondary w-full">Edit discovery preferences <ArrowRight className="w-4 h-4" /></button>
      </section>
      <p className="text-xs leading-5 text-subtle">Your birthday and My Type stay private. You never need to share your real name or photo.</p>
    </div>
  </Sheet>;
};
