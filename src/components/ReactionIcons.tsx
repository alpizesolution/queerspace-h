import React from 'react';
import type { UnsaidReaction } from '../services/unsaidService.ts';

/**
 * Line-art versions of the six Echoes reactions (Confessions and Vents). They stand in for the emoji glyphs only: the ids,
 * order and meaning of every reaction are unchanged (see REACTIONS in UnsaidView.tsx). One thin stroke in currentColor, no
 * fills, so the colour comes from the button (muted at rest, accent when chosen, and both follow the light/dark theme).
 *
 *   hugs 🫂   same 🤍   felt 🥺   strong 💪   proud 🌈   cry 😭 (Crygago)
 */
export const REACTION_ICON_PX = 20;

type Drawing = { viewBox: string; strokeWidth: number; paths: React.ReactNode };

const DRAWINGS: Record<UnsaidReaction, Drawing> = {
  // Two people holding each other: heads, shoulders, arms wrapping round the back.
  hugs: {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    paths: (
      <>
        <circle cx="8.2" cy="6" r="2.4" />
        <circle cx="15.8" cy="6" r="2.4" />
        <path d="M3.6 20v-3.2c0-2.3 1.6-4 3.8-4.2" />
        <path d="M20.4 20v-3.2c0-2.3-1.6-4-3.8-4.2" />
        <path d="M7.6 12.7c2.6.2 5.6 1.9 8.6 4.6" />
        <path d="M16.4 12.7c-2.6.2-5.6 1.9-8.6 4.6" />
      </>
    ),
  },
  // The white heart.
  same: {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    paths: <path d="M12 20.2s-7.7-4.5-7.7-10.4A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.7 2.7c0 5.9-7.7 10.4-7.7 10.4z" />,
  },
  // The pleading face: big eyes, worried brows, small wobbly mouth.
  felt: {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="8.7" cy="11" r="2" />
        <circle cx="15.3" cy="11" r="2" />
        <path d="M6.2 7.9l3.4-1.3M17.8 7.9l-3.4-1.3" />
        <path d="M10 16.6c.7-.6 1.3-.6 2 0s1.3.6 2 0" />
      </>
    ),
  },
  // A flexed arm: the fist up top, the bicep rising as a dome with its crease.
  strong: {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    paths: (
      <>
        <circle cx="15.6" cy="5.8" r="3.2" />
        <path d="M14.4 6.3h2.4" />
        <path d="M3.9 19.6C2.8 14.4 5.6 9.9 10.5 9.6c.7 0 1.3.1 1.8.4" />
        <path d="M12.9 9.6c-.5-.9-.6-1.9-.3-2.8" />
        <path d="M17.7 8.8c1.5 3 1.2 6.4-1 8.8-1.3 1.3-2.9 1.9-4.7 1.9H3.9" />
        <path d="M7 15.8c1.5-2 4.1-2.5 5.8-.9" />
      </>
    ),
  },
  // A rainbow.
  proud: {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    paths: (
      <>
        <path d="M2.8 18a9.2 9.2 0 0 1 18.4 0" />
        <path d="M6.1 18a5.9 5.9 0 0 1 11.8 0" />
        <path d="M9.4 18a2.6 2.6 0 0 1 5.2 0" />
      </>
    ),
  },
  // Crygago, traced over the custom artwork (public/emoji/cry.webp, 96x96): the round face, the worried brows, both hands
  // over the eyes. Drawn in the artwork's own coordinates; the weight is tuned so it still reads at 20px.
  cry: {
    viewBox: '0 0 96 96',
    strokeWidth: 5,
    paths: (
      <>
        <path d="M12 76A44 44 0 1 1 84 72" />
        <path d="M16 36C22 29 32 25 46 25" />
        <path d="M64 24C72 24 80 28 85 34" />
        <path d="M24 90C16 74 18 56 30 47C35 43 41 44 44 48C49 41 57 38 64 41C70 37 78 40 80 46L84 70" />
        <path d="M54 52L53 68M65 49L65 66" />
      </>
    ),
  },
};

export const ReactionIcon: React.FC<{ type: UnsaidReaction; className?: string }> = ({ type, className = '' }) => {
  const { viewBox, strokeWidth, paths } = DRAWINGS[type];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={viewBox}
      width={REACTION_ICON_PX}
      height={REACTION_ICON_PX}
      className={`block shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths}
    </svg>
  );
};
