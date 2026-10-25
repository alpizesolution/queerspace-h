import React from 'react';
import { Coffee, ExternalLink } from 'lucide-react';
import { Sheet } from './Sheet.tsx';

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <Sheet title="Support QUEERSPACE" onClose={onClose} size="sm">
      <p>
        Your support helps cover hosting so QUEERSPACE stays a welcoming space for sapphic women.
        Completely optional, always appreciated. 💜
      </p>
      <a
        href="https://buymeacoffee.com/donotdm"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 card flex items-center gap-3 p-4 hover:border-line-strong hover:bg-raised transition-colors group"
      >
        <span className="w-10 h-10 rounded-xl bg-raised border border-line text-berry flex items-center justify-center">
          <Coffee className="w-5 h-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-fg">Buy us a coffee</span>
          <span className="block text-[13px] text-subtle">buymeacoffee.com/donotdm</span>
        </span>
        <ExternalLink className="w-4 h-4 text-subtle group-hover:text-fg" />
      </a>
    </Sheet>
  );
};
