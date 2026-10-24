import React from 'react';
import { X, Shield, Lock, FileText, Mail, Heart, CheckCircle2 } from 'lucide-react';

interface InfoModalsProps {
  activeModal: 'about' | 'guidelines' | 'privacy' | 'terms' | 'contact' | null;
  onClose: () => void;
}

export const InfoModals: React.FC<InfoModalsProps> = ({ activeModal, onClose }) => {
  if (!activeModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#17121B]/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-[#241B29] rounded-3xl border border-[#403247] max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-[#403247] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {activeModal === 'about' && <Heart className="w-5 h-5 text-[#C77DAA]" />}
            {activeModal === 'guidelines' && <Shield className="w-5 h-5 text-[#C77DAA]" />}
            {activeModal === 'privacy' && <Lock className="w-5 h-5 text-[#C77DAA]" />}
            {activeModal === 'terms' && <FileText className="w-5 h-5 text-[#C77DAA]" />}
            {activeModal === 'contact' && <Mail className="w-5 h-5 text-[#C77DAA]" />}
            <h3 className="font-serif text-xl font-bold text-[#F7F0F6]">
              {activeModal === 'about' && 'About QUEERSPACE'}
              {activeModal === 'guidelines' && 'Community Guidelines'}
              {activeModal === 'privacy' && 'Privacy & Anonymity Policy'}
              {activeModal === 'terms' && 'Terms of Service'}
              {activeModal === 'contact' && 'Contact & Support'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#302235] text-[#BDB0BF] hover:text-[#F7F0F6] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="px-6 py-5 overflow-y-auto space-y-4 text-sm text-[#BDB0BF] leading-relaxed">
          {activeModal === 'about' && (
            <>
              <p>
                <strong className="text-[#F7F0F6]">QUEERSPACE</strong> is a dedicated platform for women to discover meaningful and unexpected connections: a sapphic space for women where you can find your space, your people, and your possibilities.
              </p>
              <p>
                Unlike generic anonymous chat sites that are plagued with bots, aggressive solicitations, and inappropriate behavior, QUEERSPACE is grounded in mutual comfort, curiosity, and emotional safety.
              </p>
              <div className="bg-[#302235] p-4 rounded-2xl border border-[#403247] text-xs text-[#F7F0F6] space-y-2">
                <div className="font-bold text-[#C77DAA]">Core Foundations:</div>
                <ul className="list-disc pl-4 space-y-1 text-[#BDB0BF]">
                  <li>Conversation-first design inspired by pure, unpretentious interaction.</li>
                  <li>No account barriers, invasive tracking, or algorithmic pressure.</li>
                  <li>Clear autonomy: leave, skip, block, or report at any instant.</li>
                </ul>
              </div>
            </>
          )}

          {activeModal === 'guidelines' && (
            <>
              <p>To preserve a warm and safe sanctuary, all participants agree to:</p>
              <div className="space-y-3">
                <div className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[#F7F0F6]">Respect Sapphic Space:</strong> This platform is solely for women and eligible sapphic people. Men and bad-faith impostors are strictly barred.
                  </div>
                </div>
                <div className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[#F7F0F6]">Zero Tolerance for Harassment:</strong> Hate speech, transphobia, racism, or sexual harassment result in immediate, permanent bans.
                  </div>
                </div>
                <div className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[#F7F0F6]">Consent & Boundaries:</strong> Unsolicited explicit sexual comments or requests for external private contacts without mutual enthusiasm are prohibited.
                  </div>
                </div>
                <div className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[#F7F0F6]">18+ Community:</strong> All users must be at least 18 years of age.
                  </div>
                </div>
              </div>
            </>
          )}

          {activeModal === 'privacy' && (
            <>
              <p>We believe genuine conversations thrive when you are free from surveillance:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong className="text-[#F7F0F6]">Zero Mandatory Registration:</strong> We do not ask for or store phone numbers, real names, or email addresses. You are assigned a pseudonymous anonymous ID automatically.</li>
                <li><strong className="text-[#F7F0F6]">Anonymous Session Persistence & Loss:</strong> Your anonymous session is preserved in your browser storage. If you clear site data, reset browser cookies, or switch devices, a new anonymous session will be generated. Persistent account recovery is not required for private beta access.</li>
                <li><strong className="text-[#F7F0F6]">Ephemeral Chat Transcripts:</strong> Private 1-on-1 conversations are kept only in your active chat session. When either participant leaves or blocks, the conversation is ended.</li>
                <li><strong className="text-[#F7F0F6]">Local Demo Mode Disclosure:</strong> If cloud connectivity is unconfigured or offline, QUEERSPACE operates in Local Demo Mode using simulated peers to preserve UI usability without claiming false cloud connections.</li>
                <li><strong className="text-[#F7F0F6]">Honest Safety Disclosure:</strong> While conversations are anonymous, never share financial credentials, home addresses, or private passwords with strangers.</li>
              </ul>
            </>
          )}

          {activeModal === 'terms' && (
            <>
              <p className="text-xs uppercase tracking-wider font-bold text-[#C77DAA]">Terms of Service</p>
              <p>
                By using QUEERSPACE, you affirm that you are at least 18 years old and identify as a woman or non-binary person who is part of the sapphic / women-loving-women community.
              </p>
              <p>
                You agree not to use the service for automated scraping, spam, impersonation, commercial solicitation, or any unlawful acts. We reserve the right to restrict access to anyone who endangers community wellbeing.
              </p>
            </>
          )}

          {activeModal === 'contact' && (
            <>
              <p>
                Have feedback, questions, or need to flag a safety incident? We are here to listen.
              </p>
              <div className="bg-[#302235] p-4 rounded-2xl border border-[#403247] space-y-2 text-xs">
                <div><strong className="text-[#F7F0F6]">Support & Moderation:</strong> safety@queerspace.chat</div>
                <div><strong className="text-[#F7F0F6]">Community Suggestions:</strong> hello@queerspace.chat</div>
                <div><strong className="text-[#F7F0F6]">Response Time:</strong> Typically within 24 hours.</div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-[#17121B] border-t border-[#403247] rounded-b-3xl flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-[#C77DAA] hover:bg-[#b86b9a] text-[#17121B] text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
