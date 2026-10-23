import React from 'react';
import { X, Heart, Coffee, ExternalLink } from 'lucide-react';

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#241B29] rounded-3xl border border-[#403247] max-w-md w-full my-auto shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#17121B] border-b border-[#403247] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl overflow-hidden bg-[#302235] flex items-center justify-center border border-[#403247]">
              <img src="/assets/aistudio/queerspace_cbcdbe4c.png" alt="QUEERSPACE Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-[#F7F0F6]">
                Support QUEERSPACE
              </h3>
              <p className="text-xs text-[#BDB0BF]">
                Optional community contribution
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#302235] text-[#BDB0BF] hover:text-[#F7F0F6] transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-[#F7F0F6] max-h-[70vh] overflow-y-auto leading-relaxed">
          <div className="space-y-3">
            <h4 className="font-serif font-bold text-base text-[#C77DAA]">
              Help Keep QUEERSPACE Going
            </h4>
            <p className="text-xs sm:text-sm text-[#BDB0BF]">
              QUEERSPACE is a space for connection, conversations, and community. Your support helps cover hosting and maintenance costs so we can continue providing a welcoming space for sapphic women.
            </p>
            <p className="text-xs sm:text-sm text-[#BDB0BF]">
              Every contribution, no matter how small, makes a difference.
            </p>
            <p className="text-xs sm:text-sm text-[#BDB0BF] italic">
              Donations are completely optional. Thank you for being part of QUEERSPACE. 💜
            </p>
          </div>

          {/* Donation Platforms / Options */}
          <div className="space-y-3 pt-2">
            <h5 className="text-xs font-bold uppercase tracking-wider text-[#F7F0F6]">
              Available Support Channel
            </h5>

            <div className="grid grid-cols-1 gap-2.5">
              <a
                href="https://ko-fi.com/alpize"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3.5 rounded-2xl bg-[#17121B] border border-[#403247] hover:border-[#C77DAA] transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#302235] text-[#C77DAA] flex items-center justify-center border border-[#403247]">
                    <Coffee className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-xs sm:text-sm text-[#F7F0F6] group-hover:text-[#C77DAA] transition-colors">
                      Support on Ko-fi
                    </div>
                    <div className="text-[11px] text-[#BDB0BF]">
                      ko-fi.com/alpize
                    </div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-[#BDB0BF] group-hover:text-[#F7F0F6]" />
              </a>
            </div>

            <p className="text-[10px] text-[#BDB0BF]/70 text-center pt-1">
              Donations are completely voluntary and deeply appreciated.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#17121B] border-t border-[#403247] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-[#302235] hover:bg-[#8E547E] text-[#F7F0F6] text-xs font-semibold transition-colors cursor-pointer border border-[#403247]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
