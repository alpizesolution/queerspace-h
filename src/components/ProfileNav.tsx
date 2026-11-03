import React, { createContext, useContext } from 'react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { isMemberId } from '../utils/profileView.ts';

/** Lets any avatar open a member's profile without passing a handler through every screen. */
const ProfileNavContext = createContext<{ openProfile: (memberId: string) => void; openPost: (postId: string) => void } | null>(null);

export const ProfileNavProvider = ProfileNavContext.Provider;

/** The function that opens a member's profile, or null where there is no app around to do it. */
export const useOpenProfile = (): ((memberId: string) => void) | null => useContext(ProfileNavContext)?.openProfile ?? null;

/** The function that opens one Cosmos post, or null where there is no app around to do it. */
export const useOpenPost = (): ((postId: string) => void) | null => useContext(ProfileNavContext)?.openPost ?? null;

/**
 * An avatar that opens the member's profile when tapped. Where no profile can be opened (no id, or no app around it) it is
 * the plain avatar, so it is safe to use anywhere an author's avatar appears.
 */
export const MemberAvatar: React.FC<{
  memberId?: string | null;
  avatar?: string | null;
  seed: string;
  name?: string;
  className?: string;
}> = ({ memberId, avatar, seed, name, className = 'w-10 h-10' }) => {
  const nav = useContext(ProfileNavContext);
  const art = <AnimalAvatar avatar={avatar ?? undefined} seed={seed} className={className} />;
  if (!nav || !isMemberId(memberId)) return art;
  return (
    <button
      type="button"
      onClick={() => nav.openProfile(memberId)}
      aria-label={name ? `View ${name}’s profile` : 'View profile'}
      className="shrink-0 rounded-full transition-transform active:scale-95 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 cursor-pointer"
    >
      {art}
    </button>
  );
};
