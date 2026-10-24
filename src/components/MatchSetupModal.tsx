import React, { useState } from 'react';
import {
  Zap,
  Sliders,
  Dices,
  Info,
  Check,
  Plus,
  ArrowRight,
  ChevronDown,
  Heart,
  Lock,
  SlidersHorizontal,
  MapPin,
} from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { GenderExpressionOption, Intention, UserPreferences } from '../types.ts';
import {
  AVAILABLE_TOPICS,
  INTENTION_LABELS,
  REGIONS,
  GENDER_EXPRESSIONS,
  SEXUAL_ORIENTATIONS,
  GENDER_IDENTITIES,
  PRONOUN_OPTIONS,
  DISCOVERY_FILTER_OPTIONS,
  toggleGenderExpression,
  togglePreferredFilter,
  generateSapphicPseudonym,
  validateSetupProfile,
} from '../utils/matching-logic.ts';
import {
  PHILIPPINE_REGIONS_AND_LOCATIONS,
  PHILIPPINE_ISLAND_GROUPS,
  toggleLocationPreference,
  formatLocationSummary,
} from '../utils/philippines-locations.ts';

interface MatchSetupModalProps {
  initialMode: 'quick' | 'custom';
  currentPrefs: UserPreferences;
  onClose: () => void;
  onStartMatching: (mode: 'quick' | 'custom', prefs: UserPreferences) => void;
}

