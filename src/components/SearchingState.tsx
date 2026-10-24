import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Sparkles, X, Heart, Shield, RefreshCw } from 'lucide-react';
import { UserPreferences } from '../types.ts';
import { findMatchCandidate, MatchCandidateResult } from '../services/matchmakingService.ts';

interface SearchingStateProps {
  mode: 'quick' | 'custom';
  prefs: UserPreferences;
  onCancel: () => void;
  onMatchFoundFromCandidate: (candidate: any, source: any) => void;
  blockedPartnerIds: string[];
}

export const SearchingState: React.FC<SearchingStateProps> = ({
  mode,
  prefs,
  onCancel,
  onMatchFoundFromCandidate,
  blockedPartnerIds,
}) => {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const [isSearchingQuery, setIsSearchingQuery] = useState(false);
  const searchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const performMatchSearch = useCallback(async () => {
    if (isSearchingQuery || searchTimedOut) return;
    setIsSearchingQuery(true);
    try {
      const result: MatchCandidateResult = await findMatchCandidate(prefs, blockedPartnerIds);
      if (result.candidate) {
        if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        onMatchFoundFromCandidate(result.candidate, result.source);
      }
    } catch (err) {
      console.warn('[SearchingState] Match poll notice:', err);
    } finally {
      setIsSearchingQuery(false);
    }
  }, [prefs, blockedPartnerIds, isSearchingQuery, searchTimedOut, onMatchFoundFromCandidate]);

  useEffect(() => {
    // 1-second ticker for visual counter
    timerRef.current = setInterval(() => {
      setSecondsElapsed((prev) => {
        const next = prev + 1;
        if (next >= 30) {
          setSearchTimedOut(true);
          if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        }
        return next;
      });
    }, 1000);

    // Initial check immediately
    performMatchSearch();

    // Poll every 2 seconds
    searchIntervalRef.current = setInterval(() => {
      performMatchSearch();
    }, 2000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    };
  }, [performMatchSearch]);

  const handleKeepSearching = () => {
    setSearchTimedOut(false);
    setSecondsElapsed(0);
    
    timerRef.current = setInterval(() => {
      setSecondsElapsed((prev) => {
        const next = prev + 1;
        if (next >= 30) {
          setSearchTimedOut(true);
          if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        }
        return next;
      });
    }, 1000);

    searchIntervalRef.current = setInterval(() => {
      performMatchSearch();
    }, 2000);
  };

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
          {searchTimedOut 
            ? 'No Candidates Found Yet' 
            : mode === 'quick' ? 'Connecting to Quick Chat...' : 'Finding a Compatible Match...'}
        </h3>
        <p className="text-sm text-[#BDB0BF] max-w-xs mx-auto mb-6">
          {searchTimedOut
            ? 'We searched for 30 seconds but could not find another active online peer right now.'
            : 'Looking for an active sapphic peer ready to talk freely and respectfully.'}
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
            </>
          )}
          <div className="flex justify-between items-center text-[11px] text-[#C77DAA] pt-1 border-t border-[#403247]">
            <span>Time searching:</span>
            <span className="font-mono font-medium">{secondsElapsed}s / 30s</span>
          </div>
        </div>

        {/* Safety reminder */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#BDB0BF] mb-6">
          <Shield className="w-3.5 h-3.5 text-[#C77DAA]" />
          <span>Anonymous & protected session</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-3">
          {searchTimedOut ? (
            <>
              <button
                onClick={handleKeepSearching}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#C77DAA] hover:bg-[#b06593] text-xs sm:text-sm font-semibold text-[#17121B] transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Keep Searching</span>
              </button>
              <button
                onClick={onCancel}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-[#403247] bg-[#302235] hover:bg-[#3d2c43] text-xs sm:text-sm font-semibold text-[#F7F0F6] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-[#BDB0BF]" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <button
              onClick={onCancel}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full border border-[#403247] bg-[#302235] hover:bg-[#3d2c43] text-xs sm:text-sm font-semibold text-[#F7F0F6] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-[#BDB0BF]" />
              <span>Cancel Search</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
