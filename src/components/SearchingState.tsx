import React, { useEffect, useState } from 'react';
import { Heart, Shield, RefreshCw } from 'lucide-react';
import { UserPreferences } from '../types.ts';
import { ageRangeFromPrefs, joinLiveMatchQueue, LiveMatch, queueMatchFields } from '../services/liveMatchService.ts';
import { startSearchAttempt } from '../utils/search-attempt.ts';

interface SearchingStateProps {
  mode: 'quick' | 'custom';
  prefs: UserPreferences;
  onCancel: () => void;
  onMatched: (match: LiveMatch) => void;
  blockedPartnerIds: string[];
}

const SEARCH_WINDOW_S = 30;

export const SearchingState: React.FC<SearchingStateProps> = ({
  mode,
  prefs,
  onCancel,
  onMatched,
  blockedPartnerIds,
}) => {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait in the live queue for up to SEARCH_WINDOW_S seconds per attempt.
  useEffect(() => {
    setSecondsElapsed(0);
    setSearchTimedOut(false);
    setError(null);

    return startSearchAttempt({
      join: (onError) => joinLiveMatchQueue(blockedPartnerIds, { onMatched, onError }, queueMatchFields(prefs), ageRangeFromPrefs(prefs)),
      windowSeconds: SEARCH_WINDOW_S,
      onTick: setSecondsElapsed,
      onTimeout: () => setSearchTimedOut(true),
      onError: setError,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const handleKeepSearching = () => setAttempt((n) => n + 1);
  const stopped = searchTimedOut || Boolean(error);

  const progress = Math.min(secondsElapsed / SEARCH_WINDOW_S, 1) * 100;

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full text-center anim-rise" aria-live="polite">
        <div className="relative w-28 h-28 mx-auto mb-8 flex items-center justify-center">
          {!stopped && (
            <>
              <span className="absolute inset-0 rounded-full bg-berry/25 anim-ping" />
              <span className="absolute inset-0 rounded-full bg-berry/15 anim-ping [animation-delay:0.9s]" />
            </>
          )}
          <span className="relative w-20 h-20 rounded-full bg-raised border border-line flex items-center justify-center">
            <Heart className={`w-8 h-8 ${stopped ? 'text-subtle' : 'text-berry fill-berry/30'}`} />
          </span>
        </div>

        <h1 className="text-2xl font-semibold text-fg">
          {error
            ? "Couldn't connect"
            : searchTimedOut
            ? "No one's around yet"
            : mode === 'quick'
              ? 'Finding someone…'
              : 'Finding your match…'}
        </h1>
        <p className="mt-2 text-[length:calc(15px_*_var(--fs,1))] text-muted">
          {error
            ? error
            : searchTimedOut
            ? 'Try again in a moment, or drop by Galaxy.'
            : (
              <>
                Chatting as <span className="text-fg font-medium">{prefs.displayName}</span> ({prefs.pronouns})
              </>
            )}
        </p>

        {!stopped && (
          <div
            className="mt-8 h-1 rounded-full bg-raised overflow-hidden"
            role="progressbar"
            aria-label="Search progress"
            aria-valuemin={0}
            aria-valuemax={SEARCH_WINDOW_S}
            aria-valuenow={secondsElapsed}
          >
            <div className="h-full bg-berry/70 rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="mt-8 flex flex-col gap-2">
          {stopped && (
            <button onClick={handleKeepSearching} className="btn btn-primary w-full">
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          )}
          <button onClick={onCancel} className="btn btn-ghost w-full">
            Cancel
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[length:calc(13px_*_var(--fs,1))] text-subtle">
          <Shield className="w-3.5 h-3.5" />
          Anonymous and protected
        </p>
      </div>
    </div>
  );
};
