import React from 'react';
import { RadioTower } from 'lucide-react';

// Small, fixed points of starlight around the signal.
const STARS = [
  { top: 8, left: 14, size: 2 },
  { top: 22, left: 84, size: 3 },
  { top: 64, left: 6, size: 2 },
  { top: 78, left: 90, size: 2 },
  { top: 40, left: 96, size: 1.5 },
  { top: 92, left: 30, size: 1.5 },
];

/**
 * Signals is intentionally a visual placeholder until the consent and inbox
 * flow is implemented. Keep the state clear; do not imply that messaging works.
 */
export const SignalsView: React.FC = () => (
  <section
    aria-labelledby="signals-title"
    className="relative mx-auto flex min-h-[min(620px,calc(100dvh-9rem))] w-full max-w-xl flex-col items-center justify-center px-6 py-10 text-center anim-rise [@media(max-height:640px)]:py-4"
  >
    <div
      className="relative mb-8 h-32 w-32 [@media(max-height:640px)]:mb-5 [@media(max-height:640px)]:h-24 [@media(max-height:640px)]:w-24"
      aria-hidden="true"
    >
      {STARS.map((star, index) => (
        <span
          key={index}
          className="absolute rounded-full bg-lavender/70"
          style={{
            top: `${star.top}%`,
            left: `${star.left}%`,
            width: star.size,
            height: star.size,
          }}
        />
      ))}
      <span className="absolute inset-5 rounded-full border border-lavender/20 [@media(max-height:640px)]:inset-3" />
      {[0, 0.8, 1.6].map((delay) => (
        <span
          key={delay}
          className="absolute inset-5 rounded-full border border-berry/35 anim-ping [@media(max-height:640px)]:inset-3"
          style={{ animationDelay: `${delay}s`, animationDuration: '3s' }}
        />
      ))}
      <span className="absolute inset-9 flex items-center justify-center rounded-full border border-line bg-raised text-berry shadow-[0_0_42px_rgb(224_123_184_/_0.22)] [@media(max-height:640px)]:inset-6">
        <RadioTower className="h-7 w-7" strokeWidth={1.6} />
      </span>
    </div>

    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-lavender sm:text-[11px]">
      A private frequency
    </p>
    <h1
      id="signals-title"
      className="mt-3 max-w-md text-balance font-serif text-[38px] font-semibold leading-[1.04] tracking-tight text-fg sm:text-5xl [@media(max-height:640px)]:mt-2 [@media(max-height:640px)]:text-[32px]"
    >
      Let the connection linger.
    </h1>
    <p className="mt-4 max-w-sm text-balance text-sm leading-relaxed text-muted sm:text-[15px]">
      A quieter place to continue a conversation, when the moment feels right.
    </p>

    <div className="mt-7 inline-flex h-8 items-center gap-2 rounded-full border border-berry/30 bg-plum/20 px-3.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-berry [@media(max-height:640px)]:mt-5">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-berry opacity-60 anim-ping" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-berry" />
      </span>
      In the making
    </div>
    <p className="mt-4 max-w-xs text-xs leading-relaxed text-subtle">
      Signals is not available just yet.
    </p>
  </section>
);
