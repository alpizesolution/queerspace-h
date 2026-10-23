import React from 'react';
import { Sparkles, Heart } from 'lucide-react';
import { AnimatedBrandTitle } from './AnimatedBrandTitle.tsx';

interface FooterProps {
  onOpenModal: (modal: 'about' | 'guidelines' | 'privacy' | 'terms' | 'contact') => void;
  onOpenDonation: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenModal, onOpenDonation }) => {
  return (
    <footer className="bg-[#080311] border-t border-[#4a1f6d] pt-12 pb-10 text-sm text-[#cbbccf]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b border-[#4a1f6d]">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg overflow-hidden bg-[#230d3b] flex items-center justify-center border border-[#4a1f6d]">
                <img src="/assets/aistudio/queerspace_cbcdbe4c.png" alt="QUEERSPACE Logo" className="w-full h-full object-cover" />
              </div>
              <AnimatedBrandTitle sizeClass="text-lg" />
            </div>
            <p className="text-xs text-[#cbbccf] max-w-sm">
              A Sapphic Space for Women. Your space. Your people. Your possibilities.
            </p>
          </div>

          <div className="flex flex-wrap gap-y-2 gap-x-6 text-xs sm:text-sm">
            <button
              onClick={() => onOpenModal('about')}
              className="hover:text-[#fcf7fa] transition-colors cursor-pointer"
            >
              About
            </button>
            <button
              onClick={() => onOpenModal('guidelines')}
              className="hover:text-[#fcf7fa] transition-colors cursor-pointer"
            >
              Community Guidelines
            </button>
            <button
              onClick={() => onOpenModal('privacy')}
              className="hover:text-[#fcf7fa] transition-colors cursor-pointer"
            >
              Privacy & Anonymity
            </button>
            <button
              onClick={() => onOpenModal('terms')}
              className="hover:text-[#fcf7fa] transition-colors cursor-pointer"
            >
              Terms of Service
            </button>
            <button
              onClick={() => onOpenModal('contact')}
              className="hover:text-[#fcf7fa] transition-colors cursor-pointer"
            >
              Contact & Support
            </button>
            <button
              onClick={onOpenDonation}
              className="text-[#e07bb8] hover:text-[#fcf7fa] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>♡ Support QUEERSPACE</span>
            </button>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#cbbccf]/80">
          <p>© {new Date().getFullYear()} QUEERSPACE. Built for the sapphic community.</p>
          <div className="flex items-center gap-1">
            <span>Made with</span>
            <Heart className="w-3.5 h-3.5 text-[#e07bb8] fill-[#e07bb8]" />
            <span>for women who love women.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
