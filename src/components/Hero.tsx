import React from 'react';
import { ArrowRight, MessageSquare, ShieldCheck, HeartHandshake, Sparkles, Users } from 'lucide-react';

interface HeroProps {
  onQuickChat: () => void;
  onExploreCommunity: () => void;
  onOpenSetup: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onQuickChat,
  onExploreCommunity,
  onOpenSetup,
}) => {
  return (
    <section className="relative pt-8 pb-12 sm:pt-14 sm:pb-16 overflow-hidden">
      {/* Soft background aesthetic gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-80 bg-gradient-to-b from-[#e07bb8]/15 via-[#150826]/40 to-transparent -z-10 blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {/* Safe sapphic badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#150826] border border-[#4a1f6d] text-xs font-semibold text-[#e07bb8] mb-6 shadow-sm animate-in fade-in duration-300">
          <span className="w-2 h-2 rounded-full bg-[#e07bb8] animate-pulse" />
          <span>A Sapphic Space for Women • 100% Free & Guest Friendly</span>
        </div>

        {/* Headline */}
        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-[#fcf7fa] leading-[1.15] max-w-3xl mx-auto mb-5">
          Your space. Your people.{' '}
          <span className="italic font-normal text-[#e07bb8]">Your possibilities.</span>
        </h1>

        {/* Supporting text */}
        <p className="text-base sm:text-lg md:text-xl text-[#cbbccf] max-w-2xl mx-auto leading-relaxed mb-8">
          A dedicated sapphic space for women to meet, talk, make friends, and discover unexpected connections.
        </p>

        {/* Primary CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-md mx-auto mb-10">
          <button
            onClick={onQuickChat}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-base font-semibold shadow-lg shadow-[#e07bb8]/25 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
          >
            <span>Start Chatting</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onExploreCommunity}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#150826] hover:bg-[#230d3b] text-[#fcf7fa] text-base font-semibold border border-[#4a1f6d] shadow-sm transition-colors hover:border-[#e07bb8]/60 cursor-pointer"
          >
            <span>Explore Community</span>
          </button>
        </div>

        {/* Trust & Privacy ticker pills */}
        <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-5 text-xs text-[#cbbccf] pt-2 pb-6 border-b border-[#4a1f6d]/60 max-w-3xl mx-auto">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#e07bb8]" />
            <span>No sign-up or phone number needed</span>
          </div>
          <span className="hidden sm:inline text-[#4a1f6d]">•</span>
          <div className="flex items-center gap-1.5">
            <HeartHandshake className="w-4 h-4 text-[#e07bb8]" />
            <span>Safe, respectful WLW space</span>
          </div>
          <span className="hidden sm:inline text-[#4a1f6d]">•</span>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#e07bb8]" />
            <span>Instant leave & block controls</span>
          </div>
        </div>

        {/* Platform Pillars / Value Highlights */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-left max-w-3xl mx-auto">
          <div className="p-4 rounded-2xl bg-[#150826]/80 border border-[#4a1f6d]/60 shadow-xs">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[#230d3b] text-[#e07bb8] flex items-center justify-center border border-[#4a1f6d]">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm text-[#fcf7fa]">
                100% Anonymous
              </span>
            </div>
            <p className="text-xs text-[#cbbccf] leading-relaxed">
              No account creation or phone number needed. Chats are ephemeral and private.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#150826]/80 border border-[#4a1f6d]/60 shadow-xs">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[#230d3b] text-[#e07bb8] flex items-center justify-center border border-[#4a1f6d]">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm text-[#fcf7fa]">
                Intentional WLW
              </span>
            </div>
            <p className="text-xs text-[#cbbccf] leading-relaxed">
              Tailored matching by intention (friendship, dating, deep talk) and shared topics.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#150826]/80 border border-[#4a1f6d]/60 shadow-xs">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[#230d3b] text-[#e07bb8] flex items-center justify-center border border-[#4a1f6d]">
                <HeartHandshake className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm text-[#fcf7fa]">
                Safe & Welcoming
              </span>
            </div>
            <p className="text-xs text-[#cbbccf] leading-relaxed">
              Built with zero tolerance for harassment, instant skip, and 1-click block controls.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
