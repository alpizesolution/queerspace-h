import React, { useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Send } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { TEST_CATALOG, TEST_PRIVACY_NOTE, testById, type CatalogTest } from '../utils/testCatalog.ts';

/**
 * Tests: invite another member to an outside online test, or take one yourself. QUEERSPACE only sends the invitation. The test
 * opens as a plain link in a new tab (never inside QUEERSPACE, never in a frame), and nothing about answers or results is collected,
 * read or shared. The only addresses that can ever open are the ones in the catalog (src/utils/testCatalog.ts).
 */

/** Deep amber/teal identity, different from Comfort Cards (plum) and NSFW Cards (wine). Used for the invitation card and the panel. */
export const TEST_LOOK = { bg: '#0f2430', bg2: '#13303a', border: '#2f6f7c', accent: '#f3c969', text: '#eef7f8', meta: '#a9ccd2', btnText: '#241a00' } as const;

/** The link that opens a test: exactly the catalog address, in a new tab, with no opener and no referrer. */
export const TestLink: React.FC<{ test: CatalogTest; className?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ test, className, style, children }) => (
  <a href={test.url} target="_blank" rel="noopener noreferrer" className={className} style={style} data-testid="test-link" onClick={(event) => event.stopPropagation()}>
    {children}
  </a>
);

const DISMISS_KEY = 'queerspace_dismissed_test_invites';
const readDismissed = (): string[] => {
  try { const value = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(-200) : []; } catch { return []; }
};
const writeDismissed = (ids: string[]) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-200))); } catch { /* a dismissal is only a convenience */ } };

// ------------------------------------------------------------------------------------------------ the card in a conversation

interface BubbleProps {
  messageId: string;
  testId: string;
  /** True when this member sent the invitation. */
  mine: boolean;
  /** The inviter's pseudonym (the other member's, or "you"). */
  invitedBy: string;
  time?: string;
}

