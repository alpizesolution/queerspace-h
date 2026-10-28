import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Info,
  CircleHelp,
  BookHeart,
  Lock,
  FileText,
  MessageCircleHeart,
  Coffee,
  UserRound,
  Settings2,
  LayoutDashboard,
} from 'lucide-react';
import { BMC_URL } from './Footer.tsx';

export type MenuInfoModal = 'about' | 'faq' | 'guidelines' | 'privacy' | 'terms';

interface MenuDrawerProps {
  onClose: () => void;
  onOpenInfo: (modal: MenuInfoModal) => void;
  onOpenSupport: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  hasSupportReply?: boolean;
  showAdmin: boolean;
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
  onOpenProfile,
  onOpenSettings,
  hasSupportReply = false,
  showAdmin,
}) => {
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
      className="desk:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm anim-fade"
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
          <Group title="Information">
            {info('about', 'About', Info)}
            {info('faq', 'FAQ', CircleHelp)}
          </Group>

          <Group title="Safety & Privacy">
            {info('guidelines', 'Guidelines', BookHeart)}
            {info('privacy', 'Privacy', Lock)}
            {info('terms', 'Terms', FileText)}
          </Group>

          <Group title="Support">
            <li>
              <button className={rowClass} onClick={then(onOpenSupport)}>
                <MessageCircleHeart className="w-[18px] h-[18px] text-lavender shrink-0" />
                <span className="flex-1">Chat with us</span>
                {hasSupportReply && (
                  <span className="w-2.5 h-2.5 rounded-full bg-berry">
                    <span className="sr-only">New reply from the team</span>
                  </span>
                )}
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
              <button className={rowClass} onClick={then(onOpenSettings)}>
                <Settings2 className="w-[18px] h-[18px] text-lavender shrink-0" />
                Settings & appearance
              </button>
            </li>
          </Group>

          <Group title="Account">
            <li>
              <button className={rowClass} onClick={then(onOpenProfile)}>
                <UserRound className="w-[18px] h-[18px] text-lavender shrink-0" />
                Edit profile
              </button>
            </li>
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
