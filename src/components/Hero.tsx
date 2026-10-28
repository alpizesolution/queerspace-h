import React from 'react';
import { ArrowRight, ChevronRight, Feather, MessagesSquare, SlidersHorizontal, Users } from 'lucide-react';

interface HeroProps {
  onStartChat: () => void;
  onCustomMatch: () => void;
  onOpenPublicRoom: () => void;
  onOpenCommunity: () => void;
  onOpenUnsaid: () => void;
}

const DESTINATIONS = [
  { key: 'public', icon: Users, title: 'Galaxy', text: 'Drop in and say hi' },
  { key: 'unsaid', icon: Feather, title: 'Echoes', text: 'Say it anonymously' },
  { key: 'community', icon: MessagesSquare, title: 'Cosmos', text: 'Stories and recs' },
] as const;

export const Hero: React.FC<HeroProps> = ({
  onStartChat,
  onCustomMatch,
  onOpenPublicRoom,
  onOpenCommunity,
  onOpenUnsaid,
}) => {
  const open = { public: onOpenPublicRoom, unsaid: onOpenUnsaid, community: onOpenCommunity };

  return (
    <section className="max-w-2xl sm:max-w-3xl desk:max-w-6xl mx-auto w-full px-4 sm:px-8 desk:px-6 pt-4 sm:pt-10 pb-8">
      <div className="grid desk:grid-cols-12 gap-5 sm:gap-8 desk:gap-12 items-center">
        <div className="desk:col-span-6 anim-rise">
          <p className="text-[length:calc(11px_*_var(--fs,1))] sm:text-xs font-semibold uppercase tracking-[0.16em] min-[380px]:tracking-[0.18em] text-lavender mb-2.5 sm:mb-3">
            ✦ A sapphic space for women · WLW ✦
          </p>
          <h1 className="font-serif text-[clamp(1.75rem,9vw,2.25rem)] leading-[1.12] sm:text-5xl font-semibold tracking-tight text-fg text-balance">
            Somewhere between{' '}
            <br className="hidden desk:block" />
            strangers and <em className="text-berry">stardust.</em>
          </h1>
          <p className="mt-3 sm:mt-4 text-[length:calc(15px_*_var(--fs,1))] sm:text-base text-muted max-w-md leading-relaxed">
            A little universe for women who love women. Find your people, share a secret, and discover the magic of
            an unexpected connection.
          </p>

          <div className="mt-5 sm:mt-7 flex flex-col sm:flex-row gap-2.5">
            <button onClick={onStartChat} className="btn btn-primary h-12 px-7 text-[length:calc(15px_*_var(--fs,1))] w-full sm:w-auto">
              Find Your Someone
              <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={onCustomMatch} className="btn btn-ghost h-12 w-full sm:w-auto">
              <SlidersHorizontal className="w-4 h-4" />
              Custom match
            </button>
          </div>
          <p className="mt-4 text-[length:calc(12px_*_var(--fs,1))] sm:text-[length:calc(13px_*_var(--fs,1))] text-subtle text-center sm:text-left">
            Meet anonymously · Connect authentically · Be yourself
          </p>
        </div>

        <div className="desk:col-span-6 order-first desk:order-none">
          <div className="relative aspect-[16/9] sm:aspect-[2/1] desk:aspect-[4/3] w-full desk:max-w-xl mx-auto rounded-3xl overflow-hidden border border-line bg-surface">
            <img
              src="/assets/aistudio/hero_illustration.png"
              alt="Two women smiling together"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/40 to-transparent pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="mt-8 sm:mt-12 grid sm:grid-cols-3 gap-3">
        {DESTINATIONS.map(({ key, icon: Icon, title, text }) => (
          <button
            key={key}
            onClick={open[key]}
            className="card group flex items-center gap-4 p-4 sm:p-5 text-left transition-colors hover:border-line-strong hover:bg-raised cursor-pointer"
          >
            <span className="w-11 h-11 rounded-xl bg-raised border border-line flex items-center justify-center text-berry shrink-0">
              <Icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">{title}</span>
              <span className="block text-[length:calc(13px_*_var(--fs,1))] text-muted">{text}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-subtle group-hover:text-fg transition-colors" />
          </button>
        ))}
      </div>

      <div className="mt-8 max-w-2xl text-[length:calc(13px_*_var(--fs,1))] leading-relaxed text-muted">
        <p>
          QUEERSPACE PH is an anonymous space for women who love women in the Philippines: 1-on-1 chat, a public room,
          anonymous posts and a community feed, for adults 18 and over.
        </p>
        <nav aria-label="Learn more about QUEERSPACE PH" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <a href="/anonymous-wlw-chat" className="text-berry underline underline-offset-4 hover:text-fg">Anonymous WLW chat</a>
          <a href="/sapphic-community-philippines" className="text-berry underline underline-offset-4 hover:text-fg">Sapphic community in the Philippines</a>
          <a href="/wlw-dating-philippines" className="text-berry underline underline-offset-4 hover:text-fg">WLW dating in the Philippines</a>
          <a href="/wlw-sapphic-guide" className="text-berry underline underline-offset-4 hover:text-fg">WLW and sapphic guide</a>
        </nav>
      </div>
    </section>
  );
};
