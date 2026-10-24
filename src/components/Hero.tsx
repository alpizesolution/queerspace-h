import React from 'react';
import { ChevronRight, Zap, Users, Edit3, ShieldCheck, Heart } from 'lucide-react';

interface HeroProps {
  onQuickChat: () => void;
  onExploreCommunity: () => void;
  onOpenCommunity: () => void;
  onOpenSetup: () => void;
  onOpenSafety?: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onQuickChat,
  onExploreCommunity,
  onOpenCommunity,
  onOpenSetup,
  onOpenSafety,
}) => {
  return (
    <section className="relative pt-4 pb-12 sm:pt-6 sm:pb-16 overflow-hidden">
      <div className="max-w-6xl mx-auto px-3 sm:px-6">
        
        {/* Main Vibrant Purple/Pink Hero Banner */}
        <div className="relative rounded-3xl bg-gradient-to-r from-[#3f0f4a] via-[#73236e] to-[#b34098] p-6 sm:p-8 md:p-10 shadow-2xl border border-white/20 overflow-hidden mb-6">
          
          {/* Ambient lighting effects */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-pink-400/20 to-purple-600/30 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-purple-900/40 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            
            {/* Left Content */}
            <div className="lg:col-span-7 text-left space-y-4">
              
              {/* Status Pill Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-xs font-medium text-emerald-300 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Connected · Anon #a8f2</span>
              </div>

              {/* Headline */}
              <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white leading-[1.1] flex flex-wrap items-center gap-x-3">
                <span>Find Your</span>
                <span className="inline-flex items-center gap-1.5 text-pink-200">
                  <span>Queer</span>
                  <Heart className="w-7 h-7 sm:w-9 sm:h-9 text-pink-300 fill-pink-400 inline-block drop-shadow-[0_0_12px_rgba(244,114,182,0.8)]" />
                </span>
                <span className="w-full">Community</span>
              </h1>

              {/* Subtitle */}
              <p className="text-sm sm:text-base font-medium tracking-wide text-pink-100/90 pt-1">
                Chat <span className="text-pink-300 mx-1.5">·</span> Connect <span className="text-pink-300 mx-1.5">·</span> Belong
              </p>
            </div>

            {/* Right Illustration Column */}
            <div className="lg:col-span-5 flex items-center justify-center">
              <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-md aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-[#2a0b31] flex items-center justify-center">
                <img 
                  src="/assets/aistudio/hero_illustration.png" 
                  alt="Sapphic Community Illustration" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#3f0f4a]/50 via-transparent to-transparent pointer-events-none" />
              </div>
            </div>

          </div>
        </div>

        {/* Three Quick-Action Cards Underneath */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          
          {/* Card 1: Quick Match */}
          <button
            onClick={onQuickChat}
            className="group relative p-5 rounded-2xl bg-gradient-to-br from-purple-900/60 via-[#1d0b2b]/90 to-[#2c123d] hover:from-purple-800/80 hover:to-[#381650] border border-white/15 hover:border-pink-400/50 transition-all text-left shadow-lg hover:shadow-2xl hover:-translate-y-1 cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 text-slate-950 flex items-center justify-center shadow-md shadow-amber-500/20 shrink-0">
                <Zap className="w-6 h-6 fill-slate-950" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white mb-0.5 group-hover:text-pink-200 transition-colors">
                  Quick Match
                </h3>
                <p className="text-xs text-purple-200/80">
                  Find someone new
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          {/* Card 2: Join Public Room */}
          <button
            onClick={onExploreCommunity}
            className="group relative p-5 rounded-2xl bg-gradient-to-br from-purple-900/60 via-[#1d0b2b]/90 to-[#2c123d] hover:from-purple-800/80 hover:to-[#381650] border border-white/15 hover:border-pink-400/50 transition-all text-left shadow-lg hover:shadow-2xl hover:-translate-y-1 cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white mb-0.5 group-hover:text-pink-200 transition-colors">
                  Join Public Room
                </h3>
                <p className="text-xs text-purple-200/80">
                  Chat in the community
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          {/* Card 3: Post Something */}
          <button
            onClick={onOpenCommunity}
            className="group relative p-5 rounded-2xl bg-gradient-to-br from-purple-900/60 via-[#1d0b2b]/90 to-[#2c123d] hover:from-purple-800/80 hover:to-[#381650] border border-white/15 hover:border-pink-400/50 transition-all text-left shadow-lg hover:shadow-2xl hover:-translate-y-1 cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-500 text-white flex items-center justify-center shadow-md shadow-purple-500/20 shrink-0">
                <Edit3 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white mb-0.5 group-hover:text-pink-200 transition-colors">
                  Post Something
                </h3>
                <p className="text-xs text-purple-200/80">
                  Share your thoughts
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

        </div>

        {/* Bottom Safety Banner matching reference image */}
        <div className="relative rounded-2xl bg-gradient-to-r from-purple-950/90 via-[#250d36] to-purple-950/90 p-4 sm:p-5 border border-white/15 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-white">Your Safety. Our Priority.</h4>
              <p className="text-xs text-purple-200/80">Report, block, and control your experience.</p>
            </div>
          </div>
          <button
            onClick={onOpenSafety}
            className="text-xs font-semibold text-pink-300 hover:text-white transition-colors flex items-center gap-1 shrink-0 cursor-pointer py-2 px-3 rounded-xl hover:bg-white/10"
          >
            <span>Learn More</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </section>
  );
};
