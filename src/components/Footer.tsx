import React from 'react';
import { LayoutDashboard, MessageCircleHeart } from 'lucide-react';
import { isAdminDevice } from '../utils/adminDevice.ts';

// On phones the header has no room, so the admin shortcut lives here.
const SHOW_ADMIN_LINK = isAdminDevice();

/** Buy Me a Coffee page, styled like their official button (their embed script can't run in this app). */
export const BMC_URL = 'https://www.buymeacoffee.com/donotdm';

interface FooterProps {
  onOpenModal: (modal: 'about' | 'faq' | 'guidelines' | 'privacy' | 'terms' | 'contact') => void;
  onOpenSupport: () => void;
  /** The team replied and the member hasn't read it yet. */
  hasSupportReply?: boolean;
  className?: string;
}

const LINKS = [
  { id: 'about', label: 'About' },
  { id: 'faq', label: 'FAQ' },
  { id: 'guidelines', label: 'Guidelines' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
] as const;

export const Footer: React.FC<FooterProps> = ({ onOpenModal, onOpenSupport, hasSupportReply = false, className = '' }) => (
  <footer className={`border-t border-line text-subtle ${className}`}>
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 sm:py-6 flex flex-col items-center text-center gap-4 sm:flex-row sm:text-left sm:gap-6">
      <div className="sm:mr-auto">
        <p className="text-[13px] font-semibold tracking-[0.18em] text-fg/90">QUEERSPACE PH</p>
        <p className="text-[12px] mt-0.5">
          <span className="hidden sm:inline">© {new Date().getFullYear()} · </span>For women who love women
        </p>
      </div>

      <nav aria-label="Footer" className="flex flex-wrap items-center justify-center text-[13px]">
        {LINKS.map(({ id, label }, i) => (
          <React.Fragment key={id}>
            {i > 0 && <span aria-hidden="true" className="w-0.5 h-0.5 rounded-full bg-subtle/60" />}
            <button
              onClick={() => onOpenModal(id)}
              className="px-2 sm:px-2.5 py-2 rounded-md hover:text-fg transition-colors cursor-pointer"
            >
              {label}
            </button>
          </React.Fragment>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <button onClick={onOpenSupport} className="chip relative h-8 px-3 text-[12px]">
          <MessageCircleHeart className="w-3.5 h-3.5" />
          Chat with us
          {hasSupportReply && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-berry ring-2 ring-ink">
              <span className="sr-only">New reply from the team</span>
            </span>
          )}
        </button>
        <a
          href={BMC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#FFDD00] text-black border border-black font-[Cookie,cursive] text-[19px] leading-none whitespace-nowrap hover:brightness-95 transition"
        >
          <span aria-hidden="true" className="text-[14px]">☕</span>
          Buy me a coffee
        </a>
      </div>

      {SHOW_ADMIN_LINK && (
        <a href="/admin" className="chip h-8 px-3 text-[12px] text-berry sm:hidden">
          <LayoutDashboard className="w-3.5 h-3.5" />
          Admin
        </a>
      )}

      <p className="text-[11px] text-subtle/80 sm:hidden">© {new Date().getFullYear()} QUEERSPACE PH</p>
    </div>
  </footer>
);
