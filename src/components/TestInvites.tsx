import React, { useRef, useState } from 'react';
import { Check, ClipboardCheck, ExternalLink, LoaderCircle } from 'lucide-react';
import { Sheet } from './Sheet.tsx';
import { TEST_CATALOG, TEST_PRIVACY_NOTE, testById, type CatalogTest } from '../utils/testCatalog.ts';

/**
 * Tests: invite the other member of a conversation to an outside online test, from the composer. QUEERSPACE only sends the invitation. The test
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

// ------------------------------------------------------------------------------------------------ the composer picker

/** The composer button's icon: a clipboard with a check, for tests and quizzes. */
export const TestsIcon: React.FC<{ className?: string }> = ({ className }) => <ClipboardCheck className={className} aria-hidden="true" />;

interface PickerProps {
  /** The other member of this conversation, for the wording. */
  partnerName: string;
  /** Sends one invitation into THIS conversation. `messageId` is stable per test, so a repeated click can never make a second one. Resolves to null on success, or words for the member. */
  onInvite: (testId: string, messageId: string) => Promise<string | null>;
  onClose: () => void;
}

/**
 * A compact picker opened from the composer: the three tests, tap one to invite the other person here. The invitation arrives as a
 * card in this same conversation. Nothing opens or loads from here; the outside site opens only when the invited person taps Take Test.
 */
export const TestPicker: React.FC<PickerProps> = ({ partnerName, onInvite, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  /** One message id per test for the life of the picker: repeating a click repeats the same send, never makes a new one. */
  const ids = useRef(new Map<string, string>());
  const busyNow = useRef(false);

  const invite = async (test: CatalogTest) => {
    if (busyNow.current || sent.has(test.id)) return;
    busyNow.current = true;
    setBusy(test.id);
    setProblem(null);
    if (!ids.current.has(test.id)) ids.current.set(test.id, crypto.randomUUID());
    const failure = await onInvite(test.id, ids.current.get(test.id)!);
    busyNow.current = false;
    setBusy(null);
    if (failure) setProblem(failure);
    else setSent((current) => new Set(current).add(test.id));
  };

  return (
    <Sheet title="Invite to a test" onClose={onClose} size="sm" icon={<TestsIcon className="h-4 w-4 text-lavender" />}>
      <div data-testid="test-picker" className="space-y-2 text-fg">
        <p className="text-[length:calc(13px_*_var(--fs,1))] leading-snug text-muted">Pick a test to invite {partnerName}. They get a card here and choose whether to open it.</p>
        <ul className="space-y-1.5">
          {TEST_CATALOG.map((test) => {
            const done = sent.has(test.id);
            return (
              <li key={test.id}>
                <button
                  type="button"
                  disabled={busy !== null || done}
                  onClick={() => void invite(test)}
                  aria-label={`${done ? 'Invited to' : 'Invite to'} ${test.name}`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:brightness-110 disabled:cursor-default disabled:opacity-80 focus-visible:outline-none focus-visible:ring-2"
                  style={{ backgroundImage: `linear-gradient(135deg, ${TEST_LOOK.bg}, ${TEST_LOOK.bg2})`, borderColor: TEST_LOOK.border, color: TEST_LOOK.text }}
                >
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ backgroundColor: 'rgba(243,201,105,0.14)' }}>{test.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[length:calc(14.5px_*_var(--fs,1))] font-semibold leading-snug">{test.name}</span>
                    <span className="block truncate text-[length:calc(12.5px_*_var(--fs,1))]" style={{ color: TEST_LOOK.meta }}>{test.description}</span>
                  </span>
                  {busy === test.id ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : done ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold" style={{ color: TEST_LOOK.accent }}><Check className="h-3.5 w-3.5" aria-hidden="true" /> Invited</span> : <span className="shrink-0 text-xs font-semibold" style={{ color: TEST_LOOK.accent }}>Invite</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
        <p className="text-[length:calc(11.5px_*_var(--fs,1))] leading-snug text-subtle">{TEST_PRIVACY_NOTE}</p>
      </div>
    </Sheet>
  );
};
