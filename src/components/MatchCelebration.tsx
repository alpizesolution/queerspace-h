import React, { useEffect } from 'react';
import { AnimalAvatar } from './AnimalAvatar.tsx';

/** How long the celebration stays before revealing the chat. Tapping skips it. */
export const MATCH_CELEBRATION_MS = 2200;

const PARTICLES = ['💗', '✨', '🐾', '💜', '🌸', '✨', '💗', '🐾', '💜', '✨', '🌸', '💗'];

interface MatchCelebrationProps {
  me: { avatar?: string; seed: string };
  partner: { avatar?: string; seed: string; name: string };
  onDone: () => void;
}

/** "You matched!" moment: both avatars glide together, a heart pops and petals burst out. */
export const MatchCelebration: React.FC<MatchCelebrationProps> = ({ me, partner, onDone }) => {
  useEffect(() => {
    const timer = window.setTimeout(onDone, MATCH_CELEBRATION_MS);
    navigator.vibrate?.([25, 60, 25]);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      role="status"
      aria-live="assertive"
      onClick={onDone}
      className="match-celebration absolute inset-0 z-50 flex flex-col items-center justify-center bg-ink/85 backdrop-blur-md cursor-pointer"
    >
      <div className="relative flex items-center justify-center h-32 w-64">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="match-particle absolute text-lg"
            style={{ '--angle': `${(360 / PARTICLES.length) * i}deg`, '--delay': `${420 + (i % 4) * 40}ms` } as React.CSSProperties}
          >
            {p}
          </span>
        ))}
        <div className="match-avatar-left absolute rounded-full ring-4 ring-ink shadow-xl shadow-berry/20">
          <AnimalAvatar avatar={me.avatar} seed={me.seed} className="w-24 h-24" />
        </div>
        <div className="match-avatar-right absolute rounded-full ring-4 ring-ink shadow-xl shadow-berry/20">
          <AnimalAvatar avatar={partner.avatar} seed={partner.seed} className="w-24 h-24" />
        </div>
        <span aria-hidden="true" className="match-heart absolute z-10 w-10 h-10 rounded-full bg-berry text-ink flex items-center justify-center text-xl shadow-lg shadow-berry/40">
          ♥
        </span>
      </div>
      <p className="match-title mt-6 font-serif text-[length:calc(30px_*_var(--fs,1))] font-semibold text-fg">You matched!</p>
      <p className="match-subtitle mt-1 text-[length:calc(14px_*_var(--fs,1))] text-muted">
        Say hi to <span className="text-berry font-medium">{partner.name}</span>
      </p>
    </div>
  );
};
