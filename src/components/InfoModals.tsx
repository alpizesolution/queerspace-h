import React from 'react';
import { Check } from 'lucide-react';
import { Sheet } from './Sheet.tsx';

type InfoModal = 'about' | 'guidelines' | 'privacy' | 'terms' | 'contact';

interface InfoModalsProps {
  activeModal: InfoModal | null;
  onClose: () => void;
}

const TITLES: Record<InfoModal, string> = {
  about: 'About QUEERSPACE',
  guidelines: 'Community Guidelines',
  privacy: 'Privacy & Anonymity',
  terms: 'Terms of Service',
  contact: 'Contact & Support',
};

const Strong: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong className="font-semibold text-fg">{children}</strong>
);

export const InfoModals: React.FC<InfoModalsProps> = ({ activeModal, onClose }) => {
  if (!activeModal) return null;

  return (
    <Sheet
      title={TITLES[activeModal]}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex justify-end">
          <button onClick={onClose} className="btn btn-secondary w-full sm:w-auto">
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {activeModal === 'about' && (
          <>
            <p>
              <Strong>QUEERSPACE</Strong> is a sapphic space for women to find meaningful, unexpected
              connections. Your space. Your people. Your possibilities.
            </p>
            <p>
              Unlike generic anonymous chat sites, it's built around mutual comfort, curiosity and
              emotional safety.
            </p>
            <ul className="space-y-2">
              {[
                'Conversation-first, no account barriers.',
                'No invasive tracking or algorithmic pressure.',
                'Leave, skip, block or report at any moment.',
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Check className="w-4 h-4 text-berry shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {activeModal === 'guidelines' && (
          <>
            <p>To keep this a warm and safe space, everyone agrees to:</p>
            <ul className="space-y-3">
              {[
                ['Respect the sapphic space.', 'For women and eligible sapphic people only. Men and bad-faith impostors are barred.'],
                ['Zero tolerance for harassment.', 'Hate speech, transphobia, racism or sexual harassment lead to permanent bans.'],
                ['Consent and boundaries.', 'No unsolicited explicit messages or pushing for private contacts.'],
                ['18+ only.', 'All users must be at least 18 years old.'],
              ].map(([title, text]) => (
                <li key={title} className="flex gap-2.5">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <Strong>{title}</Strong> {text}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13px]">
              In a chat, tap the shield icon to report and block. It ends the conversation immediately.
            </p>
          </>
        )}

        {activeModal === 'privacy' && (
          <ul className="space-y-3">
            <li>
              <Strong>No registration.</Strong> We don't ask for phone numbers, real names or emails. You
              get an anonymous ID automatically.
            </li>
            <li>
              <Strong>Session storage.</Strong> Your anonymous session lives in this browser. Clearing site
              data or switching devices starts a new one.
            </li>
            <li>
              <Strong>Ephemeral chats.</Strong> 1-on-1 conversations end when either person leaves or
              blocks.
            </li>
            <li>
              <Strong>Demo mode.</Strong> If the cloud is unavailable, QUEERSPACE runs locally with
              simulated peers and labels them as demo.
            </li>
            <li>
              <Strong>Stay safe.</Strong> Never share financial details, your home address or passwords
              with strangers.
            </li>
          </ul>
        )}

        {activeModal === 'terms' && (
          <>
            <p>
              By using QUEERSPACE, you affirm that you are at least 18 and identify as a woman or
              non-binary person in the sapphic / women-loving-women community.
            </p>
            <p>
              You agree not to use the service for scraping, spam, impersonation, commercial solicitation
              or anything unlawful. We may restrict access for anyone who endangers the community.
            </p>
          </>
        )}

        {activeModal === 'contact' && (
          <>
            <p>Feedback, questions, or a safety incident to flag? We're listening.</p>
            <dl className="card divide-y divide-line text-[13px]">
              {[
                ['Safety & moderation', 'safety@queerspace.chat'],
                ['Suggestions', 'hello@queerspace.chat'],
                ['Response time', 'Usually within 24 hours'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-3">
                  <dt>{k}</dt>
                  <dd className="text-fg font-medium text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Sheet>
  );
};
