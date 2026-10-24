import React from 'react';
import { Volume2, VolumeX, Shield } from 'lucide-react';
import { AnimatedBrandTitle } from './AnimatedBrandTitle.tsx';
import { AuthStatusBadge } from './AuthStatusBadge.tsx';
import { NAV_ITEMS, NavTarget, isNavActive } from './BottomNavigation.tsx';

interface HeaderProps {
  onNavigate: (view: NavTarget) => void;
  currentView: string;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onOpenSafetyModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
  currentView,
  isSoundMuted,
  onToggleSound,
  onOpenSafetyModal,
}) => (
  <header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-xl border-b border-line pt-safe">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[var(--header-h)] flex items-center gap-3">
      <button
        onClick={() => onNavigate('home')}
        className="flex items-center gap-2.5 rounded-lg min-w-0 cursor-pointer"
        aria-label="QUEERSPACE home"
      >
        <img
          src="/assets/aistudio/queerspace_cbcdbe4c.png"
          alt=""
          className="w-8 h-8 rounded-[10px] object-cover border border-line shrink-0"
        />
        <AnimatedBrandTitle sizeClass="text-[17px] sm:text-lg" />
      </button>

      <nav className="hidden md:flex items-center gap-1 mx-auto" aria-label="Main">
        {NAV_ITEMS.map(({ id, label }) => {
          const active = isNavActive(id, currentView);
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={active ? 'page' : undefined}
              className={`h-9 px-4 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-0.5 ml-auto md:ml-0 shrink-0">
        <AuthStatusBadge className="mr-1.5" />
        <button
          onClick={onToggleSound}
          className="icon-btn"
          title={isSoundMuted ? 'Unmute sounds' : 'Mute sounds'}
          aria-label={isSoundMuted ? 'Unmute sounds' : 'Mute sounds'}
          aria-pressed={isSoundMuted}
        >
          {isSoundMuted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
        </button>
        <button
          onClick={onOpenSafetyModal}
          className="icon-btn"
          title="Safety & guidelines"
          aria-label="Safety and community guidelines"
        >
          <Shield className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  </header>
);
