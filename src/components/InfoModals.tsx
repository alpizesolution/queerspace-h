import React from 'react';
import { Check } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { SuggestionForm } from './SuggestionForm.tsx';

type InfoModal = 'about' | 'faq' | 'guidelines' | 'privacy' | 'terms' | 'contact';

interface InfoModalsProps {
  activeModal: InfoModal | null;
  onClose: () => void;
  onOpenSupport: () => void;
}

const CONTACT_EMAIL = 'info.queerspaceph@gmail.com';

const TITLES: Record<InfoModal, string> = {
  about: 'About QUEERSPACE PH',
  faq: 'FAQ',
  guidelines: 'Community Guidelines',
  privacy: 'Privacy & Anonymity',
  terms: 'Terms of Service',
  contact: 'Suggestions & Contact',
};

const Strong: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong className="font-semibold text-fg">{children}</strong>
);

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How do I change my name or avatar?',
    a: (
      <>
        Tap your <Strong>animal avatar at the top right</Strong>. Type a new name or tap the dice for a
        random pseudonym, tap the avatar to shuffle it, then <Strong>Save profile</Strong>. Your new name
        shows on everything you post from then on; older posts keep the name they were posted with.
      </>
    ),
  },
  {
    q: 'How do I post in Cosmos?',
    a: (
      <>
        Open <Strong>Cosmos</Strong> and tap <Strong>New post</Strong>. Add a title, what's on your mind,
        a category and up to 4 tags, then <Strong>Post</Strong>. Everyone sees it right away and can like or
        reply. You can post once every 30 seconds, and delete your own post with the trash icon.
      </>
    ),
  },
  {
    q: 'What is Echoes? Can people see who wrote it?',
    a: (
      <>
        Echoes is for things you can't say out loud. Pick <Strong>Vent</Strong> or{' '}
        <Strong>Confession</Strong>, write it and tap <Strong>Let it out</Strong>. No name or avatar is
        shown. Posts fade after 48 hours, and you can post once a minute.
        Links, @handles and phone numbers are blocked to keep everyone anonymous.
      </>
    ),
  },
  {
    q: 'How does 1-on-1 chat work?',
    a: (
      <>
        Tap <Strong>Find Your Someone</Strong> and we'll pair you with someone who's online right now.
        Swipe a message right to reply to it, or tap it to react. Chats end when either of you leaves, and
        nothing is kept afterwards.
      </>
    ),
  },
  {
    q: 'Do I need an account?',
    a: (
      <>
        No. You get an anonymous ID automatically. It lives in this browser, so clearing site data or
        switching phones starts you fresh with a new name.
      </>
    ),
  },
  {
    q: 'Someone made me uncomfortable. What do I do?',
    a: (
      <>
        In a chat, tap the <Strong>shield</Strong> to report and block. They can't match with you again. On
        posts, tap the <Strong>flag</Strong>. Our team reviews every report.
      </>
    ),
  },
  {
    q: 'Can I install it like an app?',
    a: (
      <>
        Yes. On iPhone, open it in Safari, tap Share, then <Strong>Add to Home Screen</Strong>. On Android,
        tap <Strong>Install</Strong> when it's offered, or use the browser menu.
      </>
    ),
  },
];

export const InfoModals: React.FC<InfoModalsProps> = ({ activeModal, onClose, onOpenSupport }) => {
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
              <Strong>QUEERSPACE PH</Strong> is a sapphic space for women to find meaningful, unexpected
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

        {activeModal === 'faq' && (
          <div className="space-y-2">
            {FAQS.map(({ q, a }, i) => (
              <details key={q} open={i === 0} className="group card bg-raised/40 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none text-[14px] font-semibold text-fg">
                  {q}
                  <span aria-hidden="true" className="text-berry text-lg leading-none transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[13.5px] leading-relaxed">{a}</p>
              </details>
            ))}
            <p className="pt-2 text-[13px]">
              Still stuck?{' '}
              <button onClick={onOpenSupport} className="text-berry font-medium hover:text-berry-hover cursor-pointer">
                Chat with us
              </button>{' '}
              and we'll help.
            </p>
          </div>
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
              <Strong>Anonymous analytics.</Strong> We count visits and which sections are used, through Google
              Analytics. It never sees your chats or posts.
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
            <p>Got an idea, spotted a bug, or something feels unsafe? Tell us.</p>
            <SuggestionForm />
            <p className="pt-2">
              Need a reply?{' '}
              <button onClick={onOpenSupport} className="text-berry font-medium hover:text-berry-hover cursor-pointer">
                Chat with the team
              </button>
              , or email us for anything longer.
            </p>
            <dl className="card divide-y divide-line text-[13px]">
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt>Email</dt>
                <dd className="text-right min-w-0">
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-berry hover:text-berry-hover font-medium break-all"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </dd>
              </div>
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt>Response time</dt>
                <dd className="text-fg font-medium text-right">Usually within 24 hours</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </Sheet>
  );
};
