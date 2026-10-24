import React, { useEffect, useState } from 'react';
import { Sparkles, X, Heart, Shield } from 'lucide-react';
import { UserPreferences } from '../types.ts';

interface SearchingStateProps {
  mode: 'quick' | 'custom';
  prefs: UserPreferences;
  onCancel: () => void;
  onMatchFound: () => void;
}

export const SearchingState: React.FC<SearchingStateProps> = ({
  mode,
  prefs,
  onCancel,
  onMatchFound,
}) => {
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);

    // Realistic matching delay: 2.5 - 3.5 seconds
    const matchTimeout = setTimeout(() => {
      onMatchFound();
    }, 2800);

    return () => {
      clearInterval(timer);
      clearTimeout(matchTimeout);
    };
  }, [onMatchFound]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-[#241B29] rounded-3xl border border-[#403247] p-8 text-center shadow-2xl relative overflow-hidden">
        {/* Soft background pulse */}
        <div className="absolute inset-0 bg-radial from-[#C77DAA]/10 to-transparent pointer-events-none" />

        {/* Radar / pulse animation */}
        <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[#C77DAA]/20 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-[#302235] border border-[#403247]" />
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#302235] to-[#8E547E] text-white flex items-center justify-center shadow-lg border border-[#403247]">
            <Heart className="w-6 h-6 text-[#C77DAA] animate-pulse" />
          </div>
        </div>

        <h3 className="font-serif text-2xl font-bold text-[#F7F0F6] mb-2">
          {mode === 'quick' ? 'Connecting to Quick Chat...' : 'Finding a Compatible Match...'}
        </h3>
        <p className="text-sm text-[#BDB0BF] max-w-xs mx-auto mb-6">
          Looking for an active sapphic peer ready to talk freely and respectfully.
        </p>

        {/* Selected parameters review */}
        <div className="bg-[#17121B] rounded-2xl p-4 border border-[#403247] text-left text-xs text-[#BDB0BF] space-y-2 mb-6">
          <div className="flex justify-between items-center">
            <span>Your Persona:</span>
            <span className="font-semibold text-[#F7F0F6]">{prefs.displayName} ({prefs.pronouns})</span>
          </div>
          {mode === 'custom' && (
            <>
              <div className="flex justify-between items-center">
                <span>Looking for:</span>
                <span className="font-semibold text-[#C77DAA] capitalize">{prefs.intention.replace('_', ' ')}</span>
              </div>
              {prefs.topics.length > 0 && (
                <div className="flex justify-between items-start gap-2">
                  <span>Topics:</span>
                  <span className="font-medium text-[#F7F0F6] text-right truncate max-w-[180px]">
                    {prefs.topics.join(', ')}
                  </span>
                </div>
              )}
              {prefs.applyGenderExpressionFilter &&
                prefs.preferredGenderExpressions &&
                prefs.preferredGenderExpressions.length > 0 &&
                !prefs.preferredGenderExpressions.includes('Any / No preference') && (
                  <div className="flex justify-between items-center">
                    <span>Expression Filter:</span>
                    <span className="font-semibold text-[#C77DAA] truncate max-w-[170px]">
                      {prefs.preferredGenderExpressions.join(', ')}
                    </span>
                  </div>
                )}
            </>
          )}
          <div className="flex justify-between items-center text-[11px] text-[#C77DAA] pt-1 border-t border-[#403247]">
            <span>Time searching:</span>
            <span className="font-mono font-medium">{secondsElapsed}s</span>
          </div>
        </div>

        {/* Safety reminder */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#BDB0BF] mb-6">
          <Shield className="w-3.5 h-3.5 text-[#C77DAA]" />
          <span>Anonymous & protected session</span>
        </div>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full border border-[#403247] bg-[#302235] hover:bg-[#3d2c43] text-xs sm:text-sm font-semibold text-[#F7F0F6] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4 text-[#BDB0BF]" />
          <span>Cancel Search</span>
        </button>
      </div>
    </div>
  );
};
