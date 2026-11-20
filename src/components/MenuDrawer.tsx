import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SupportUnreadBadge } from './SupportUnreadBadge.tsx';
import {
  X,
  Info,
  CircleHelp,
  Shield,
  Lock,
  FileText,
  MessageCircleHeart,
  Coffee,
  ChevronRight,
  LogOut,
  Settings2,
  Sparkles,
  HeartHandshake,
  Volume2,
  VolumeX,
  LayoutDashboard,
} from 'lucide-react';
import { BMC_URL } from './Footer.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { signOutMember } from '../lib/firebase.ts';

export type MenuInfoModal = 'about' | 'faq' | 'guidelines' | 'privacy' | 'terms';

interface MenuDrawerProps {
  onClose: () => void;
  onOpenInfo: (modal: MenuInfoModal) => void;
  onOpenSupport: () => void;
  onOpenAbout: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  hasSupportReply?: boolean;
  supportUnreadCount?: number;
  hasUnreadUpdates?: boolean;
  showAdmin: boolean;
  profile?: { avatar?: string; displayName?: string };
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const rowClass =
  'w-full flex items-center gap-3 h-12 px-3 rounded-xl text-[length:calc(15px_*_var(--fs,1))] text-fg/90 text-left transition-colors cursor-pointer hover:bg-raised hover:text-fg';

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="py-3 border-t border-line first:border-t-0 first:pt-1">
    <h3 className="px-3 pb-1 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.18em] text-subtle">{title}</h3>
    <ul>{children}</ul>
  </section>
);

/**
 * Secondary navigation for phones and tablets (the footer is hidden there).
 * A right-side drawer rendered in a portal: the sticky header's backdrop-filter would otherwise
 * trap a fixed child inside the header box.
 */
export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  onClose,
  onOpenInfo,
  onOpenSupport,
  onOpenAbout,
  onOpenProfile,
  onOpenSettings,
  onOpenWhatsNew,
  isSoundMuted,
  onToggleSound,
  hasSupportReply = false,
  supportUnreadCount = 0,
  hasUnreadUpdates = false,
  showAdmin,
  profile = {},
}) => {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close first so the destination dialog takes over focus and scroll lock cleanly.
  const then = (action: () => void) => () => {
    onClose();
    action();
  };

  const info = (id: MenuInfoModal, label: string, Icon: React.ElementType) => (
    <li key={id}>
      <button className={rowClass} onClick={then(() => onOpenInfo(id))}>
        <Icon className="w-[18px] h-[18px] text-lavender shrink-0" />
        {label}
      </button>
    </li>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="qs-drawer absolute right-0 inset-y-0 w-[min(20rem,88vw)] flex flex-col bg-surface border-l border-line shadow-2xl shadow-black/50 pt-safe"
      >
        <div className="flex items-center gap-3 h-14 pl-5 pr-3 shrink-0">
          <h2 id={titleId} className="flex-1 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">
            Menu
          </h2>
          <button ref={closeRef} onClick={onClose} className="icon-btn" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={then(onOpenProfile)}
            data-testid="menu-profile"
            className="mb-2 flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line-strong bg-gradient-to-br from-raised to-surface p-3 text-left transition-colors hover:border-lavender/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender/60"
          >
            <AnimalAvatar avatar={profile.avatar} seed={profile.displayName || 'guest'} className="h-11 w-11 shrink-0 rounded-full ring-1 ring-line-strong" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg">{profile.displayName || 'Your profile'}</span>
              <span className="block text-[length:calc(12.5px_*_var(--fs,1))] text-lavender">My profile</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          </button>

          <Group title="Information">
            <li>
              <button className={rowClass} onClick={then(onOpenWhatsNew)}>
                <Sparkles className="w-[18px] h-[18px] text-lavender shrink-0" />
                <span className="flex-1">What’s New</span>
                {hasUnreadUpdates && (
                  <span className="w-2.5 h-2.5 rounded-full bg-berry">
                    <span className="sr-only">New updates</span>
                  </span>
                )}
              </button>
            </li>
            {info('about', 'About', Info)}
            <li>
              <button className={rowClass} onClick={then(onOpenAbout)}>
                <HeartHandshake className="w-[18px] h-[18px] text-lavender shrink-0" />
                Our Story
              </button>
            </li>
            {info('faq', 'FAQ', CircleHelp)}
          </Group>

          <Group title="Safety & Privacy">
            {info('guidelines', 'Community Guidelines', Shield)}
            {info('privacy', 'Privacy', Lock)}
            {info('terms', 'Terms', FileText)}
          </Group>

          <Group title="Support">
            <li>
              <button className={rowClass} onClick={then(onOpenSupport)}>
                <MessageCircleHeart className="w-[18px] h-[18px] text-lavender shrink-0" />
                <span className="flex-1">Chat with us</span>
                <SupportUnreadBadge count={supportUnreadCount} />
              </button>
            </li>
            <li>
              <a href={BMC_URL} target="_blank" rel="noopener noreferrer" className={rowClass} onClick={onClose}>
                <Coffee className="w-[18px] h-[18px] text-lavender shrink-0" />
                Buy me a coffee
              </a>
            </li>
          </Group>

          <Group title="Preferences">
            <li>
              <button className={rowClass} onClick={onToggleSound} role="switch" aria-checked={!isSoundMuted}>
                {isSoundMuted ? (
                  <VolumeX className="w-[18px] h-[18px] text-lavender shrink-0" />
                ) : (
                  <Volume2 className="w-[18px] h-[18px] text-lavender shrink-0" />
                )}
                <span className="flex-1">Sound</span>
                <span className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">{isSoundMuted ? 'Off' : 'On'}</span>
              </button>
            </li>
            <li>
              <button className={rowClass} onClick={then(onOpenSettings)}>
                <Settings2 className="w-[18px] h-[18px] text-lavender shrink-0" />
                Settings & appearance
              </button>
            </li>
          </Group>

          <Group title="Account">
            <li>
              <button className={rowClass} onClick={() => setConfirmingSignOut(true)} aria-expanded={confirmingSignOut} data-testid="menu-signout">
                <LogOut className="w-[18px] h-[18px] text-lavender shrink-0" />
                Sign out
              </button>
            </li>
            {confirmingSignOut && (
              <li role="alertdialog" aria-label="Confirm sign out" className="mx-1 mb-1 rounded-xl border border-berry/40 bg-berry/10 p-3 text-[length:calc(13px_*_var(--fs,1))] text-fg/90">
                <p>Your QUEERSPACE account lives on this device and has no password. Signing out removes your profile and connections from it, and they can’t be brought back.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setConfirmingSignOut(false)} className="btn btn-ghost flex-1" autoFocus>Stay signed in</button>
                  <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void signOutMember(); }} className="btn btn-danger flex-1" data-testid="menu-signout-confirm">Sign out</button>
                </div>
              </li>
            )}
          </Group>

          {showAdmin && (
            <Group title="Administration">
              <li>
                <a href="/admin" className={`${rowClass} text-berry hover:text-berry-hover`}>
                  <LayoutDashboard className="w-[18px] h-[18px] shrink-0" />
                  Admin dashboard
                </a>
              </li>
            </Group>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
