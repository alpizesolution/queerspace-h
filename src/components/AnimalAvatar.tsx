import React from 'react';
import { AvatarAnimal, resolveAvatar } from '../utils/avatar.ts';

interface AnimalAvatarProps {
  /** Saved avatar code ("cat.1.3"). Falls back to one derived from `seed`. */
  avatar?: string;
  seed: string;
  className?: string;
  title?: string;
}

const INK = '#2a1a2e';
const BLUSH = '#f39cbc';
const PINK = '#f5a9c4';

/** Ears and other features drawn behind the head. */
function Back({ animal, fur }: { animal: AvatarAnimal; fur: string }) {
  switch (animal) {
    case 'cat':
      return (
        <>
          <path d="M16 31 L18 12 L31 22 Z" fill={fur} />
          <path d="M48 31 L46 12 L33 22 Z" fill={fur} />
          <path d="M19.5 26 L20.5 17 L27 22 Z" fill={PINK} />
          <path d="M44.5 26 L43.5 17 L37 22 Z" fill={PINK} />
        </>
      );
    case 'bunny':
      return (
        <>
          <ellipse cx="25" cy="15" rx="5" ry="13" fill={fur} />
          <ellipse cx="39" cy="15" rx="5" ry="13" fill={fur} />
          <ellipse cx="25" cy="16" rx="2.4" ry="9" fill={PINK} />
          <ellipse cx="39" cy="16" rx="2.4" ry="9" fill={PINK} />
        </>
      );
    case 'bear':
      return (
        <>
          <circle cx="19" cy="23" r="7" fill={fur} />
          <circle cx="45" cy="23" r="7" fill={fur} />
          <circle cx="19" cy="23" r="3.5" fill={INK} opacity="0.18" />
          <circle cx="45" cy="23" r="3.5" fill={INK} opacity="0.18" />
        </>
      );
    case 'panda':
      return (
        <>
          <circle cx="19" cy="23" r="7" fill={INK} />
          <circle cx="45" cy="23" r="7" fill={INK} />
        </>
      );
    case 'fox':
      return (
        <>
          <path d="M14 33 L17 11 L31 23 Z" fill={fur} />
          <path d="M50 33 L47 11 L33 23 Z" fill={fur} />
          <path d="M18 26 L19 16 L26 22 Z" fill={INK} opacity="0.55" />
          <path d="M46 26 L45 16 L38 22 Z" fill={INK} opacity="0.55" />
        </>
      );
    case 'mouse':
      return (
        <>
          <circle cx="17" cy="22" r="9.5" fill={fur} />
          <circle cx="47" cy="22" r="9.5" fill={fur} />
          <circle cx="17" cy="22" r="5.5" fill={PINK} />
          <circle cx="47" cy="22" r="5.5" fill={PINK} />
        </>
      );
    case 'frog':
      return (
        <>
          <circle cx="23" cy="24" r="7" fill={fur} />
          <circle cx="41" cy="24" r="7" fill={fur} />
        </>
      );
    default:
      return null;
  }
}

