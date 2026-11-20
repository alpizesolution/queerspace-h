import React, { useState } from 'react';
import { LayoutDashboard, Volume2, VolumeX, Menu, RadioTower } from 'lucide-react';
import { MenuDrawer, MenuInfoModal } from './MenuDrawer.tsx';
import { formatUnread } from '../services/signalsInbox.ts';
import { AnimatedBrandTitle } from './AnimatedBrandTitle.tsx';
import { AuthStatusBadge } from './AuthStatusBadge.tsx';
import { NAV_ITEMS, NavTarget, isNavActive } from './BottomNavigation.tsx';
import { isAdminDevice } from '../utils/adminDevice.ts';

// Read once per page load; set when an admin signs in at /admin on this device.
const SHOW_ADMIN_LINK = isAdminDevice();

interface HeaderProps {
  badges?: Partial<Record<NavTarget, number>>;
  onNavigate: (view: NavTarget) => void;
  currentView: string;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onOpenInfo: (modal: MenuInfoModal) => void;
  onOpenSupport: () => void;
  onOpenAbout: () => void;
  hasSupportReply?: boolean;
  supportUnreadCount?: number;
  hasUnreadUpdates?: boolean;
  profile: { avatar?: string; displayName?: string };
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
  badges = {},
  currentView,
  isSoundMuted,
  onToggleSound,
  onOpenProfile,
  onOpenSettings,
  onOpenWhatsNew,
  onOpenInfo,
  onOpenSupport,
  onOpenAbout,
  hasSupportReply = false,
  supportUnreadCount = 0,
  hasUnreadUpdates = false,
  profile,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const inboxCount = badges.signals ?? 0;
  return (
  <header data-app-header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-xl border-b border-line pt-safe">
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
        <AnimatedBrandTitle sizeClass="text-[length:calc(15px_*_var(--fs,1))] min-[380px]:text-[length:calc(17px_*_var(--fs,1))] sm:text-lg" />
      </button>

      <nav className="hidden desk:flex items-center gap-1 mx-auto [--fs:1]" aria-label="Main">
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
              {(badges[id] ?? 0) > 0 && <span aria-label={`${badges[id]} pending`} className="ml-1.5 inline-block min-w-[16px] rounded-full bg-berry px-1 text-center text-[length:calc(10px_*_var(--fs,1))] font-bold leading-4 text-ink">{formatUnread(badges[id])}</span>}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-0.5 ml-auto desk:ml-0 shrink-0">
        <AuthStatusBadge className="sm:mr-1.5" />
        <button
          onClick={() => onNavigate('signals')}
          className="icon-btn relative !w-9 sm:!w-10"
          title="Inbox"
          aria-label={inboxCount > 0 ? `Open inbox, ${inboxCount} unread` : 'Open inbox'}
          aria-current={currentView === 'signals' ? 'page' : undefined}
          data-testid="header-inbox"
        >
          <RadioTower className="w-[18px] h-[18px]" />
          {inboxCount > 0 && (
            <span aria-hidden="true" className="absolute -right-0.5 top-0.5 min-w-[16px] rounded-full bg-berry px-1 text-center text-[length:calc(10px_*_var(--fs,1))] font-bold leading-4 text-ink ring-2 ring-ink">{formatUnread(inboxCount)}</span>
          )}
        </button>
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
          onClick={() => setMenuOpen(true)}
          className="icon-btn relative !w-9 sm:!w-10"
          title="Menu"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
        >
          <Menu className="w-5 h-5" />
          {(hasSupportReply || hasUnreadUpdates) && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-berry ring-2 ring-ink">
              <span className="sr-only">{hasSupportReply ? 'New reply from the team' : 'New updates'}</span>
            </span>
          )}
        </button>
      </div>
    </div>
    {menuOpen && (
      <MenuDrawer
        onClose={() => setMenuOpen(false)}
        onOpenInfo={onOpenInfo}
        onOpenSupport={onOpenSupport}
        onOpenAbout={onOpenAbout}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenWhatsNew={onOpenWhatsNew}
        isSoundMuted={isSoundMuted}
        onToggleSound={onToggleSound}
        hasSupportReply={hasSupportReply}
        supportUnreadCount={supportUnreadCount}
        hasUnreadUpdates={hasUnreadUpdates}
        showAdmin={SHOW_ADMIN_LINK}
        profile={profile}
      />
    )}
  </header>
  );
};
