import React from 'react';
import { ShieldCheck, UserX, AlertTriangle, EyeOff, CheckCircle2 } from 'lucide-react';

interface SafetySectionProps {
  onOpenGuidelinesModal: () => void;
}

export const SafetySection: React.FC<SafetySectionProps> = ({ onOpenGuidelinesModal }) => {
  const safetyFeatures = [
    {
      icon: EyeOff,
      title: 'Real Privacy by Design',
      description: 'You are never required to link social accounts, phone numbers, or real identities. What you share is always your choice.',
    },
    {
      icon: UserX,
      title: 'Instant Leave & Block',
      description: 'You have full autonomy. If a conversation feels awkward or unwelcome, one click leaves immediately and prevents rematching.',
    },
    {
      icon: AlertTriangle,
      title: 'One-Click Reporting',
      description: 'Zero tolerance for harassment, unsolicited NSFW content, or male impostors. Reports are logged and violators are permanently blocked.',
    },
    {
      icon: ShieldCheck,
      title: 'Curated Sapphic Space',
      description: 'A sanctuary designed specifically for women and eligible non-binary sapphic folks to converse without being sexualized or harassed.',
    },
  ];

  return (
    <section className="py-14 max-w-5xl mx-auto px-4 sm:px-6">
      <div className="glass-card rounded-3xl p-6 sm:p-10 shadow-xl">
        <div className="max-w-2xl mb-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#e07bb8] bg-[#230d3b] px-3 py-1 rounded-full border border-[#4a1f6d] mb-3">
            <ShieldCheck className="w-3.5 h-3.5" />
            Safety & Boundaries First
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#fcf7fa]">
            Your Peace of Mind Matters Most
          </h2>
          <p className="text-sm sm:text-base text-[#cbbccf] mt-2 leading-relaxed">
            QUEERSPACE was created to be the opposite of hostile, impersonal internet chat platforms. Every feature is built with sapphic dignity, mutual respect, and emotional safety at the center.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
          {safetyFeatures.map((feat) => {
            const Icon = feat.icon;
            return (
              <div key={feat.title} className="flex gap-3.5 items-start p-4 rounded-2xl bg-[#230d3b]/80 border border-[#4a1f6d]">
                <div className="w-9 h-9 rounded-xl bg-[#150826] text-[#e07bb8] flex items-center justify-center shrink-0 border border-[#4a1f6d]">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-[#fcf7fa] mb-1">
                    {feat.title}
                  </h4>
                  <p className="text-xs text-[#cbbccf] leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-[#4a1f6d]">
          <div className="flex items-center gap-2 text-xs text-[#cbbccf]">
            <CheckCircle2 className="w-4 h-4 text-[#e07bb8]" />
            <span>Strict 18+ policy for all participants. Be kind, be real.</span>
          </div>
          <button
            onClick={onOpenGuidelinesModal}
            className="text-xs sm:text-sm font-semibold text-[#e07bb8] hover:text-[#fcf7fa] underline underline-offset-4 cursor-pointer transition-colors"
          >
            Read Community Guidelines & Code of Conduct →
          </button>
        </div>
      </div>
    </section>
  );
};
