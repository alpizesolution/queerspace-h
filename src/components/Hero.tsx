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
  { key: 'public', icon: Users, title: 'Public Room', text: 'Drop in and say hi' },
  { key: 'unsaid', icon: Feather, title: 'Unsaid', text: 'Say it anonymously' },
  { key: 'community', icon: MessagesSquare, title: 'Community', text: 'Stories and recs' },
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
    <section className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-12 pb-8">
      <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="lg:col-span-6 anim-rise">
          <p className="text-[13px] font-medium text-lavender mb-3">A sapphic space for women</p>
          <h1 className="font-serif text-[34px] leading-[1.1] sm:text-5xl font-semibold tracking-tight text-fg">
            Find your queer
            <br />
            community.
          </h1>
          <p className="mt-4 text-[15px] sm:text-base text-muted max-w-md leading-relaxed">
            Anonymous one-on-one chats with women who love women. No sign-up, no pressure.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-2.5">
            <button onClick={onStartChat} className="btn btn-primary h-12 px-7 text-[15px] w-full sm:w-auto">
              Start chatting
              <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={onCustomMatch} className="btn btn-ghost h-12 w-full sm:w-auto">
              <SlidersHorizontal className="w-4 h-4" />
              Custom match
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 order-first lg:order-none">
          <div className="relative aspect-[16/10] sm:aspect-[4/3] w-full max-w-xl mx-auto rounded-3xl overflow-hidden border border-line bg-surface">
            <img
              src="/assets/aistudio/hero_illustration.png"
              alt="Two women smiling together"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/40 to-transparent pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="mt-10 sm:mt-14 grid sm:grid-cols-3 gap-3">
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
              <span className="block text-[15px] font-semibold text-fg">{title}</span>
              <span className="block text-[13px] text-muted">{text}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-subtle group-hover:text-fg transition-colors" />
          </button>
        ))}
      </div>
    </section>
  );
};
