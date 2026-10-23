import React, { useState } from 'react';
import { Sparkles, MessageCircle, Volume2, VolumeX, Menu, X, Shield, Users, SlidersHorizontal } from 'lucide-react';
import { AnimatedBrandTitle } from './AnimatedBrandTitle.tsx';
import { AuthStatusBadge } from './AuthStatusBadge.tsx';


interface HeaderProps {
  onStartChat: () => void;
  onNavigate: (view: 'home' | 'setup' | 'public' | 'community') => void;
  currentView: string;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onOpenSafetyModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onStartChat,
  onNavigate,
  currentView,
  isSoundMuted,
  onToggleSound,
  onOpenSafetyModal,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (view: 'home' | 'setup' | 'public' | 'community') => {
    onNavigate(view);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#080311]/90 backdrop-blur-md border-b border-[#4a1f6d]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo & Name */}
        <button
          onClick={() => handleNavClick('home')}
          className="flex items-center gap-2.5 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e07bb8] rounded-lg p-1"
          aria-label="QUEERSPACE Home"
        >
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-[#230d3b] flex items-center justify-center text-white shadow-sm shadow-[#e07bb8]/20 transition-transform group-hover:scale-105 border border-[#4a1f6d]">
            <img src="/assets/aistudio/queerspace_cbcdbe4c.png" alt="QUEERSPACE Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <AnimatedBrandTitle sizeClass="text-xl" />
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-[#230d3b] text-[#e07bb8] px-1.5 py-0.5 rounded-full border border-[#4a1f6d]">
                WLW
              </span>
            </div>
            <p className="text-[11px] text-[#cbbccf] -mt-0.5 hidden sm:block">
              A Sapphic Space for Women
            </p>
          </div>
        </button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 text-sm font-medium text-[#cbbccf]" aria-label="Main navigation">
          <button
            onClick={() => handleNavClick('home')}
            className={`px-3.5 py-2 rounded-full transition-colors cursor-pointer ${
              currentView === 'home'
                ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]'
                : 'hover:text-[#fcf7fa] hover:bg-[#150826]'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => handleNavClick('setup')}
            className={`px-3.5 py-2 rounded-full transition-colors cursor-pointer ${
              currentView === 'setup'
                ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]'
                : 'hover:text-[#fcf7fa] hover:bg-[#150826]'
            }`}
          >
            1-on-1 Chat
          </button>
          <button
            onClick={() => handleNavClick('public')}
            className={`px-3.5 py-2 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer ${
              currentView === 'public'
                ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]'
                : 'hover:text-[#fcf7fa] hover:bg-[#150826]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Public Room
          </button>
          <button
            onClick={() => handleNavClick('community')}
            className={`px-3.5 py-2 rounded-full transition-colors cursor-pointer ${
              currentView === 'community'
                ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]'
                : 'hover:text-[#fcf7fa] hover:bg-[#150826]'
            }`}
          >
            Community Posts
          </button>
          <button
            onClick={() => handleNavClick('setup')}
            className="px-3 py-2 rounded-full hover:text-[#fcf7fa] hover:bg-[#150826] transition-colors flex items-center gap-1 text-xs text-[#e07bb8] cursor-pointer"
            title="Discovery Filters & Identity Preferences"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
          </button>
          <button
            onClick={onOpenSafetyModal}
            className="px-3 py-2 rounded-full hover:text-[#fcf7fa] hover:bg-[#150826] transition-colors flex items-center gap-1 text-xs text-[#cbbccf] cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5" />
            Safety
          </button>
        </nav>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Auth Session & Connection Status Badge */}
          <AuthStatusBadge className="hidden lg:inline-flex" />

          {/* Sound Toggle */}
          <button
            onClick={onToggleSound}
            className="p-2 rounded-full text-[#cbbccf] hover:text-[#fcf7fa] hover:bg-[#150826] transition-colors cursor-pointer"
            title={isSoundMuted ? 'Unmute chat sounds' : 'Mute chat sounds'}
            aria-label={isSoundMuted ? 'Unmute chat sounds' : 'Mute chat sounds'}
          >
            {isSoundMuted ? (
              <VolumeX className="w-4 h-4 text-[#cbbccf]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#e07bb8]" />
            )}
          </button>

          {/* Primary CTA */}
          <button
            onClick={onStartChat}
            className="hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-sm font-semibold shadow-md shadow-[#e07bb8]/25 transition-all hover:shadow cursor-pointer active:scale-[0.98]"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Start Chatting</span>
          </button>

          {/* Mobile Menu Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-[#fcf7fa] hover:bg-[#150826] focus:outline-none cursor-pointer"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>


      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#4a1f6d] bg-[#150826] px-4 pt-3 pb-6 space-y-2 shadow-2xl animate-in slide-in-from-top duration-200">
          <button
            onClick={() => handleNavClick('home')}
            className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium ${
              currentView === 'home' ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]' : 'text-[#cbbccf] hover:bg-[#230d3b]/60 hover:text-[#fcf7fa]'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => handleNavClick('setup')}
            className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium ${
              currentView === 'setup' ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]' : 'text-[#cbbccf] hover:bg-[#230d3b]/60 hover:text-[#fcf7fa]'
            }`}
          >
            1-on-1 Chat
          </button>
          <button
            onClick={() => handleNavClick('public')}
            className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between ${
              currentView === 'public' ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]' : 'text-[#cbbccf] hover:bg-[#230d3b]/60 hover:text-[#fcf7fa]'
            }`}
          >
            <span>Public Room</span>
            <span className="text-[10px] bg-emerald-950/80 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-800/60">Live</span>
          </button>
          <button
            onClick={() => handleNavClick('community')}
            className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium ${
              currentView === 'community' ? 'bg-[#230d3b] text-[#fcf7fa] font-semibold border border-[#4a1f6d]' : 'text-[#cbbccf] hover:bg-[#230d3b]/60 hover:text-[#fcf7fa]'
            }`}
          >
            Community Posts & Vents
          </button>
          <button
            onClick={() => handleNavClick('setup')}
            className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium text-[#e07bb8] hover:bg-[#230d3b]/60 flex items-center gap-2 cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Matching Filters & SOGIE
          </button>
          <button
            onClick={() => {
              onOpenSafetyModal();
              setMobileMenuOpen(false);
            }}
            className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium text-[#cbbccf] hover:bg-[#230d3b]/60 flex items-center gap-2 cursor-pointer"
          >
            <Shield className="w-4 h-4" />
            Safety Guidelines & Privacy
          </button>

          <div className="px-4 pt-1 pb-2 flex items-center justify-between border-b border-[#4a1f6d]/60 mb-2">
            <span className="text-xs text-[#cbbccf]/70 font-medium">Session Status</span>
            <AuthStatusBadge compactMobile />
          </div>

          <div className="pt-2">

            <button
              onClick={() => {
                onStartChat();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-sm font-semibold shadow-md cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Start Chatting</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
