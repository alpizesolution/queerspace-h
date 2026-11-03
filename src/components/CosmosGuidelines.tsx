import React, { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Ban,
  Compass,
  EyeOff,
  FileText,
  Heart,
  HeartHandshake,
  Lock,
  MessageCircle,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';

interface Rule {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  title: string;
  text: string;
}

export const INTRO = 'COSMOS is a shared space for WLW to connect, express themselves, and build meaningful relationships.';

export const COMMUNITY_RULES: Rule[] = [
  { icon: Heart, title: 'Respect Everyone', text: 'Treat members with kindness. Respect identities, pronouns, boundaries, and personal experiences.' },
  { icon: MessageCircle, title: 'Keep Conversations Meaningful', text: 'Share genuine thoughts, experiences, questions, and discussions. Avoid spam, flooding, and repetitive promotions.' },
  { icon: Lock, title: 'Protect Privacy', text: 'Never publish another person’s private messages, personal information, photos, or identity without consent.' },
  { icon: Ban, title: 'No Harassment or Discrimination', text: 'Hate speech, threats, bullying, outing, impersonation, and targeted harassment are prohibited.' },
  { icon: FileText, title: 'Post Responsibly', text: 'Keep content relevant to the selected category. Use appropriate content warnings where supported.' },
];

export const LOOKING_FOR_RULES: Rule[] = [
  { icon: Compass, title: 'Be Genuine About Your Intentions', text: 'Choose the intention that accurately describes the connection you are seeking, such as friendship, dating, someone to talk to, gaming buddy, or other connections.' },
  { icon: FileText, title: 'Write Thoughtful Posts', text: 'Complete both About Me and About You honestly. Give members a meaningful understanding of who you are and the kind of connection you hope to find.' },
  { icon: HeartHandshake, title: 'Respect Consent', text: 'A connection request is an invitation, not an obligation. Respect acceptance, rejection, silence, and personal boundaries.' },
  { icon: EyeOff, title: 'No Unsolicited Explicit Content', text: 'Never send unsolicited intimate images or sexually explicit messages. Selecting NSFW Connection does not automatically mean consent to receive explicit content.' },
  { icon: UserCheck, title: 'Respect Identity and Preferences', text: 'Do not pressure members to change their identity, preferences, or relationship expectations.' },
  { icon: Users, title: 'No Misleading Posts', text: 'Do not impersonate someone, use misleading information, or create posts intended to scam, exploit, or manipulate other members.' },
];

export const SAFETY_TIPS: string[] = [
  'Do not share passwords, financial information, or sensitive personal details.',
  'Be cautious when sharing your location.',
  'Be careful when arranging in-person meetups.',
  'Report suspicious, abusive, or misleading accounts.',
  'Block anyone who makes you uncomfortable.',
  'Remember that online identities may not always be genuine.',
];

export const MODERATION = 'Content that violates these guidelines may be removed. Accounts involved in serious or repeated violations may face restrictions or suspension.';
export const CLOSING_TITLE = 'Your space. Your boundaries. Your community.';
export const CLOSING_TEXT = 'Let’s make QUEERSPACE a place where everyone can feel respected, welcome, and free to be themselves.';

const RuleList: React.FC<{ rules: Rule[] }> = ({ rules }) => (
  <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-raised/40">
    {rules.map(({ icon: Icon, title, text }) => (
      <li key={title} className="flex items-start gap-3 px-3.5 py-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-plum/30 text-lavender"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h3 className="text-[length:calc(15px_*_var(--fs,1))] font-semibold leading-snug text-fg">{title}</h3>
          <p className="mt-0.5 text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted [overflow-wrap:anywhere]">{text}</p>
        </div>
      </li>
    ))}
  </ul>
);

const SectionTitle: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h2 id={id} className="mb-2.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">{children}</h2>
);

/**
 * The COSMOS guidelines as a full-screen page over Cosmos, opened from the information icon in its header. Back closes it, so
 * does Escape and the phone's back gesture (the page takes one history entry while it is open), and Cosmos underneath is
 * exactly as it was left. It reads only: nothing here changes how posts are made or how connections work.
 */
export const CosmosGuidelines: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entry = useRef(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    window.history.pushState({ qsGuidelines: true }, '');
    entry.current = true;
    const onPop = () => { entry.current = false; closeRef.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') goBack(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back and Escape go back one history step, which closes the page and leaves no extra entry behind; the phone's back
  // gesture does the same thing. If there is no entry to go back through, it simply closes.
  function goBack() {
    if (entry.current && window.history.state?.qsGuidelines) window.history.back();
    else closeRef.current();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="COSMOS Guidelines" className="fixed inset-0 z-[45] flex flex-col bg-ink">
      <header className="flex shrink-0 items-center gap-1 border-b border-line/60 px-2 pb-1.5 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={goBack} aria-label="Back" autoFocus className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 cursor-pointer">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-[length:calc(18px_*_var(--fs,1))] font-semibold tracking-tight text-fg">COSMOS Guidelines</h1>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] pt-4 sm:px-6 sm:pt-6">
          <p className="text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-fg">{INTRO}</p>

          <section aria-labelledby="g-community" className="mt-6">
            <SectionTitle id="g-community">Community Guidelines</SectionTitle>
            <RuleList rules={COMMUNITY_RULES} />
          </section>

          <section aria-labelledby="g-looking" className="mt-7">
            <SectionTitle id="g-looking">Looking For Guidelines</SectionTitle>
            <RuleList rules={LOOKING_FOR_RULES} />
          </section>

          <section aria-labelledby="g-safe" className="mt-7">
            <SectionTitle id="g-safe">Keep Yourself Safe</SectionTitle>
            <ul className="space-y-2.5 rounded-2xl border border-line bg-raised/40 px-3.5 py-3.5">
              {SAFETY_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-3 text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lavender" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{tip}</span>
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-7 text-[length:calc(13px_*_var(--fs,1))] leading-relaxed text-subtle">{MODERATION}</p>

          <div className="mt-8 rounded-2xl border border-line bg-gradient-to-b from-plum/25 to-transparent px-4 py-5 text-center">
            <p className="text-[length:calc(16px_*_var(--fs,1))] font-semibold leading-snug text-fg">{CLOSING_TITLE}</p>
            <p className="mt-2 text-[length:calc(14px_*_var(--fs,1))] leading-relaxed text-muted">{CLOSING_TEXT}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