/** Face details drawn on top of the head. */
function Face({ animal, fur }: { animal: AvatarAnimal; fur: string }) {
  const blush = (
    <>
      <ellipse cx="21.5" cy="42" rx="3.2" ry="2" fill={BLUSH} opacity="0.55" />
      <ellipse cx="42.5" cy="42" rx="3.2" ry="2" fill={BLUSH} opacity="0.55" />
    </>
  );
  const dotEyes = (
    <>
      <circle cx="26" cy="36" r="2.1" fill={INK} />
      <circle cx="38" cy="36" r="2.1" fill={INK} />
    </>
  );
  const smile = (
    <path d="M29.5 42.5 Q32 45 34.5 42.5" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
  );

  switch (animal) {
    case 'cat':
      return (
        <>
          {dotEyes}
          {blush}
          <path d="M30.6 39.6 L33.4 39.6 L32 41.2 Z" fill={PINK} />
          <path d="M29 42.6 Q30.5 44.2 32 42.4 Q33.5 44.2 35 42.6" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
      );
    case 'bunny':
      return (
        <>
          {dotEyes}
          {blush}
          <ellipse cx="32" cy="40.4" rx="1.6" ry="1.1" fill={PINK} />
          <path d="M32 41.4 L32 43 M30.2 43.6 Q32 44.6 33.8 43.6" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
      );
    case 'bear':
      return (
        <>
          {dotEyes}
          {blush}
          <ellipse cx="32" cy="43" rx="7" ry="5" fill="#fff" opacity="0.45" />
          <ellipse cx="32" cy="41.2" rx="2.3" ry="1.6" fill={INK} />
          <path d="M30.2 44.2 Q32 45.6 33.8 44.2" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
      );
    case 'panda':
      return (
        <>
          <ellipse cx="25.5" cy="36.5" rx="4.4" ry="5.2" fill={INK} transform="rotate(-18 25.5 36.5)" />
          <ellipse cx="38.5" cy="36.5" rx="4.4" ry="5.2" fill={INK} transform="rotate(18 38.5 36.5)" />
          <circle cx="26" cy="36" r="1.5" fill="#fff" />
          <circle cx="38" cy="36" r="1.5" fill="#fff" />
          {blush}
          <ellipse cx="32" cy="41.4" rx="2" ry="1.4" fill={INK} />
          {smile}
        </>
      );
    case 'fox':
      return (
        <>
          <path d="M14.5 38 Q32 30 49.5 38 Q46 53 32 54 Q18 53 14.5 38 Z" fill="#fff8f2" />
          {dotEyes}
          {blush}
          <ellipse cx="32" cy="41.6" rx="2" ry="1.4" fill={INK} />
          {smile}
        </>
      );
    case 'dog':
      return (
        <>
          <ellipse cx="15.5" cy="37" rx="5.5" ry="11" fill={fur} transform="rotate(18 15.5 37)" />
          <ellipse cx="48.5" cy="37" rx="5.5" ry="11" fill={fur} transform="rotate(-18 48.5 37)" />
          <ellipse cx="15.5" cy="37" rx="5.5" ry="11" fill={INK} opacity="0.2" transform="rotate(18 15.5 37)" />
          <ellipse cx="48.5" cy="37" rx="5.5" ry="11" fill={INK} opacity="0.2" transform="rotate(-18 48.5 37)" />
          {dotEyes}
          {blush}
          <ellipse cx="32" cy="41" rx="2.6" ry="1.8" fill={INK} />
          <path d="M32 42.6 L32 44 M32 44 Q32 47 34 46" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M32 44 Q32.4 47.6 34.2 47" fill={PINK} />
        </>
      );
    case 'mouse':
      return (
        <>
          {dotEyes}
          {blush}
          <circle cx="32" cy="40.6" r="1.5" fill={PINK} />
          <path d="M24 41 L19 40 M24 43 L19 44 M40 41 L45 40 M40 43 L45 44" stroke={INK} strokeWidth="0.9" opacity="0.5" strokeLinecap="round" />
          {smile}
        </>
      );
    case 'frog':
      return (
        <>
          <circle cx="23" cy="24" r="4" fill="#fff" />
          <circle cx="41" cy="24" r="4" fill="#fff" />
          <circle cx="23.6" cy="24.6" r="2" fill={INK} />
          <circle cx="41.6" cy="24.6" r="2" fill={INK} />
          {blush}
          <path d="M25 40 Q32 46 39 40" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </>
      );
    default:
      return null;
  }
}

/** A cute, minimal animal face in a round badge. Size it with className (w-/h-). */
export const AnimalAvatar: React.FC<AnimalAvatarProps> = ({ avatar, seed, className = 'w-10 h-10', title }) => {
  const { animal, fur, bg } = resolveAvatar(avatar, seed);
  return (
    <svg
      viewBox="0 0 64 64"
      className={`rounded-full shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="32" cy="32" r="32" fill={bg} />
      <Back animal={animal} fur={fur} />
      <ellipse cx="32" cy="38" rx="18" ry="16.5" fill={fur} />
      <Face animal={animal} fur={fur} />
    </svg>
  );
};
