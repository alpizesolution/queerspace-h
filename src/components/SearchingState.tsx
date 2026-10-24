import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Heart, Shield, RefreshCw } from 'lucide-react';
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

  const progress = Math.min(secondsElapsed / 30, 1) * 100;

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full text-center anim-rise" aria-live="polite">
        <div className="relative w-28 h-28 mx-auto mb-8 flex items-center justify-center">
          {!searchTimedOut && (
            <>
              <span className="absolute inset-0 rounded-full bg-berry/25 anim-ping" />
              <span className="absolute inset-0 rounded-full bg-berry/15 anim-ping [animation-delay:0.9s]" />
            </>
          )}
          <span className="relative w-20 h-20 rounded-full bg-raised border border-line flex items-center justify-center">
            <Heart className={`w-8 h-8 ${searchTimedOut ? 'text-subtle' : 'text-berry fill-berry/30'}`} />
          </span>
        </div>

        <h1 className="text-2xl font-semibold text-fg">
          {searchTimedOut
            ? "No one's around yet"
            : mode === 'quick'
              ? 'Finding someone…'
              : 'Finding your match…'}
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          {searchTimedOut
            ? 'Try again in a moment, or visit the Public Room.'
            : (
              <>
                Chatting as <span className="text-fg font-medium">{prefs.displayName}</span> ({prefs.pronouns})
              </>
            )}
        </p>

        {!searchTimedOut && (
          <div
            className="mt-8 h-1 rounded-full bg-raised overflow-hidden"
            role="progressbar"
            aria-label="Search progress"
            aria-valuemin={0}
            aria-valuemax={30}
            aria-valuenow={secondsElapsed}
          >
            <div className="h-full bg-berry/70 rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="mt-8 flex flex-col gap-2">
          {searchTimedOut && (
            <button onClick={handleKeepSearching} className="btn btn-primary w-full">
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          )}
          <button onClick={onCancel} className="btn btn-ghost w-full">
            Cancel
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-subtle">
          <Shield className="w-3.5 h-3.5" />
          Anonymous and protected
        </p>
      </div>
    </div>
  );
};
