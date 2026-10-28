import React, { useState } from 'react';
import { LayoutDashboard, Volume2, VolumeX, Shield, Menu, Settings2 } from 'lucide-react';
import { MenuDrawer, MenuInfoModal } from './MenuDrawer.tsx';
import { AnimatedBrandTitle } from './AnimatedBrandTitle.tsx';
import { AuthStatusBadge } from './AuthStatusBadge.tsx';
import { NAV_ITEMS, NavTarget, isNavActive } from './BottomNavigation.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { isAdminDevice } from '../utils/adminDevice.ts';

// Read once per page load; set when an admin signs in at /admin on this device.
const SHOW_ADMIN_LINK = isAdminDevice();

interface HeaderProps {
  onNavigate: (view: NavTarget) => void;
  currentView: string;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onOpenSafetyModal: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenInfo: (modal: MenuInfoModal) => void;
  onOpenSupport: () => void;
  hasSupportReply?: boolean;
  profile: { avatar?: string; displayName?: string };
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
  currentView,
  isSoundMuted,
  onToggleSound,
  onOpenSafetyModal,
  onOpenProfile,
  onOpenSettings,
  onOpenInfo,
  onOpenSupport,
  hasSupportReply = false,
  profile,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
  <header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-xl border-b border-line pt-safe">
    <div className="max-w-6xl mx-auto px-3 sm:px-6 h-[var(--header-h)] flex items-center gap-2 sm:gap-3">
      <button
        onClick={() => onNavigate('home')}
        className="flex items-center gap-2 sm:gap-2.5 rounded-lg min-w-0 pr-1 cursor-pointer"
        aria-label="QUEERSPACE PH home"
      >
        <img
          src="/icon-192.png"
          alt=""
          className="w-8 h-8 rounded-[10px] object-cover border border-line shrink-0"
        />
        <AnimatedBrandTitle sizeClass="text-[15px] min-[380px]:text-[17px] sm:text-lg" />
      </button>

      <nav className="hidden desk:flex items-center gap-1 mx-auto" aria-label="Main">
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

      <div className="flex items-center gap-0.5 ml-auto desk:ml-0 shrink-0">
        <AuthStatusBadge className="sm:mr-1.5" />
        {SHOW_ADMIN_LINK && (
          <a href="/admin" className="icon-btn text-berry hidden desk:inline-flex" title="Admin dashboard" aria-label="Open admin dashboard">
            <LayoutDashboard className="w-[18px] h-[18px]" />
          </a>
        )}
        <button
          onClick={onToggleSound}
          className="icon-btn hidden desk:inline-flex"
          title={isSoundMuted ? 'Unmute sounds' : 'Mute sounds'}
          aria-label={isSoundMuted ? 'Unmute sounds' : 'Mute sounds'}
          aria-pressed={isSoundMuted}
        >
          {isSoundMuted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
        </button>
        <button
          onClick={onOpenSettings}
          className="icon-btn hidden desk:inline-flex"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings2 className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={onOpenSafetyModal}
          className="icon-btn !w-9 sm:!w-10"
          title="Safety & guidelines"
          aria-label="Safety and community guidelines"
        >
          <Shield className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={() => setMenuOpen(true)}
          className="icon-btn relative !w-9 sm:!w-10 desk:hidden"
          title="Menu"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
        >
          <Menu className="w-5 h-5" />
          {hasSupportReply && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-berry ring-2 ring-ink">
              <span className="sr-only">New reply from the team</span>
            </span>
          )}
        </button>
        <button
          onClick={onOpenProfile}
          className="ml-0.5 sm:ml-1 rounded-full ring-1 ring-line hover:ring-berry transition-shadow cursor-pointer"
          title="Your profile"
          aria-label="Edit your profile"
        >
          <AnimalAvatar avatar={profile.avatar} seed={profile.displayName || 'guest'} className="w-8 h-8" />
        </button>
      </div>
    </div>
    {menuOpen && (
      <MenuDrawer
        onClose={() => setMenuOpen(false)}
        onOpenInfo={onOpenInfo}
        onOpenSupport={onOpenSupport}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        hasSupportReply={hasSupportReply}
        showAdmin={SHOW_ADMIN_LINK}
      />
    )}
  </header>
  );
};
