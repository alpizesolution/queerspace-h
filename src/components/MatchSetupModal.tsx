import React, { useState } from 'react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { AgeInput, ToggleRow } from './FormControls.tsx';
import { Zap, Sliders, Info, Check, Plus, ArrowRight, SlidersHorizontal, MapPin, Cake, Pencil } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { Intention, UserPreferences } from '../types.ts';
import {
  AVAILABLE_TOPICS,
  INTENTION_LABELS,
  DISCOVERY_FILTER_OPTIONS,
  togglePreferredFilter,
  validateSetupProfile,
} from '../utils/matching-logic.ts';
import {
  PHILIPPINE_REGIONS_AND_LOCATIONS,
  PHILIPPINE_ISLAND_GROUPS,
  toggleLocationPreference,
  formatLocationSummary,
} from '../utils/philippines-locations.ts';
import { FilterFields } from '../utils/preferences.ts';

interface MatchSetupModalProps {
  initialMode: 'quick' | 'custom';
  currentPrefs: UserPreferences;
  onClose: () => void;
  /**
   * Starts a search. `filters` are the saved Custom filters (kept even for a Quick search);
   * `mode` decides whether this search uses them.
   */
  onStartMatching: (mode: 'quick' | 'custom', filters: FilterFields) => void;
  /** Opens "Your profile" (name, avatar, identity, visibility). */
  onEditProfile?: () => void;
}

/** The Seek sheet: Quick or Custom match, and the chat filters. Profile details live in ProfileEditorSheet. */
export const MatchSetupModal: React.FC<MatchSetupModalProps> = ({
  initialMode,
  currentPrefs,
  onClose,
  onStartMatching,
  onEditProfile,
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'custom'>(initialMode);
  const [intention, setIntention] = useState<Intention>(currentPrefs.intention || 'friendship');
  const [selectedTopics, setSelectedTopics] = useState<string[]>(currentPrefs.topics || []);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [locationSelection, setLocationSelection] = useState<string[]>(
    currentPrefs.locationSelection?.length ? currentPrefs.locationSelection : ['Anywhere in the Philippines']
  );
  const [applyLocationFilter, setApplyLocationFilter] = useState<boolean>(currentPrefs.applyLocationFilter ?? false);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');

  const [applyGenderExpressionFilter, setApplyGenderExpressionFilter] = useState<boolean>(
    currentPrefs.applyGenderExpressionFilter ?? false
  );
  const [preferredGenderExpressions, setPreferredGenderExpressions] = useState<string[]>(
    currentPrefs.preferredGenderExpressions?.length ? currentPrefs.preferredGenderExpressions : ['Any / No preference']
  );

  // Age: optional for everyone, required to use the age filter.
  const [age, setAge] = useState(currentPrefs.age ? String(currentPrefs.age) : '');
  const [applyAgeFilter, setApplyAgeFilter] = useState<boolean>(currentPrefs.applyAgeFilter ?? false);
  const [ageMin, setAgeMin] = useState(String(currentPrefs.ageMin ?? 18));
  const [ageMax, setAgeMax] = useState(String(currentPrefs.ageMax ?? 35));

  const [isAgeConfirmed, setIsAgeConfirmed] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const handleToggleFilter = (filter: string) => {
    setPreferredGenderExpressions((prev) => togglePreferredFilter(prev, filter));
  };

  const handleResetFilters = () => {
    setPreferredGenderExpressions(['Any / No preference']);
    setApplyGenderExpressionFilter(false);
  };

  const handleSubmit = () => {
    // The full Custom filter set is saved whichever mode runs; Quick just doesn't use it.
    const filters: FilterFields = {
      intention,
      topics: selectedTopics,
      region: formatLocationSummary(locationSelection),
      locationSelection,
      applyLocationFilter,
      applyGenderExpressionFilter,
      preferredGenderExpressions: applyGenderExpressionFilter ? preferredGenderExpressions : ['Any / No preference'],
      age: age.trim() ? Number(age) : undefined,
      applyAgeFilter,
      ageMin: Number(ageMin),
      ageMax: Number(ageMax),
    };

    // Filter switches only matter for a Custom search, so only check them then.
    const checked = activeTab === 'custom' ? filters : { ...filters, applyAgeFilter: false };
    const validation = validateSetupProfile({ displayName: currentPrefs.displayName || 'Sapphic Guest', ...checked }, isAgeConfirmed);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onStartMatching(activeTab, filters);
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
            {isCustom
              ? 'Match on intention, topics, age, location and expression.'
              : 'Meet anyone available right now. Your Custom filters are kept for next time.'}
          </p>
        </div>

        {/* Who you're chatting as: edited in "Your profile", not here. */}
        <section className="flex items-center gap-3 p-3 rounded-2xl bg-ink border border-line">
          <AnimalAvatar avatar={currentPrefs.avatar} seed={currentPrefs.displayName || 'guest'} className="w-10 h-10" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-subtle">Chatting as</p>
            <p className="text-sm font-semibold text-fg truncate">
              {currentPrefs.displayName} <span className="font-normal text-subtle">{currentPrefs.pronouns}</span>
            </p>
          </div>
          {onEditProfile && (
            <button type="button" onClick={onEditProfile} className="btn btn-ghost btn-sm shrink-0">
              <Pencil className="w-3.5 h-3.5" />
              Edit profile
            </button>
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
              <p className="mt-2 text-[12px] text-subtle">
                {selectedTopics.length
                  ? "You'll only match people who picked at least one of these."
                  : 'No topics: you can match anyone who also picked none.'}
              </p>
            </section>

            {/* Age */}
            <section className="card p-4 space-y-3">
              <ToggleRow
                icon={<Cake className="w-4 h-4 text-lavender" />}
                checked={applyAgeFilter}
                onChange={setApplyAgeFilter}
                title="Filter by age"
                hint={applyAgeFilter ? `Ages ${ageMin}–${ageMax}` : 'Any age, 18+'}
              />
              {applyAgeFilter && (
                <div className="pt-3 border-t border-line space-y-2">
                  <div className="flex items-center gap-2">
                    <AgeInput label="Youngest age" value={ageMin} onChange={setAgeMin} invalid={!!errors.ageRange} />
                    <span className="text-subtle text-sm">to</span>
                    <AgeInput label="Oldest age" value={ageMax} onChange={setAgeMax} invalid={!!errors.ageRange} />
                  </div>
                  <p className="text-[12px] text-subtle leading-snug">
                    You'll only match people in this range who added their age, and whose own filter fits you.
                  </p>
                </div>
              )}
            </section>

            {/* Location */}
            <section className="card p-4 space-y-3">
              <ToggleRow
                icon={<MapPin className="w-4 h-4 text-lavender" />}
                checked={applyLocationFilter}
                onChange={setApplyLocationFilter}
                title="Filter by location"
                hint={`Your area: ${formatLocationSummary(locationSelection)}`}
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

        {/* Consent */}
        <section className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-fg">
            <span className="flex-1 min-w-0">
              <span className="block font-medium">Your age</span>
              <span className="block text-[12px] text-subtle mt-0.5">
                Optional. Used only for age filters, never shown to anyone.
              </span>
            </span>
            <AgeInput label="Your age" value={age} onChange={setAge} invalid={!!errors.age} placeholder="18+" />
          </label>
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
