import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Zap,
  Sliders,
  Dices,
  Info,
  Check,
  Plus,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Heart,
  Lock,
  RotateCcw,
  SlidersHorizontal,
  MapPin,
} from 'lucide-react';
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

  const [sogieSectionOpen, setSogieSectionOpen] = useState<boolean>(true);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#241B29] rounded-3xl border border-[#403247] max-w-xl w-full my-auto shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#17121B] border-b border-[#403247] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl overflow-hidden bg-[#302235] flex items-center justify-center border border-[#403247]">
              <img src="/assets/aistudio/queerspace_cbcdbe4c.png" alt="QUEERSPACE Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-[#F7F0F6]">
                Start Your Conversation
              </h3>
              <p className="text-xs text-[#BDB0BF]">
                Low-friction, anonymous sapphic matching
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#302235] text-[#BDB0BF] hover:text-[#F7F0F6] transition-colors cursor-pointer"
            aria-label="Close setup modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Mode Selector */}
        <div className="p-4 bg-[#241B29] border-b border-[#403247]">
          <div className="grid grid-cols-2 p-1 bg-[#17121B] rounded-2xl border border-[#403247]">
            <button
              type="button"
              onClick={() => setActiveTab('quick')}
              className={`py-2 px-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'quick'
                  ? 'bg-[#302235] text-[#F7F0F6] shadow-xs border border-[#403247]'
                  : 'text-[#BDB0BF] hover:text-[#F7F0F6]'
              }`}
            >
              <Zap className="w-4 h-4 text-[#C77DAA]" />
              <span>Quick Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('custom')}
              className={`py-2 px-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'custom'
                  ? 'bg-[#302235] text-[#F7F0F6] shadow-xs border border-[#403247]'
                  : 'text-[#BDB0BF] hover:text-[#F7F0F6]'
              }`}
            >
              <Sliders className="w-4 h-4 text-[#C77DAA]" />
              <span>Custom Match</span>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Persona (Display Name & Pronouns) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                Your Persona (Optional)
              </label>
              <button
                type="button"
                onClick={handleRandomizeIdentity}
                className="text-xs text-[#C77DAA] hover:text-[#F7F0F6] font-medium flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Dices className="w-3.5 h-3.5" />
                <span>Random Pseudonym</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Lavender Lark"
                  maxLength={25}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#403247] bg-[#17121B] text-sm text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA] focus:ring-1 focus:ring-[#C77DAA]"
                />
                {errors.displayName && (
                  <p className="text-[11px] text-red-400 mt-1">{errors.displayName}</p>
                )}
              </div>
              <div>
                <select
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#403247] bg-[#17121B] text-sm text-[#F7F0F6] focus:outline-none focus:border-[#C77DAA]"
                >
                  {PRONOUN_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Custom pronouns if selected */}
            {pronouns === 'Self-described' && (
              <div className="pt-1">
                <input
                  type="text"
                  value={customPronouns}
                  onChange={(e) => setCustomPronouns(e.target.value)}
                  placeholder="Enter your pronouns (e.g. fae/faer, ze/hir)..."
                  maxLength={30}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#403247] bg-[#17121B] text-xs text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
                />
              </div>
            )}
          </div>

          {/* SOGIE & Gender Expression Profile Attributes (Optional) */}
          <div className="rounded-2xl border border-[#403247] bg-[#17121B] overflow-hidden">
            <button
              type="button"
              onClick={() => setSogieSectionOpen(!sogieSectionOpen)}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-[#302235]/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-[#C77DAA]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                  Gender Expression & SOGIE (Optional)
                </span>
                <span className="text-[10px] text-[#C77DAA] bg-[#302235] px-2 py-0.5 rounded-full border border-[#403247]">
                  Your Choice
                </span>
              </div>
              {sogieSectionOpen ? (
                <ChevronUp className="w-4 h-4 text-[#BDB0BF]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#BDB0BF]" />
              )}
            </button>

            {sogieSectionOpen && (
              <div className="p-4 pt-1 space-y-4 border-t border-[#403247]/60 text-xs">
                <p className="text-[11px] text-[#BDB0BF] leading-relaxed">
                  Share as much or as little as you feel comfortable with. These fields are completely optional and help you feel represented.
                </p>

                {/* 1. Gender Expression Field */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-[#F7F0F6]">
                      Gender Expression (Multi-select)
                    </label>
                    <span className="text-[10px] text-[#BDB0BF]">
                      {genderExpression.length > 0 ? `${genderExpression.length} chosen` : 'None selected'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {GENDER_EXPRESSIONS.map((expr) => {
                      const isSelected = genderExpression.includes(expr);
                      return (
                        <button
                          key={expr}
                          type="button"
                          onClick={() => handleToggleExpr(expr)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? 'bg-[#8E547E] text-white border border-[#C77DAA] shadow-xs'
                              : 'bg-[#241B29] text-[#BDB0BF] border border-[#403247] hover:border-[#C77DAA] hover:text-[#F7F0F6]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-[#C77DAA]" />}
                          <span>{expr}</span>
                        </button>
                      );
                    })}
                  </div>
                  {errors.genderExpression && (
                    <p className="text-[11px] text-red-400">{errors.genderExpression}</p>
                  )}
                </div>

                {/* 2. SOGIE Identity Fields (Sexual Orientation & Gender Identity) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-semibold text-[#F7F0F6] mb-1">
                      Sexual Orientation
                    </label>
                    <select
                      value={sexualOrientation}
                      onChange={(e) => setSexualOrientation(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#403247] bg-[#241B29] text-xs text-[#F7F0F6] focus:outline-none focus:border-[#C77DAA]"
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
                        placeholder="Describe your orientation..."
                        maxLength={40}
                        className="w-full mt-1.5 px-3 py-1.5 rounded-xl border border-[#403247] bg-[#241B29] text-xs text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block font-semibold text-[#F7F0F6] mb-1">
                      Gender Identity
                    </label>
                    <select
                      value={genderIdentity}
                      onChange={(e) => setGenderIdentity(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#403247] bg-[#241B29] text-xs text-[#F7F0F6] focus:outline-none focus:border-[#C77DAA]"
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
                        placeholder="Describe your gender identity..."
                        maxLength={40}
                        className="w-full mt-1.5 px-3 py-1.5 rounded-xl border border-[#403247] bg-[#241B29] text-xs text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
                      />
                    )}
                  </div>
                </div>

                {/* 3. Privacy & Visibility Controls */}
                <div className="p-3 rounded-xl bg-[#241B29] border border-[#403247] space-y-2 mt-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#F7F0F6]">
                    <Lock className="w-3.5 h-3.5 text-[#C77DAA]" />
                    <span>Profile Visibility & Consent</span>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer text-[11px] text-[#BDB0BF]">
                    <input
                      type="checkbox"
                      checked={showGenderExpressionOnProfile}
                      onChange={(e) => setShowGenderExpressionOnProfile(e.target.checked)}
                      className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
                    />
                    <span>
                      Display my gender expression badge on my 1-on-1 chat profile card (otherwise used matching-only).
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer text-[11px] text-[#BDB0BF]">
                    <input
                      type="checkbox"
                      checked={showSogieOnProfile}
                      onChange={(e) => setShowSogieOnProfile(e.target.checked)}
                      className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
                    />
                    <span>
                      Display my SOGIE identity on my 1-on-1 chat profile card.
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {activeTab === 'quick' ? (
            /* Quick Chat Info banner */
            <div className="bg-[#302235] rounded-2xl p-4 border border-[#403247] space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#F7F0F6]">
                <Zap className="w-4 h-4 text-[#C77DAA]" />
                <span>Instant 1-on-1 Conversation</span>
              </div>
              <p className="text-xs text-[#BDB0BF] leading-relaxed">
                Quick chat connects you with the first available sapphic participant without filtering by specific intentions or topics. Perfect for when you just want to talk.
              </p>
            </div>
          ) : (
            /* Custom Match Options */
            <>
              {/* Customizable Discovery Filters (Gender Expression Preferences) */}
              <div className="p-4 rounded-2xl bg-[#17121B] border border-[#403247] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-[#C77DAA]" />
                    <label className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                      Matching Discovery Filter
                    </label>
                  </div>
                  {applyGenderExpressionFilter && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="text-[11px] text-[#C77DAA] hover:text-[#F7F0F6] flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>

                <label className="flex items-start gap-2 cursor-pointer text-xs text-[#F7F0F6]">
                  <input
                    type="checkbox"
                    checked={applyGenderExpressionFilter}
                    onChange={(e) => setApplyGenderExpressionFilter(e.target.checked)}
                    className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
                  />
                  <span>Filter partners by gender expression preference</span>
                </label>

                {applyGenderExpressionFilter && (
                  <div className="space-y-2 pt-2 border-t border-[#403247]/60">
                    <p className="text-[11px] text-[#BDB0BF]">
                      Select which gender expressions you'd love to meet today:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {DISCOVERY_FILTER_OPTIONS.map((filter) => {
                        const isSelected = preferredGenderExpressions.includes(filter);
                        return (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => handleToggleFilter(filter)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-[#8E547E] text-white border border-[#C77DAA] shadow-xs'
                                : 'bg-[#241B29] text-[#BDB0BF] border border-[#403247] hover:border-[#C77DAA] hover:text-[#F7F0F6]'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 text-[#C77DAA]" />}
                            <span>{filter}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-[#BDB0BF]/70 italic">
                  Queerspace only filters when enabled. Users with “Prefer not to say” are never excluded or penalized.
                </p>
              </div>

              {/* Intention */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                  What are you hoping for today?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(INTENTION_LABELS) as Intention[]).map((key) => {
                    const isSelected = intention === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setIntention(key)}
                        className={`p-2.5 rounded-xl text-xs font-medium text-left border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#8E547E] text-white border-[#C77DAA] shadow-xs'
                            : 'bg-[#17121B] text-[#BDB0BF] border-[#403247] hover:border-[#8E547E] hover:text-[#F7F0F6]'
                        }`}
                      >
                        {INTENTION_LABELS[key]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Topics / Interests */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                    Shared Topics & Interests
                  </label>
                  <span className="text-[11px] text-[#BDB0BF]">
                    {selectedTopics.length}/8 selected
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_TOPICS.map((topic) => {
                    const isSelected = selectedTopics.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => handleToggleTopic(topic)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-[#8E547E] text-white shadow-xs'
                            : 'bg-[#17121B] text-[#BDB0BF] border border-[#403247] hover:border-[#C77DAA] hover:text-[#F7F0F6]'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-[#C77DAA]" />}
                        <span>{topic}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Custom topic input */}
                <form onSubmit={handleAddCustomTopic} className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={customTopicInput}
                    onChange={(e) => setCustomTopicInput(e.target.value)}
                    placeholder="Add custom topic (e.g. Fleabag, Stardew Valley)..."
                    maxLength={25}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#403247] bg-[#17121B] text-xs text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
                  />
                  <button
                    type="submit"
                    disabled={!customTopicInput.trim() || selectedTopics.length >= 8}
                    className="px-3.5 py-2 rounded-xl bg-[#302235] hover:bg-[#8E547E] text-[#C77DAA] hover:text-white disabled:opacity-40 text-xs font-semibold flex items-center gap-1 transition-colors border border-[#403247] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </form>
              </div>

              {/* Philippines Broad Location Preferences & Discovery Filter */}
              <div className="p-4 rounded-2xl bg-[#17121B] border border-[#403247] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#C77DAA]" />
                    <label className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
                      Philippine Location Preference
                    </label>
                  </div>
                  <span className="text-[11px] text-[#C77DAA] bg-[#302235] px-2 py-0.5 rounded-full border border-[#403247]">
                    {formatLocationSummary(locationSelection)}
                  </span>
                </div>

                <label className="flex items-start gap-2 cursor-pointer text-xs text-[#F7F0F6]">
                  <input
                    type="checkbox"
                    checked={applyLocationFilter}
                    onChange={(e) => setApplyLocationFilter(e.target.checked)}
                    className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
                  />
                  <span>Filter matching partners by specific Philippine locations</span>
                </label>

                {applyLocationFilter && (
                  <div className="space-y-3 pt-2 border-t border-[#403247]/60">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-[#BDB0BF]">
                        Select Nationwide, Island Groups, Regions, or Cities:
                      </p>
                      <button
                        type="button"
                        onClick={() => setLocationSelection(['Anywhere in the Philippines'])}
                        className="text-[10px] text-[#C77DAA] hover:underline cursor-pointer"
                      >
                        Reset to Nationwide
                      </button>
                    </div>

                    <input
                      type="text"
                      value={locationSearchQuery}
                      onChange={(e) => setLocationSearchQuery(e.target.value)}
                      placeholder="Search region, province, city (e.g. Metro Manila, Cebu, Davao)..."
                      className="w-full px-3 py-2 rounded-xl bg-[#241B29] border border-[#403247] text-xs text-[#F7F0F6] placeholder-[#BDB0BF]/50 focus:outline-none focus:border-[#C77DAA]"
                    />

                    {/* Quick Island Groups / Nationwide buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setLocationSelection(['Anywhere in the Philippines'])}
                        className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                          locationSelection.includes('Anywhere in the Philippines')
                            ? 'bg-[#8E547E] text-white border border-[#C77DAA]'
                            : 'bg-[#241B29] text-[#BDB0BF] border border-[#403247]'
                        }`}
                      >
                        🌐 Nationwide (Anywhere in PH)
                      </button>
                      {PHILIPPINE_ISLAND_GROUPS.map((ig) => {
                        const isSelected = locationSelection.includes(ig);
                        return (
                          <button
                            key={ig}
                            type="button"
                            onClick={() => {
                              const next = toggleLocationPreference(locationSelection, ig);
                              setLocationSelection(next);
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                              isSelected
                                ? 'bg-[#8E547E] text-white border border-[#C77DAA]'
                                : 'bg-[#241B29] text-[#BDB0BF] border border-[#403247]'
                            }`}
                          >
                            🌴 {ig}
                          </button>
                        );
                      })}
                    </div>

                    {/* Filtered Regions & Cities list */}
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1 text-xs">
                      {PHILIPPINE_REGIONS_AND_LOCATIONS.map((group) => {
                        const matchesGroup =
                          !locationSearchQuery ||
                          group.region.toLowerCase().includes(locationSearchQuery.toLowerCase()) ||
                          group.provincesAndCities.some((p) =>
                            p.toLowerCase().includes(locationSearchQuery.toLowerCase())
                          );

                        if (!matchesGroup) return null;

                        const isRegionSelected = locationSelection.includes(group.region);

                        return (
                          <div key={group.region} className="p-2.5 rounded-xl bg-[#241B29] border border-[#403247] space-y-1.5">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = toggleLocationPreference(locationSelection, group.region);
                                  setLocationSelection(next);
                                }}
                                className={`font-bold text-left text-[#F7F0F6] hover:text-[#C77DAA] cursor-pointer ${
                                  isRegionSelected ? 'text-[#C77DAA]' : ''
                                }`}
                              >
                                {group.region}
                              </button>
                              <span className="text-[10px] text-[#BDB0BF]">{group.islandGroup}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 pt-1">
                              {group.provincesAndCities
                                .filter(
                                  (pc) =>
                                    !locationSearchQuery ||
                                    pc.toLowerCase().includes(locationSearchQuery.toLowerCase()) ||
                                    group.region.toLowerCase().includes(locationSearchQuery.toLowerCase())
                                )
                                .map((pc) => {
                                  const isPcSelected = locationSelection.includes(pc);
                                  return (
                                    <button
                                      key={pc}
                                      type="button"
                                      onClick={() => {
                                        const next = toggleLocationPreference(locationSelection, pc);
                                        setLocationSelection(next);
                                      }}
                                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                                        isPcSelected
                                          ? 'bg-[#C77DAA] text-[#17121B] font-semibold'
                                          : 'bg-[#17121B] text-[#BDB0BF] border border-[#403247] hover:border-[#C77DAA]'
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

                {/* Profile Location Visibility Checkbox */}
                <div className="pt-2 border-t border-[#403247]/60">
                  <label className="flex items-start gap-2 cursor-pointer text-[11px] text-[#BDB0BF]">
                    <input
                      type="checkbox"
                      checked={showLocationOnProfile}
                      onChange={(e) => setShowLocationOnProfile(e.target.checked)}
                      className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
                    />
                    <span>Display my broad location on my 1-on-1 chat profile card.</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* 18+ Age & Eligibility Confirmation */}
          <div className="p-3.5 rounded-2xl bg-[#302235] border border-[#403247]">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#F7F0F6]">
              <input
                type="checkbox"
                checked={isAgeConfirmed}
                onChange={(e) => setIsAgeConfirmed(e.target.checked)}
                className="mt-0.5 accent-[#C77DAA] rounded cursor-pointer"
              />
              <span className="leading-snug">
                I affirm that I am <strong className="text-[#F7F0F6]">18 years of age or older</strong> and identify as a woman or non-binary sapphic person.
              </span>
            </label>
            {errors.ageConfirmation && (
              <p className="text-[11px] text-red-400 font-medium mt-1.5 pl-6">{errors.ageConfirmation}</p>
            )}
          </div>

          {/* Privacy Transparency Callout */}
          <div className="p-3.5 rounded-2xl bg-[#17121B] border border-[#403247] flex gap-2.5 items-start text-xs text-[#BDB0BF] leading-relaxed">
            <Info className="w-4 h-4 text-[#C77DAA] shrink-0 mt-0.5" />
            <div>
              <strong className="text-[#F7F0F6]">What your match sees:</strong> Only your chosen pseudonym, pronouns, intention, mutual topics, and any expression/SOGIE labels you explicitly toggled on. Private fields are never exposed.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-[#17121B] border-t border-[#403247] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-[#BDB0BF] hover:text-[#F7F0F6] hover:bg-[#302235] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-full bg-[#C77DAA] hover:bg-[#d893bd] text-[#17121B] text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-md transition-all hover:shadow active:scale-[0.98] cursor-pointer"
          >
            <span>{activeTab === 'quick' ? 'Start Quick Chat' : 'Find Custom Match'}</span>
            <ArrowRight className="w-4 h-4 text-[#17121B]" />
          </button>
        </div>
      </div>
    </div>
  );
};