export const MatchSetupModal: React.FC<MatchSetupModalProps> = ({
  initialMode,
  currentPrefs,
  onClose,
  onStartMatching,
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'custom'>(initialMode);
  const [displayName, setDisplayName] = useState(currentPrefs.displayName || 'Sapphic Guest');
  const [pronouns, setPronouns] = useState(currentPrefs.pronouns || 'she/her');
  const [customPronouns, setCustomPronouns] = useState(currentPrefs.customPronouns || '');
  const [intention, setIntention] = useState<Intention>(currentPrefs.intention || 'friendship');
  const [selectedTopics, setSelectedTopics] = useState<string[]>(currentPrefs.topics || []);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [locationSelection, setLocationSelection] = useState<string[]>(
    currentPrefs.locationSelection || ['Anywhere in the Philippines']
  );
  const [applyLocationFilter, setApplyLocationFilter] = useState<boolean>(
    currentPrefs.applyLocationFilter ?? false
  );
  const [showLocationOnProfile, setShowLocationOnProfile] = useState<boolean>(
    currentPrefs.showLocationOnProfile ?? true
  );
  const [locationSearchQuery, setLocationSearchQuery] = useState('');

  // SOGIE & Gender Expression state
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
    currentPrefs.genderIdentity || 'Prefer not to say'
  );
  const [genderIdentityCustom, setGenderIdentityCustom] = useState<string>(
    currentPrefs.genderIdentityCustom || ''
  );

  // Privacy toggles
  const [showGenderExpressionOnProfile, setShowGenderExpressionOnProfile] = useState<boolean>(
    currentPrefs.showGenderExpressionOnProfile ?? true
  );
  const [showSogieOnProfile, setShowSogieOnProfile] = useState<boolean>(
    currentPrefs.showSogieOnProfile ?? false
  );

  // Discovery Filter preferences
  const [applyGenderExpressionFilter, setApplyGenderExpressionFilter] = useState<boolean>(
    currentPrefs.applyGenderExpressionFilter ?? false
  );
  const [preferredGenderExpressions, setPreferredGenderExpressions] = useState<string[]>(
    currentPrefs.preferredGenderExpressions || ['Any / No preference']
  );

  const [sogieSectionOpen, setSogieSectionOpen] = useState<boolean>(false);
  const [isAgeConfirmed, setIsAgeConfirmed] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleRandomizeIdentity = () => {
    const generated = generateSapphicPseudonym();
    setDisplayName(generated.name);
    setPronouns(generated.pronouns);
  };

  const handleToggleTopic = (topic: string) => {
    if (selectedTopics.includes(topic)) {
      setSelectedTopics(selectedTopics.filter((t) => t !== topic));
    } else {
      if (selectedTopics.length >= 8) return;
      setSelectedTopics([...selectedTopics, topic]);
    }
  };

  const handleAddCustomTopic = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customTopicInput.trim();
    if (!trimmed) return;
    if (selectedTopics.includes(trimmed)) {
      setCustomTopicInput('');
      return;
    }
    if (selectedTopics.length >= 8) return;
    setSelectedTopics([...selectedTopics, trimmed]);
    setCustomTopicInput('');
  };

  const handleToggleExpr = (expr: GenderExpressionOption) => {
    setGenderExpression((prev) => toggleGenderExpression(prev, expr));
  };

  const handleToggleFilter = (filter: string) => {
    setPreferredGenderExpressions((prev) => togglePreferredFilter(prev, filter));
  };

  const handleResetFilters = () => {
    setPreferredGenderExpressions(['Any / No preference']);
    setApplyGenderExpressionFilter(false);
  };

  const handleSubmit = () => {
    const resolvedPronouns =
      pronouns === 'Self-described' && customPronouns.trim()
        ? customPronouns.trim()
        : pronouns;

    const prefs: UserPreferences = {
      displayName: displayName.trim() || 'Sapphic Guest',
      pronouns: resolvedPronouns,
      customPronouns: pronouns === 'Self-described' ? customPronouns.trim() : undefined,
      intention: activeTab === 'quick' ? 'open' : intention,
      topics: activeTab === 'quick' ? [] : selectedTopics,
      region: activeTab === 'quick' ? 'Anywhere in the Philippines' : formatLocationSummary(locationSelection),
      genderExpression: genderExpression.length > 0 ? genderExpression : undefined,
      sexualOrientation: sexualOrientation !== 'Prefer not to say' ? sexualOrientation : undefined,
      sexualOrientationCustom:
        sexualOrientation === 'Self-described' ? sexualOrientationCustom.trim() : undefined,
      genderIdentity: genderIdentity !== 'Prefer not to say' ? genderIdentity : undefined,
      genderIdentityCustom:
        genderIdentity === 'Self-described' ? genderIdentityCustom.trim() : undefined,
      showGenderExpressionOnProfile,
      showSogieOnProfile,
      showLocationOnProfile,
      applyGenderExpressionFilter:
        activeTab === 'custom' ? applyGenderExpressionFilter : false,
      preferredGenderExpressions:
        activeTab === 'custom' && applyGenderExpressionFilter
          ? preferredGenderExpressions
          : ['Any / No preference'],
      locationSelection: activeTab === 'custom' ? locationSelection : ['Anywhere in the Philippines'],
      applyLocationFilter: activeTab === 'custom' ? applyLocationFilter : false,
    };

    const validation = validateSetupProfile(prefs, isAgeConfirmed);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onStartMatching(activeTab, prefs);
  };

  const isCustom = activeTab === 'custom';
  const errorList = Object.values(errors).filter(Boolean);

  return (
    <Sheet
      title="Start a chat"
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
            {isCustom ? 'Find my match' : 'Start chatting'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </>
      }
    >
      <div className="space-y-7 text-fg">
        {/* Mode */}
        <div>
          <div role="tablist" aria-label="Match type" className="grid grid-cols-2 p-1 bg-ink rounded-xl border border-line">
            {([
              ['quick', 'Quick', Zap],
              ['custom', 'Custom', Sliders],
            ] as const).map(([tab, label, Icon]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === tab ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {isCustom ? 'Match on intention, topics and location.' : 'Meet anyone available right now.'}
          </p>
        </div>

        {/* Persona */}
        <section>
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
                onClick={handleRandomizeIdentity}
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
              className="input w-[7.5rem] sm:w-40 shrink-0"
            >
              {PRONOUN_OPTIONS.map((p) => (
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
              maxLength={30}
              className="input mt-2"
            />
          )}
        </section>

        {isCustom && (
          <>
            {/* Intention */}
            <section>
              <p className="label">Looking for</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(INTENTION_LABELS) as Intention[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={intention === key}
                    onClick={() => setIntention(key)}
                    className="chip"
                  >
                    {INTENTION_LABELS[key]}
                  </button>
                ))}
              </div>
            </section>

            {/* Topics */}
            <section>
              <div className="flex items-baseline justify-between">
                <p className="label">Topics</p>
                <span className="text-[12px] text-subtle">{selectedTopics.length}/8</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[...AVAILABLE_TOPICS, ...selectedTopics.filter((t) => !AVAILABLE_TOPICS.includes(t))].map((topic) => {
                  const isSelected = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => handleToggleTopic(topic)}
                      className="chip"
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-berry" />}
                      {topic}
                    </button>
                  );
                })}
              </div>
              <form onSubmit={handleAddCustomTopic} className="flex gap-2 mt-3">
                <input
                  type="text"
                  value={customTopicInput}
                  onChange={(e) => setCustomTopicInput(e.target.value)}
                  placeholder="Add your own"
                  aria-label="Add a custom topic"
                  maxLength={25}
                  className="input flex-1"
                />
                <button
                  type="submit"
                  disabled={!customTopicInput.trim() || selectedTopics.length >= 8}
                  className="icon-btn w-11 h-11 bg-raised border border-line text-berry"
                  aria-label="Add topic"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </form>
            </section>

            {/* Location */}
            <section className="card p-4 space-y-3">
              <ToggleRow
                icon={<MapPin className="w-4 h-4 text-lavender" />}
                checked={applyLocationFilter}
                onChange={setApplyLocationFilter}
                title="Filter by location"
                hint={formatLocationSummary(locationSelection)}
              />

              {applyLocationFilter && (
                <div className="space-y-3 pt-3 border-t border-line">
                  <input
                    type="search"
                    value={locationSearchQuery}
                    onChange={(e) => setLocationSearchQuery(e.target.value)}
                    placeholder="Search region, province or city"
                    aria-label="Search locations"
                    className="input"
                  />

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={locationSelection.includes('Anywhere in the Philippines')}
                      onClick={() => setLocationSelection(['Anywhere in the Philippines'])}
                      className="chip"
                    >
                      Nationwide
                    </button>
                    {PHILIPPINE_ISLAND_GROUPS.map((ig) => (
                      <button
                        key={ig}
                        type="button"
                        aria-pressed={locationSelection.includes(ig)}
                        onClick={() => setLocationSelection(toggleLocationPreference(locationSelection, ig))}
                        className="chip"
                      >
                        {ig}
                      </button>
                    ))}
                  </div>

                  <div className="max-h-56 overflow-y-auto overscroll-contain space-y-2 -mr-1 pr-1">
                    {PHILIPPINE_REGIONS_AND_LOCATIONS.map((group) => {
                      const q = locationSearchQuery.toLowerCase();
                      const regionMatches = !q || group.region.toLowerCase().includes(q);
                      const places = group.provincesAndCities.filter(
                        (pc) => regionMatches || pc.toLowerCase().includes(q)
                      );
                      if (!regionMatches && places.length === 0) return null;

                      const isRegionSelected = locationSelection.includes(group.region);

                      return (
                        <div key={group.region} className="rounded-xl bg-ink border border-line p-3">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              aria-pressed={isRegionSelected}
                              onClick={() =>
                                setLocationSelection(toggleLocationPreference(locationSelection, group.region))
                              }
                              className={`text-left text-[13px] font-semibold cursor-pointer py-1 ${
                                isRegionSelected ? 'text-berry' : 'text-fg hover:text-berry'
                              }`}
                            >
                              {isRegionSelected && <Check className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
                              {group.region}
                            </button>
                            <span className="text-[11px] text-subtle shrink-0">{group.islandGroup}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {places.map((pc) => {
                              const isPcSelected = locationSelection.includes(pc);
                              return (
                                <button
                                  key={pc}
                                  type="button"
                                  aria-pressed={isPcSelected}
                                  onClick={() => setLocationSelection(toggleLocationPreference(locationSelection, pc))}
                                  className={`h-8 px-2.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors ${
                                    isPcSelected
                                      ? 'bg-berry text-ink'
                                      : 'bg-surface text-muted border border-line hover:text-fg'
                                  }`}
                                >
                                  {pc}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-line">
                <ToggleRow
                  checked={showLocationOnProfile}
                  onChange={setShowLocationOnProfile}
                  title="Show my area on my profile"
                />
              </div>
            </section>

            {/* Gender expression filter */}
            <section className="card p-4 space-y-3">
              <ToggleRow
                icon={<SlidersHorizontal className="w-4 h-4 text-lavender" />}
                checked={applyGenderExpressionFilter}
                onChange={(v) => (v ? setApplyGenderExpressionFilter(true) : handleResetFilters())}
                title="Filter by gender expression"
                hint="People who prefer not to say are never excluded."
              />
              {applyGenderExpressionFilter && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-line">
                  {DISCOVERY_FILTER_OPTIONS.map((filter) => {
                    const isSelected = preferredGenderExpressions.includes(filter);
                    return (
                      <button
                        key={filter}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleToggleFilter(filter)}
                        className="chip"
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-berry" />}
                        {filter}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* Identity (optional) */}
        <section className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setSogieSectionOpen(!sogieSectionOpen)}
            aria-expanded={sogieSectionOpen}
            className="w-full flex items-center gap-2 px-4 h-14 text-left cursor-pointer hover:bg-raised transition-colors"
          >
            <Heart className="w-4 h-4 text-lavender" />
            <span className="flex-1 text-sm font-semibold">Identity</span>
            <span className="text-[12px] text-subtle">Optional</span>
            <ChevronDown className={`w-4 h-4 text-subtle transition-transform ${sogieSectionOpen ? 'rotate-180' : ''}`} />
          </button>

          {sogieSectionOpen && (
            <div className="px-4 pb-4 pt-1 space-y-5 border-t border-line">
              <div className="pt-3">
                <p className="label">Gender expression</p>
                <div className="flex flex-wrap gap-2">
                  {GENDER_EXPRESSIONS.map((expr) => {
                    const isSelected = genderExpression.includes(expr);
                    return (
                      <button
                        key={expr}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleToggleExpr(expr)}
                        className="chip"
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-berry" />}
                        {expr}
                      </button>
                    );
                  })}
                </div>
                {errors.genderExpression && (
                  <p className="mt-1.5 text-[13px] text-danger">{errors.genderExpression}</p>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="qs-orientation" className="label">
                    Sexual orientation
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
                    Gender identity
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

              <div className="space-y-3 pt-4 border-t border-line">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Lock className="w-3.5 h-3.5 text-lavender" />
                  Show on my profile
                </p>
                <ToggleRow
                  checked={showGenderExpressionOnProfile}
                  onChange={setShowGenderExpressionOnProfile}
                  title="Gender expression"
                  hint="Otherwise used for matching only."
                />
                <ToggleRow checked={showSogieOnProfile} onChange={setShowSogieOnProfile} title="Orientation & identity" />
              </div>
            </div>
          )}
        </section>

        {/* Consent */}
        <section className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer text-sm text-fg">
            <input
              type="checkbox"
              checked={isAgeConfirmed}
              onChange={(e) => setIsAgeConfirmed(e.target.checked)}
              aria-invalid={!!errors.ageConfirmation}
              className="check"
            />
            <span className="leading-snug">
              I'm <strong className="font-semibold">18 or older</strong> and identify as a woman or non-binary sapphic person.
            </span>
          </label>
          <p className="flex gap-2 text-[13px] text-muted leading-relaxed">
            <Info className="w-4 h-4 text-subtle shrink-0 mt-0.5" />
            <span>
              Your match only sees your pseudonym, pronouns, intention, shared topics and anything you choose to show.
            </span>
          </p>
        </section>
      </div>
    </Sheet>
  );
};

const ToggleRow: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}> = ({ checked, onChange, title, hint, icon }) => (
  <label className="flex items-center gap-3 cursor-pointer">
    {icon}
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-medium text-fg">{title}</span>
      {hint && <span className="block text-[12px] text-subtle mt-0.5 truncate">{hint}</span>}
    </span>
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className="relative w-11 h-[26px] shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-berry peer-focus-visible:ring-2 peer-focus-visible:ring-berry peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface after:absolute after:top-[3px] after:left-[3px] after:w-5 after:h-5 after:rounded-full after:bg-fg after:shadow after:transition-transform peer-checked:after:translate-x-[18px]"
    />
  </label>
);
