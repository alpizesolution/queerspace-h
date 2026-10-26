import React, { useState } from 'react';
import { Check, Dices, Lock, Shuffle } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { Sheet } from './Sheet.tsx';
import { ToggleRow } from './FormControls.tsx';
import { isValidAvatar, randomAvatar } from '../utils/avatar.ts';
import { GenderExpressionOption, UserPreferences } from '../types.ts';
import {
  GENDER_EXPRESSIONS,
  GENDER_IDENTITIES,
  PRONOUN_OPTIONS,
  SEXUAL_ORIENTATIONS,
  generateSapphicPseudonym,
  toggleGenderExpression,
  validateSetupProfile,
} from '../utils/matching-logic.ts';
import { ProfileFields } from '../utils/preferences.ts';

interface ProfileEditorSheetProps {
  currentPrefs: UserPreferences;
  onClose: () => void;
  /** Receives only profile fields; chat filters are never part of this save. */
  onSave: (profile: ProfileFields) => void;
}

/** "Your profile": who you are and what others may see. Chat filters live in the Seek sheet. */
export const ProfileEditorSheet: React.FC<ProfileEditorSheetProps> = ({ currentPrefs, onClose, onSave }) => {
  const [displayName, setDisplayName] = useState(currentPrefs.displayName || 'Sapphic Guest');
  const [avatar, setAvatar] = useState(() =>
    isValidAvatar(currentPrefs.avatar) ? currentPrefs.avatar : randomAvatar()
  );
  const [pronouns, setPronouns] = useState(
    // A custom pronoun saved earlier shows as "Self-described" with its text.
    currentPrefs.customPronouns ? 'Self-described' : currentPrefs.pronouns || 'she/her'
  );
  const [customPronouns, setCustomPronouns] = useState(currentPrefs.customPronouns || '');

  const [genderExpression, setGenderExpression] = useState<GenderExpressionOption[]>(
    currentPrefs.genderExpression || []
  );
  const [sexualOrientation, setSexualOrientation] = useState<string>(
    currentPrefs.sexualOrientation || 'Prefer not to say'
  );
  const [sexualOrientationCustom, setSexualOrientationCustom] = useState<string>(
    currentPrefs.sexualOrientationCustom || ''
  );
  const [genderIdentity, setGenderIdentity] = useState<string>(
    // Saved before Non-binary and Genderfluid became separate options.
    currentPrefs.genderIdentity === 'Non-binary / Genderfluid'
      ? 'Non-binary'
      : currentPrefs.genderIdentity || 'Prefer not to say'
  );
  const [genderIdentityCustom, setGenderIdentityCustom] = useState<string>(
    currentPrefs.genderIdentityCustom || ''
  );

  const [showGenderExpressionOnProfile, setShowGenderExpressionOnProfile] = useState<boolean>(
    currentPrefs.showGenderExpressionOnProfile ?? true
  );
  const [showSogieOnProfile, setShowSogieOnProfile] = useState<boolean>(currentPrefs.showSogieOnProfile ?? false);
  const [showLocationOnProfile, setShowLocationOnProfile] = useState<boolean>(
    currentPrefs.showLocationOnProfile ?? true
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const custom = pronouns === 'Self-described' ? customPronouns.trim() : '';
    const profile: ProfileFields = {
      displayName: displayName.trim() || 'Sapphic Guest',
      avatar,
      pronouns: custom || (pronouns === 'Self-described' ? 'she/her' : pronouns),
      customPronouns: custom || undefined,
      genderExpression: genderExpression.length > 0 ? genderExpression : undefined,
      sexualOrientation: sexualOrientation !== 'Prefer not to say' ? sexualOrientation : undefined,
      sexualOrientationCustom: sexualOrientation === 'Self-described' ? sexualOrientationCustom.trim() : undefined,
      genderIdentity: genderIdentity !== 'Prefer not to say' ? genderIdentity : undefined,
      genderIdentityCustom: genderIdentity === 'Self-described' ? genderIdentityCustom.trim() : undefined,
      showGenderExpressionOnProfile,
      showSogieOnProfile,
      showLocationOnProfile,
    };

    // Only profile rules apply here; filter checks belong to the Seek sheet.
    const validation = validateSetupProfile(profile, true);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    onSave(profile);
  };

  const errorList = Object.values(errors).filter(Boolean);

  return (
    <Sheet
      title="Your profile"
      onClose={onClose}
      size="lg"
      footer={
        <>
          {errorList.length > 0 && (
            <p role="alert" className="mb-2 text-[13px] text-danger">
              {errorList[0]}
            </p>
          )}
          <button type="button" onClick={handleSubmit} className="btn btn-primary w-full h-12 text-[15px]">
            Save profile
          </button>
        </>
      }
    >
      <div className="space-y-7 text-fg">
        {/* Persona */}
        <section>
          <button
            type="button"
            onClick={() => setAvatar((current) => randomAvatar(current))}
            className="group flex items-center gap-3 mb-4 -ml-1 p-1 pr-3 rounded-full hover:bg-raised transition-colors cursor-pointer"
            aria-label="Shuffle your avatar"
          >
            <span className="relative">
              <AnimalAvatar key={avatar} avatar={avatar} seed={displayName} className="w-12 h-12 anim-pop" />
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-raised border border-line flex items-center justify-center text-muted group-hover:text-fg">
                <Shuffle className="w-3 h-3" />
              </span>
            </span>
            <span className="text-left">
              <span className="block text-[13px] font-semibold text-fg">Your avatar</span>
              <span className="block text-[12px] text-subtle">Tap to shuffle</span>
            </span>
          </button>
          <label htmlFor="qs-name" className="label">
            Your name &amp; pronouns
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                id="qs-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Lavender Lark"
                maxLength={25}
                autoComplete="off"
                aria-invalid={!!errors.displayName}
                className="input pr-11"
              />
              <button
                type="button"
                onClick={() => setDisplayName(generateSapphicPseudonym().name)}
                className="icon-btn absolute right-0.5 top-0.5 w-10 h-10"
                title="Random pseudonym"
                aria-label="Generate a random pseudonym"
              >
                <Dices className="w-[18px] h-[18px]" />
              </button>
            </div>
            <select
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              aria-label="Pronouns"
              className="input w-[8.25rem] sm:w-40 shrink-0"
            >
              {[...PRONOUN_OPTIONS, ...(PRONOUN_OPTIONS.includes(pronouns) ? [] : [pronouns])].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {errors.displayName && <p className="mt-1.5 text-[13px] text-danger">{errors.displayName}</p>}
          {pronouns === 'Self-described' && (
            <input
              type="text"
              value={customPronouns}
              onChange={(e) => setCustomPronouns(e.target.value)}
              placeholder="Your pronouns, e.g. fae/faer"
              aria-label="Custom pronouns"
              maxLength={20}
              className="input mt-2"
            />
          )}
        </section>

        {/* Identity (optional) */}
        <section className="space-y-5">
          <div>
            <p className="label">
              Gender expression <span className="font-normal text-subtle">· optional</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {GENDER_EXPRESSIONS.map((expr) => {
                const isSelected = genderExpression.includes(expr);
                return (
                  <button
                    key={expr}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setGenderExpression((prev) => toggleGenderExpression(prev, expr))}
                    className="chip"
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-berry" />}
                    {expr}
                  </button>
                );
              })}
            </div>
            {errors.genderExpression && <p className="mt-1.5 text-[13px] text-danger">{errors.genderExpression}</p>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="qs-orientation" className="label">
                Sexual orientation <span className="font-normal text-subtle">· optional</span>
              </label>
              <select
                id="qs-orientation"
                value={sexualOrientation}
                onChange={(e) => setSexualOrientation(e.target.value)}
                className="input"
              >
                {SEXUAL_ORIENTATIONS.map((so) => (
                  <option key={so} value={so}>
                    {so}
                  </option>
                ))}
              </select>
              {sexualOrientation === 'Self-described' && (
                <input
                  type="text"
                  value={sexualOrientationCustom}
                  onChange={(e) => setSexualOrientationCustom(e.target.value)}
                  placeholder="Describe your orientation"
                  aria-label="Describe your orientation"
                  maxLength={40}
                  className="input mt-2"
                />
              )}
            </div>
            <div>
              <label htmlFor="qs-identity" className="label">
                Gender identity <span className="font-normal text-subtle">· optional</span>
              </label>
              <select
                id="qs-identity"
                value={genderIdentity}
                onChange={(e) => setGenderIdentity(e.target.value)}
                className="input"
              >
                {GENDER_IDENTITIES.map((gi) => (
                  <option key={gi} value={gi}>
                    {gi}
                  </option>
                ))}
              </select>
              {genderIdentity === 'Self-described' && (
                <input
                  type="text"
                  value={genderIdentityCustom}
                  onChange={(e) => setGenderIdentityCustom(e.target.value)}
                  placeholder="Describe your gender identity"
                  aria-label="Describe your gender identity"
                  maxLength={40}
                  className="input mt-2"
                />
              )}
            </div>
          </div>
        </section>

        {/* Visibility */}
        <section className="card p-4 space-y-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Lock className="w-3.5 h-3.5 text-lavender" />
            Show on my profile
          </p>
          <ToggleRow
            checked={showGenderExpressionOnProfile}
            onChange={setShowGenderExpressionOnProfile}
            title="Gender expression"
            hint="Hidden means nobody sees it, and others' filters don't use it."
          />
          <ToggleRow checked={showSogieOnProfile} onChange={setShowSogieOnProfile} title="Orientation & identity" />
          <ToggleRow
            checked={showLocationOnProfile}
            onChange={setShowLocationOnProfile}
            title="My area"
            hint={`Your area is set in Seek's Custom filters${currentPrefs.region ? ` (${currentPrefs.region})` : ''}.`}
          />
        </section>
      </div>
    </Sheet>
  );
};
