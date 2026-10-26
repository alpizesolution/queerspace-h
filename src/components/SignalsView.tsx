import React from 'react';
import { RadioTower } from 'lucide-react';

// A few fixed specks of starlight around the beacon (percent positions, size in px).
const STARS = [
  { top: 8, left: 14, size: 2 },
  { top: 22, left: 84, size: 3 },
  { top: 64, left: 6, size: 2 },
  { top: 78, left: 90, size: 2 },
  { top: 40, left: 96, size: 1.5 },
  { top: 92, left: 30, size: 1.5 },
];

/** Placeholder for the future private inbox: no data, no listeners, nothing to tap. */
export const SignalsView: React.FC = () => (
  <section className="relative max-w-xl mx-auto w-full px-6 pt-12 sm:pt-20 pb-12 flex flex-col items-center text-center anim-rise">
    <div className="relative w-36 h-36 mb-8" aria-hidden="true">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-lavender/70"
          style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.size, height: s.size }}
        />
      ))}
      {/* Rings pulsing outward, like a signal; with reduced motion only the steady ring stays. */}
      <span className="absolute inset-6 rounded-full border border-lavender/20" />
      {[0, 0.6, 1.2].map((delay) => (
        <span
          key={delay}
          className="absolute inset-6 rounded-full border border-berry/40 anim-ping"
          style={{ animationDelay: `${delay}s`, animationDuration: '2.4s' }}
        />
      ))}
      <span className="absolute inset-10 rounded-full bg-raised border border-line flex items-center justify-center text-berry shadow-[0_0_48px_rgb(224_123_184_/_0.3)]">
        <RadioTower className="w-7 h-7" strokeWidth={1.75} />
      </span>
    </div>

    <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.22em] text-lavender">A new frequency</p>
    <h1 className="mt-3 font-serif text-[40px] sm:text-5xl leading-none font-semibold tracking-tight text-fg">Signals</h1>
    <p className="mt-4 font-serif italic text-[17px] sm:text-lg text-fg/90 text-balance">
      Some connections deserve a little more time.
    </p>
    <p className="mt-3 text-[14px] sm:text-[15px] text-muted leading-relaxed max-w-sm text-balance">
      Private conversations are coming to QUEERSPACE. Meet someone, find your frequency, and continue your connection
      beyond the moment.
    </p>

    <p className="mt-7 inline-flex items-center gap-2 h-8 px-3.5 rounded-full border border-berry/40 bg-plum/20 text-berry text-[11px] font-semibold uppercase tracking-[0.2em]">
      <span className="relative flex w-1.5 h-1.5" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-berry anim-ping" />
        <span className="relative w-1.5 h-1.5 rounded-full bg-berry" />
      </span>
      Coming soon
    </p>
    <p className="mt-4 text-[12px] text-subtle">A new way to stay connected is on the horizon.</p>
  </section>
);
