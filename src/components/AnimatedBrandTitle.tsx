import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface AnimatedBrandTitleProps {
  className?: string;
  sizeClass?: string;
}

const WORD = 'QUEERSPACE';
const SCRAMBLED_WORD = 'QUEERSCAPE';
const SUFFIX = 'PH';
// QUEERSPACE ⇄ QUEERSCAPE: the P and C trade places, the A between them shifts to make room.
const P_INDEX = 6;
const A_INDEX = 7;
const C_INDEX = 8;

const FIRST_SHUFFLE_MS = 2500;
const HOLD_MS = 1800;
const CYCLE_MS = 7000;

/**
 * Brand wordmark that periodically shuffles into "QUEERSCAPE" and settles back.
 * Screen readers always get "QUEERSPACE PH". With reduced motion on (common on phones in
 * battery saver), the letters don't move: the word softly fades between the two spellings.
 */
export const AnimatedBrandTitle: React.FC<AnimatedBrandTitleProps> = ({
  className = '',
  sizeClass = 'text-xl',
}) => {
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [offsets, setOffsets] = useState({ p: 0, a: 0, c: 0 });
  const [scrambled, setScrambled] = useState(false);
  // True for the first half of each move, so the P and C arc past each other instead of colliding.
  const [lifted, setLifted] = useState(false);
  const [reducedMotion] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [faded, setFaded] = useState(false);

  // Measure the letters so the swap lands exactly in each other's slot.
  useLayoutEffect(() => {
    const measure = () => {
      const p = letterRefs.current[P_INDEX];
      const c = letterRefs.current[C_INDEX];
      if (!p || !c) return;
      const widthDiff = c.offsetWidth - p.offsetWidth;
      setOffsets({
        p: c.offsetLeft + widthDiff - p.offsetLeft,
        a: widthDiff,
        c: p.offsetLeft - c.offsetLeft,
      });
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [sizeClass]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const move = (toScrambled: boolean) => {
      if (reducedMotion) {
        setFaded(true);
        timers.push(
          setTimeout(() => {
            setScrambled(toScrambled);
            setFaded(false);
          }, 400)
        );
        return;
      }
      setScrambled(toScrambled);
      setLifted(true);
      timers.push(setTimeout(() => setLifted(false), 350));
    };
    const shuffle = () => {
      move(true);
      timers.push(setTimeout(() => move(false), HOLD_MS));
    };
    timers.push(setTimeout(shuffle, FIRST_SHUFFLE_MS));
    const interval = setInterval(shuffle, CYCLE_MS);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [reducedMotion]);

  const transformFor = (i: number) => {
    if (reducedMotion) return 'none';
    const lift = lifted ? 0.22 : 0;
    if (i === P_INDEX) return `translate(${scrambled ? offsets.p : 0}px, ${-lift}em)`;
    if (i === C_INDEX) return `translate(${scrambled ? offsets.c : 0}px, ${lift}em)`;
    if (i === A_INDEX) return `translate(${scrambled ? offsets.a : 0}px, 0)`;
    return 'translate(0, 0)';
  };

  return (
    <span
      className={`font-serif font-semibold tracking-tight text-fg select-none inline-flex whitespace-nowrap ${sizeClass} ${className}`}
      aria-label={`${WORD} ${SUFFIX}`}
      role="img"
    >
      <span aria-hidden="true" className={`inline-flex brand-fade ${faded ? 'opacity-0' : 'opacity-100'}`}>
        {(reducedMotion && scrambled ? SCRAMBLED_WORD : WORD).split('').map((letter, i) => {
          const moves = i === P_INDEX || i === A_INDEX || i === C_INDEX;
          return (
            <span
              key={i}
              ref={(el) => {
                letterRefs.current[i] = el;
              }}
              aria-hidden="true"
              className={`inline-block ${moves && !reducedMotion ? 'transition-[transform,color] duration-700 ease-[cubic-bezier(0.65,0,0.35,1)]' : ''} ${
                scrambled && (i === P_INDEX || i === C_INDEX) ? 'text-berry' : ''
              }`}
              style={moves ? { transform: transformFor(i) } : undefined}
            >
              {letter}
            </span>
          );
      })}
      </span>
      <span aria-hidden="true" className="ml-[0.28em] text-berry">
        {SUFFIX}
      </span>
    </span>
  );
};
