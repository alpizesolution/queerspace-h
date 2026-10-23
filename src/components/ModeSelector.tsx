import React from 'react';
import { Zap, Sliders, Users, MessageSquareQuote, ArrowRight } from 'lucide-react';
import { ChatMode } from '../types.ts';

interface ModeSelectorProps {
  onSelectMode: (mode: ChatMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onSelectMode }) => {
  return (
    <section className="py-10 max-w-5xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#fcf7fa]">
          Choose Your Way to Connect
        </h2>
        <p className="text-sm sm:text-base text-[#cbbccf] mt-1.5 max-w-xl mx-auto">
          Whether you want an instant 1-on-1 chat, a tailored match based on shared interests, or a public group room, there is a place for you here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Quick Chat */}
        <div
          onClick={() => onSelectMode('quick')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMode('quick');
            }
          }}
          className="relative group glass-card glass-card-hover rounded-3xl p-6 cursor-pointer flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-[#e07bb8]"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-2xl bg-[#230d3b] text-[#e07bb8] flex items-center justify-center group-hover:scale-105 transition-transform border border-[#4a1f6d]">
                <Zap className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#e07bb8] bg-[#230d3b] px-2.5 py-1 rounded-full border border-[#4a1f6d]">
                Fastest
              </span>
            </div>

            <h3 className="text-xl font-bold text-[#fcf7fa] group-hover:text-[#e07bb8] transition-colors mb-2">
              Quick Chat
            </h3>
            <p className="text-sm text-[#cbbccf] leading-relaxed mb-6">
              Start an instant one-on-one conversation with an available compatible person without any setup.
            </p>
          </div>

          <button
            type="button"
            className="w-full py-3 px-4 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-md shadow-[#e07bb8]/20"
          >
            <span>Chat Instantly</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Card 2: Custom Match */}
        <div
          onClick={() => onSelectMode('custom')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMode('custom');
            }
          }}
          className="relative group glass-card glass-card-hover rounded-3xl p-6 cursor-pointer flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-[#e07bb8]"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-2xl bg-[#230d3b] text-[#e07bb8] flex items-center justify-center group-hover:scale-105 transition-transform border border-[#4a1f6d]">
                <Sliders className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#fcf7fa] bg-[#230d3b] px-2.5 py-1 rounded-full border border-[#4a1f6d]">
                Tailored
              </span>
            </div>

            <h3 className="text-xl font-bold text-[#fcf7fa] group-hover:text-[#e07bb8] transition-colors mb-2">
              Custom Match
            </h3>
            <p className="text-sm text-[#cbbccf] leading-relaxed mb-6">
              Pick your conversation intention (friendship, dating, deep talk), select topics you love, and match on mutual vibes.
            </p>
          </div>

          <button
            type="button"
            className="w-full py-3 px-4 rounded-full bg-[#230d3b] text-[#fcf7fa] group-hover:bg-[#e07bb8] group-hover:text-[#080311] text-sm font-semibold flex items-center justify-center gap-2 transition-colors border border-[#4a1f6d]"
          >
            <span>Set Preferences</span>
            <ArrowRight className="w-4 h-4 text-[#e07bb8] group-hover:text-[#080311]" />
          </button>
        </div>

        {/* Card 3: Community Room */}
        <div
          onClick={() => onSelectMode('public')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMode('public');
            }
          }}
          className="relative group glass-card glass-card-hover rounded-3xl p-6 cursor-pointer flex flex-col justify-between focus:outline-none focus:ring-2 focus:ring-[#e07bb8]"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-2xl bg-[#230d3b] text-[#e07bb8] flex items-center justify-center group-hover:scale-105 transition-transform border border-[#4a1f6d]">
                <Users className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950/80 px-2.5 py-1 rounded-full border border-emerald-800/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            </div>

            <h3 className="text-xl font-bold text-[#fcf7fa] group-hover:text-[#e07bb8] transition-colors mb-2">
              Public Room
            </h3>
            <p className="text-sm text-[#cbbccf] leading-relaxed mb-6">
              Join the live sapphic town square. A relaxed open space to say hi, read conversations, or chime in anytime.
            </p>
          </div>

          <button
            type="button"
            className="w-full py-3 px-4 rounded-full bg-[#230d3b] text-[#fcf7fa] group-hover:bg-[#e07bb8] group-hover:text-[#080311] text-sm font-semibold flex items-center justify-center gap-2 transition-colors border border-[#4a1f6d]"
          >
            <span>Join Room</span>
            <ArrowRight className="w-4 h-4 text-[#e07bb8] group-hover:text-[#080311]" />
          </button>
        </div>
      </div>

      {/* Separate Option: Community Posts Banner */}
      <div className="mt-5 glass-card glass-card-hover rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 text-left">
          <div className="w-10 h-10 rounded-xl bg-[#230d3b] border border-[#4a1f6d] text-[#e07bb8] flex items-center justify-center shrink-0 shadow-xs">
            <MessageSquareQuote className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-[#fcf7fa] text-sm sm:text-base">
              Community Posts & Cozy Vents
            </h4>
            <p className="text-xs sm:text-sm text-[#cbbccf]">
              Browse shared stories, book recommendations, friend finders, and heartfelt advice from fellow sapphics.
            </p>
          </div>
        </div>
        <button
          onClick={() => onSelectMode('community')}
          className="whitespace-nowrap px-5 py-2.5 rounded-full bg-[#230d3b] hover:bg-[#a85293] text-[#fcf7fa] text-xs sm:text-sm font-semibold border border-[#4a1f6d] hover:border-[#e07bb8] transition-colors shrink-0 cursor-pointer shadow-xs"
        >
          View Community Posts
        </button>
      </div>
    </section>
  );
};
