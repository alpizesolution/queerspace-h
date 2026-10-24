import React from 'react';

interface FooterProps {
  onOpenModal: (modal: 'about' | 'guidelines' | 'privacy' | 'terms' | 'contact') => void;
  onOpenDonation: () => void;
  className?: string;
}

const LINKS = [
  { id: 'about', label: 'About' },
  { id: 'guidelines', label: 'Guidelines' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
  { id: 'contact', label: 'Suggestions' },
] as const;

export const Footer: React.FC<FooterProps> = ({ onOpenModal, onOpenDonation, className = '' }) => (
  <footer className={`border-t border-line text-[13px] text-subtle ${className}`}>
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
      <p className="sm:mr-auto">© {new Date().getFullYear()} QUEERSPACE PH · For women who love women</p>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-1 -mx-2">
        {LINKS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onOpenModal(id)}
            className="px-2 py-1.5 rounded-md hover:text-fg transition-colors cursor-pointer"
          >
            {label}
          </button>
        ))}
        <button
          onClick={onOpenDonation}
          className="px-2 py-1.5 rounded-md text-berry hover:text-berry-hover transition-colors cursor-pointer"
        >
          ♡ Support us
        </button>
      </nav>
    </div>
  </footer>
);