/** A Test Invitation in a conversation: the test, who invited, a clear Take Test action, and (for the invited member) Maybe later. */
export const TestInviteBubble: React.FC<BubbleProps> = ({ messageId, testId, mine, invitedBy, time }) => {
  const test = testById(testId);
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(messageId));
  if (!test) return null;
  const dismiss = () => { writeDismissed([...readDismissed(), messageId]); setDismissed(true); };
  return (
    <div className="min-w-0 max-w-full flex-auto" data-testid="test-invite" data-state={dismissed ? 'dismissed' : 'open'}>
      <div className="relative overflow-hidden rounded-2xl border py-3 pl-5 pr-4" style={{ backgroundImage: `linear-gradient(135deg, ${TEST_LOOK.bg}, ${TEST_LOOK.bg2})`, borderColor: TEST_LOOK.border, color: TEST_LOOK.text }}>
        <span aria-hidden="true" className="absolute inset-y-2.5 left-2 w-[3px] rounded-full" style={{ backgroundColor: TEST_LOOK.accent }} />
        <p className="flex items-center gap-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-wide" style={{ color: TEST_LOOK.accent }}>
          <span aria-hidden="true">{test.icon}</span> Test invitation
        </p>
        <p className="mt-1.5 text-[length:calc(16px_*_var(--fs,1))] font-semibold leading-snug">{test.name}</p>
        <p className="text-[length:calc(13.5px_*_var(--fs,1))] leading-snug" style={{ color: TEST_LOOK.meta }}>{test.description}</p>
        <p className="mt-1 text-[length:calc(12px_*_var(--fs,1))]" style={{ color: TEST_LOOK.meta }}>Invited by {invitedBy}</p>
        {dismissed ? (
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-[length:calc(13px_*_var(--fs,1))]" style={{ color: TEST_LOOK.meta }}>Maybe later.</span>
            <TestLink test={test} className="text-[length:calc(13px_*_var(--fs,1))] font-semibold underline underline-offset-4" style={{ color: TEST_LOOK.accent }}>Take Test anyway</TestLink>
          </div>
        ) : (
          <>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <TestLink test={test} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{ backgroundColor: TEST_LOOK.accent, color: TEST_LOOK.btnText }}>
                Take Test <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only"> (opens an outside website in a new tab)</span>
              </TestLink>
              {!mine && (
                <button type="button" onClick={(event) => { event.stopPropagation(); dismiss(); }} onKeyDown={(event) => event.stopPropagation()} className="inline-flex min-h-10 items-center rounded-full border px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition hover:brightness-125" style={{ borderColor: TEST_LOOK.border, color: TEST_LOOK.text }}>
                  Maybe later
                </button>
              )}
              {time && <span className="ml-auto text-[length:calc(12px_*_var(--fs,1))] tabular-nums" style={{ color: TEST_LOOK.meta }}>{time}</span>}
            </div>
            <p className="mt-2 text-[length:calc(11.5px_*_var(--fs,1))] leading-snug" style={{ color: TEST_LOOK.meta }}>{TEST_PRIVACY_NOTE}</p>
          </>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ the Tests section

export interface InvitablePair { id: string; partner?: { displayName: string | null; avatar: string | null } }

interface PanelProps {
  /** The member's active conversations: the only places an invitation can be sent. */
  pairs: InvitablePair[];
  /** Sends one invitation. `messageId` is stable per (conversation, test), so a repeated click can never make a second one. Resolves to null on success, or words for the member. */
  onInvite: (pairId: string, testId: string, messageId: string) => Promise<string | null>;
  /** Opens a conversation (after an invitation was sent). */
  onOpenConversation?: (pairId: string) => void;
}

const nameOf = (pair: InvitablePair) => pair.partner?.displayName?.trim() || 'Anonymous member';

export const TestsPanel: React.FC<PanelProps> = ({ pairs, onInvite, onOpenConversation }) => {
  const [inviting, setInviting] = useState<CatalogTest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  /** One message id per (conversation, test), kept for the life of the page: repeating a click repeats the same send, never a new one. */
  const ids = useRef(new Map<string, string>());
  const busyNow = useRef(false);

  const invite = async (pair: InvitablePair) => {
    if (!inviting || busyNow.current) return;
    const key = `${pair.id}:${inviting.id}`;
    if (sent.has(key)) return;
    busyNow.current = true;
    setBusy(pair.id);
    setProblem(null);
    if (!ids.current.has(key)) ids.current.set(key, crypto.randomUUID());
    const failure = await onInvite(pair.id, inviting.id, ids.current.get(key)!);
    busyNow.current = false;
    setBusy(null);
    if (failure) setProblem(failure);
    else setSent((current) => new Set(current).add(key));
  };

  return (
    <section aria-label="Tests" data-testid="tests-panel" className="space-y-3">
      <p className="text-[length:calc(13px_*_var(--fs,1))] leading-snug text-muted">Invite someone to an outside online test, or take one yourself. {TEST_PRIVACY_NOTE}</p>
      <ul className="space-y-3">
        {TEST_CATALOG.map((test) => (
          <li key={test.id} data-testid={`test-${test.id}`} className="rounded-2xl border p-4" style={{ backgroundImage: `linear-gradient(135deg, ${TEST_LOOK.bg}, ${TEST_LOOK.bg2})`, borderColor: TEST_LOOK.border, color: TEST_LOOK.text }}>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: 'rgba(243,201,105,0.14)' }}>{test.icon}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[length:calc(16px_*_var(--fs,1))] font-semibold leading-snug">{test.name}</h3>
                <p className="text-[length:calc(13.5px_*_var(--fs,1))] leading-snug" style={{ color: TEST_LOOK.meta }}>{test.description}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setProblem(null); setInviting(test); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2" style={{ backgroundColor: TEST_LOOK.accent, color: TEST_LOOK.btnText }}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" /> Invite<span className="sr-only"> someone to the {test.name}</span>
              </button>
              <TestLink test={test} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition hover:brightness-125" style={{ borderColor: TEST_LOOK.border, color: TEST_LOOK.text }}>
                Take it myself <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only"> ({test.name}, opens an outside website in a new tab)</span>
              </TestLink>
            </div>
          </li>
        ))}
      </ul>

      {inviting && (
        <Sheet title={`Invite to the ${inviting.name}`} onClose={() => setInviting(null)} size="sm">
          <div className="space-y-3 text-fg">
            <p className="text-sm text-muted">Choose a conversation. They get a card with the test and a Take Test button; it is their choice whether to open it.</p>
            {pairs.length === 0 ? (
              <p data-testid="no-conversations" className="rounded-xl border border-line px-3 py-4 text-center text-sm text-muted">You have no active conversations yet. Once you connect with someone, you can invite them here.</p>
            ) : (
              <ul className="space-y-1.5">
                {pairs.map((pair) => {
                  const done = sent.has(`${pair.id}:${inviting.id}`);
                  return (
                    <li key={pair.id}>
                      <button type="button" disabled={busy !== null || done} onClick={() => void invite(pair)} aria-label={`${done ? 'Invited' : 'Invite'} ${nameOf(pair)}`} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left transition hover:bg-raised disabled:cursor-default disabled:opacity-80">
                        <AnimalAvatar avatar={pair.partner?.avatar ?? undefined} seed={pair.id} className="h-8 w-8 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{nameOf(pair)}</span>
                        {busy === pair.id ? <LoaderCircle className="h-4 w-4 animate-spin text-berry" aria-hidden="true" /> : done ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-lavender"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Invited</span> : <span className="text-xs font-semibold text-berry">Invite</span>}
                      </button>
                      {done && onOpenConversation && <button type="button" onClick={() => { setInviting(null); onOpenConversation(pair.id); }} className="ml-1 mt-1 text-xs font-semibold text-berry underline underline-offset-4">Open the conversation</button>}
                    </li>
                  );
                })}
              </ul>
            )}
            {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
};
