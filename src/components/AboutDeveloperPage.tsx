import React, { useEffect } from 'react';
import { ArrowLeft, Code2, Heart, Sparkles, Users } from 'lucide-react';
import { BMC_URL } from './Footer.tsx';
import { hideBmcWidget, showBmcWidget } from '../utils/bmcWidget.ts';

interface AboutDeveloperPageProps {
  onBack: () => void;
}

const SECTIONS = [
  {
    icon: Users,
    title: 'The story and mission',
    text: 'QueerSpace PH started from a simple wish: a corner of the internet made for Filipino sapphics and WLW, where you don’t have to explain yourself to belong. The mission is to keep that space accessible, supportive and safe for everyone who finds their way here.',
  },
  {
    icon: Code2,
    title: 'Independently maintained',
    text: 'There is no company or team behind this. It is a passion project that I design, build and look after on my own. Updates may come at a human pace, but each one is made with care for this community.',
  },
] as const;

/** About the Developer and Support QueerSpace, at /about. Open to everyone, with or without a profile. */
export const AboutDeveloperPage: React.FC<AboutDeveloperPageProps> = ({ onBack }) => {
  // The floating Buy Me a Coffee widget shows on this page only, so it never sits on top of the other screens' controls.
  useEffect(() => {
    showBmcWidget();
    return hideBmcWidget;
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = 'About the Developer · QUEERSPACE PH';
    return () => { document.title = previous; };
  }, []);

  return (
    <section className="max-w-2xl mx-auto w-full px-4 sm:px-8 pt-4 sm:pt-8 pb-28 anim-rise">
      <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2">
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <header className="mt-6 sm:mt-8 text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-raised border border-line text-lavender flex items-center justify-center">
          <Sparkles className="w-6 h-6" />
        </span>
        <p className="mt-5 text-[length:calc(11px_*_var(--fs,1))] sm:text-xs font-semibold uppercase tracking-[0.18em] text-lavender">
          About the Developer
        </p>
        <h1 className="mt-3 font-serif text-[clamp(1.75rem,8vw,2.25rem)] sm:text-5xl leading-[1.12] font-semibold tracking-tight text-fg text-balance">
          Your Space. Your People. <em className="text-berry">Built with Love.</em>
        </h1>
      </header>

      <div className="mt-8 sm:mt-10 space-y-4">
        <article className="card p-5 sm:p-7">
          <h2 className="text-lg font-semibold text-fg">Hey there! I’m Cha, creator of QueerSpace PH.</h2>
          <div className="mt-3 space-y-3 text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-muted">
            <p>
              QueerSpace PH is a passion project built to give Filipino sapphics and WLW an accessible, supportive, and
              safe digital haven: <span className="text-fg">Your space. Your people.</span>
            </p>
            <p>
              I manage and develop this platform independently. Every feature, improvement, and update is part of my
              effort to create a digital space where our community can connect, express themselves, and feel at home.
            </p>
          </div>
        </article>

        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="card p-5">
              <span className="w-11 h-11 rounded-xl bg-raised border border-line text-berry flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </span>
              <h2 className="mt-4 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">{title}</h2>
              <p className="mt-1.5 text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">{text}</p>
            </article>
          ))}
        </div>

        <article className="card p-5 sm:p-7 text-center">
          <Heart className="w-5 h-5 text-berry mx-auto" />
          <h2 className="mt-3 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">Thank you for being here</h2>
          <p className="mt-1.5 max-w-md mx-auto text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">
            To everyone who has joined, shared, and made this space feel alive: maraming salamat. You are the reason
            QueerSpace PH exists, and the reason it keeps growing.
          </p>
        </article>

        <article aria-labelledby="support-queerspace" className="rounded-3xl border border-berry/40 bg-raised p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-7">
            <div className="flex-1 min-w-0">
              <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.18em] text-lavender">
                Support QueerSpace
              </p>
              <h2 id="support-queerspace" className="mt-2 font-serif text-2xl font-semibold tracking-tight text-fg">
                Help Keep QueerSpace Alive&nbsp;💜
              </h2>
              <div className="mt-3 space-y-3 text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-muted">
                <p>
                  If you’d like to support ongoing development, help cover server and hosting costs, or just say thanks
                  with a cup of coffee, it would mean the world!
                </p>
                <p>Every contribution helps keep this independent WLW platform growing.</p>
              </div>
            </div>

            <div className="sm:w-56 shrink-0 flex flex-col items-stretch sm:items-center gap-3">
              <a
                href={BMC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 h-14 px-6 rounded-full bg-[#FFDD00] text-black border border-black font-[Cookie,cursive] text-[length:calc(28px_*_var(--fs,1))] leading-none whitespace-nowrap hover:brightness-95 active:scale-[0.98] transition"
              >
                <span aria-hidden="true" className="text-xl">☕</span>
                Buy me a coffee
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <p className="text-center text-[length:calc(12px_*_var(--fs,1))] leading-relaxed text-subtle">
                No pressure, ever. Just being here is support enough. Salamat! 💜
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
};
