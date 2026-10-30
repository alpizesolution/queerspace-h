import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  Check,
  Copy,
  Flag,
  LayoutDashboard,
  Lightbulb,
  LifeBuoy,
  LogOut,
  Megaphone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { ConfirmDialog } from '../components/Sheet.tsx';
import { isFirebaseConfigured, subscribeAuthState } from '../lib/firebase.ts';
import {
  AdminStats,
  AdminUnsaidPost,
  AdminCheck,
  checkAdmin,
  finishRedirectSignIn,
  isGoogleUser,
  loadDisplayName,
  loadFlaggedUnsaid,
  loadStats,
  statsFetchedAt,
  STATS_RANGES,
  DEFAULT_STATS_RANGE,
  type StatsRange,
  removeUnsaid,
  restoreUnsaid,
  signInAdmin,
  signOutAdmin,
} from '../services/adminService.ts';
import { BarChart } from './BarChart.tsx';
import { Delta, SectionHeading, Stat } from './Kpi.tsx';
import { GrowthView, RetentionView } from './GrowthPanel.tsx';
import { rememberAdminDevice } from '../utils/adminDevice.ts';
import { SupportTab } from './SupportTab.tsx';
import { BirthdayCorrectionsTab } from './BirthdayCorrectionsTab.tsx';
import { RoomTab } from './RoomTab.tsx';
import { SuggestionsPage, ReportsPage } from './InboxPages.tsx';
import { AdminToasts, SoundToggle, type AdminToast, MAX_TOASTS } from './AdminToasts.tsx';
import { useAdminInbox } from './useAdminInbox.ts';
import { adminSoundEnabled, playAdminChime, setAdminSoundEnabled } from '../utils/adminNotify.ts';
import { AppUpdatesTab } from './AppUpdatesTab.tsx';
import { countUnreadSupport } from '../services/supportService.ts';
import { deleteCommunityPost, subscribeToCommunity } from '../services/communityService.ts';
import type { CommunityPost } from '../types.ts';
import { whileActive } from '../utils/whileActive.ts';

type Tab = 'overview' | 'support' | 'room' | 'suggestions' | 'reports' | 'moderation' | 'updates';

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

export function formatAgo(ms: number, now: number = Date.now()): string {
  if (!ms) return '';
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Turns the new-submission chime on or off for this device (off by default). */
const HeaderSound: React.FC = () => {
  const [on, setOn] = useState(adminSoundEnabled());
  return (
    <SoundToggle
      on={on}
      onToggle={() => {
        const next = !on;
        setAdminSoundEnabled(next);
        setOn(next);
        // Turning it on is a tap, so the browser allows this preview chime (and later ones).
        if (next) playAdminChime(true);
      }}
    />
  );
};

const Shell: React.FC<{ children: React.ReactNode; user?: User | null }> = ({ children, user }) => (
  <div className="min-h-dvh bg-ink text-fg">
    <header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-xl border-b border-line pt-safe">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-[var(--header-h)] flex items-center gap-3">
        <a href="/" className="icon-btn -ml-2" aria-label="Back to the site">
          <ArrowLeft className="w-[18px] h-[18px]" />
        </a>
        <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-[9px] border border-line" />
        <p className="font-serif font-semibold text-[length:calc(17px_*_var(--fs,1))] tracking-tight">
          Admin
        </p>
        {user && isGoogleUser(user) && (
          <div className="ml-auto flex items-center gap-1 min-w-0">
            <span className="text-[length:calc(12px_*_var(--fs,1))] text-subtle truncate hidden sm:block">{user.email}</span>
            <HeaderSound />
            <button onClick={() => signOutAdmin()} className="icon-btn" aria-label="Sign out" title="Sign out">
              <LogOut className="w-[18px] h-[18px]" />
            </button>
          </div>
        )}
      </div>
    </header>
    <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-[calc(var(--tabbar-h)+1.5rem)] desk:pb-10">
      {children}
    </main>
  </div>
);

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="card p-6 sm:p-8 max-w-md mx-auto mt-6 sm:mt-12 text-center">{children}</div>
);

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [adminCheck, setAdminCheck] = useState<AdminCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'Admin · QUEERSPACE PH';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  useEffect(
    () =>
      subscribeAuthState((next) => {
        setUser(next);
        setAuthReady(true);
        setAdminCheck(null);
        if (!isGoogleUser(next)) rememberAdminDevice(false);
        checkAdmin(next).then((result) => {
          setAdminCheck(result);
          // Shows the Admin shortcut in the main app on this device only.
          if (result === 'admin') rememberAdminDevice(true);
          else if (result === 'missing') rememberAdminDevice(false);
        });
      }),
    []
  );

  const showSignInError = (err: unknown) => {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    console.warn('[Admin] Sign-in failed:', err);
    setSignInError(
      code === 'auth/operation-not-allowed'
        ? 'Google sign-in is turned off. Enable it in Firebase → Authentication → Sign-in method.'
        : code === 'auth/unauthorized-domain'
          ? 'This domain isn’t allowed yet. Add it in Firebase → Authentication → Settings → Authorized domains.'
          : `Couldn’t sign in. Please try again.${code ? ` (${code})` : ''}`
    );
  };

  // Coming back from Google on phones and tablets: surface any error instead of a silent loop.
  useEffect(() => {
    finishRedirectSignIn().catch(showSignInError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignIn = async () => {
    setSignInError(null);
    try {
      await signInAdmin();
    } catch (err) {
      showSignInError(err);
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <Shell>
        <Centered>
          <p className="text-sm text-muted">Firebase isn’t configured for this build.</p>
        </Centered>
      </Shell>
    );
  }

  if (!authReady || (isGoogleUser(user) && adminCheck === null)) {
    return (
      <Shell user={user}>
        <div className="card h-40 max-w-md mx-auto mt-12 animate-pulse" aria-label="Loading" />
      </Shell>
    );
  }

  if (!isGoogleUser(user)) {
    return (
      <Shell user={user}>
        <Centered>
          <h1 className="text-xl font-semibold tracking-tight">Admin sign-in</h1>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1.5 mb-6">For the QUEERSPACE PH team only.</p>
          <button onClick={handleSignIn} className="btn btn-primary w-full">
            Sign in with Google
          </button>
          {signInError && (
            <p className="text-[length:calc(13px_*_var(--fs,1))] text-danger mt-3" role="alert">
              {signInError}
            </p>
          )}
        </Centered>
      </Shell>
    );
  }

  if (adminCheck !== 'admin') {
    const uid = user!.uid;
    return (
      <Shell user={user}>
        <Centered>
          <h1 className="text-xl font-semibold tracking-tight">Not an admin yet</h1>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1.5">
            Signed in as {user!.email}. To give this account access, open Firebase → Firestore Database and add a
            document to a collection named <b className="text-fg">admins</b> with this ID:
          </p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(uid).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="mt-4 w-full flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-left font-mono text-[length:calc(12px_*_var(--fs,1))] text-fg cursor-pointer"
          >
            <span className="truncate">{uid}</span>
            {copied ? <Check className="w-4 h-4 text-berry shrink-0" /> : <Copy className="w-4 h-4 text-muted shrink-0" />}
          </button>
          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle mt-3">Give it any field, for example role: owner.</p>
          <p className="text-[length:calc(12px_*_var(--fs,1))] mt-3 text-danger" role="status">
            {adminCheck === 'blocked'
              ? 'Firestore blocked the check. Publish the latest rules, wait a minute, then check again.'
              : adminCheck === 'error'
                ? 'Couldn’t reach Firestore. Check your connection and try again.'
                : `No document found at admins/${uid} yet.`}
          </p>
          <button
            onClick={async () => {
              setChecking(true);
              setAdminCheck(await checkAdmin(user));
              setChecking(false);
            }}
            disabled={checking}
            className="btn btn-secondary w-full mt-4"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </Centered>
      </Shell>
    );
  }

  return (
    <Shell user={user}>
      <Dashboard />
    </Shell>
  );
}

// ---------------------------------------------------------------------------

const Dashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  // New submissions announce themselves: a toast (never with the submission's text) and, if this admin turned it on, a chime.
  const [toasts, setToasts] = useState<AdminToast[]>([]);
  const [focus, setFocus] = useState<{ tab: 'suggestions' | 'reports'; id: string } | null>(null);
  const handleArrival = useCallback((kind: 'suggestion' | 'report', ids: string[]) => {
    const now = Date.now();
    setToasts((prev) => {
      const known = new Set(prev.map((t) => t.key));
      const fresh = ids.map((id) => ({ key: `${kind}-${id}`, kind, itemId: id, at: now })).filter((t) => !known.has(t.key));
      return [...fresh, ...prev].slice(0, MAX_TOASTS * 2);
    });
    playAdminChime();
  }, []);
  const inbox = useAdminInbox(handleArrival);

  const [unreadSupport, setUnreadSupport] = useState(0);
  useEffect(() => {
    countUnreadSupport().then(setUnreadSupport);
  }, []);

  const openSuggestions = inbox.pendingSuggestions;
  const openReports = inbox.openReports;

  // Birthday corrections sit under Moderation: they are about members, not about content.
  const [moderationView, setModerationView] = useState<'content' | 'birthdays'>('content');

  const tabs: { id: Tab; label: string; short: string; icon: typeof Lightbulb; badge?: number }[] = [
    { id: 'overview', label: 'Overview', short: 'Home', icon: LayoutDashboard },
    { id: 'support', label: 'Support', short: 'Support', icon: LifeBuoy, badge: unreadSupport },
    { id: 'room', label: 'Public Room', short: 'Room', icon: Users },
    { id: 'suggestions', label: 'Suggestions', short: 'Ideas', icon: Lightbulb, badge: openSuggestions },
    { id: 'reports', label: 'Reports', short: 'Reports', icon: Flag, badge: openReports },
    { id: 'moderation', label: 'Moderation', short: 'Moderate', icon: ShieldCheck },
    { id: 'updates', label: 'App Updates', short: 'Updates', icon: Megaphone },
  ];

  // A member whose support chat should open when the Support tab shows (from an age-review report).
  const [supportFocus, setSupportFocus] = useState<string | null>(null);

  const go = (id: Tab) => {
    setSupportFocus(null);
    setTab(id);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <div role="tablist" aria-label="Admin sections" className="hidden desk:flex gap-2 mb-6 flex-wrap">
        {tabs.map(({ id, label, badge }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => go(id)}
            className={`chip shrink-0 ${tab === id ? '!bg-fg !text-ink !border-fg' : ''}`}
          >
            {label}
            {badge ? (
              <span className={`ml-1.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold ${tab === id ? 'text-plum' : 'text-berry'}`}>{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview openSuggestions={openSuggestions} openReports={openReports} />}
      {tab === 'support' && <SupportTab formatAgo={(ms) => formatAgo(ms)} onUnreadChange={setUnreadSupport} focusId={supportFocus} />}
      {tab === 'room' && <RoomTab onConfirm={setConfirm} />}
      {tab === 'suggestions' && (
        <SuggestionsPage
          items={inbox.suggestions}
          liveError={inbox.liveError}
          onRetryLive={inbox.retry}
          onConfirm={setConfirm}
          formatAgo={(ms) => formatAgo(ms)}
          focusId={focus?.tab === 'suggestions' ? focus.id : null}
          onFocusHandled={() => setFocus(null)}
        />
      )}
      {tab === 'reports' && (
        <ReportsPage
          items={inbox.reports}
          liveError={inbox.liveError}
          onRetryLive={inbox.retry}
          onConfirm={setConfirm}
          formatAgo={(ms) => formatAgo(ms)}
          focusId={focus?.tab === 'reports' ? focus.id : null}
          onFocusHandled={() => setFocus(null)}
          onOpenSupport={(uid) => {
            go('support');
            setSupportFocus(uid);
          }}
        />
      )}
      {tab === 'moderation' && (
        <>
          <div className="flex gap-2 mb-5" role="group" aria-label="Moderation">
            {([['content', 'Content'], ['birthdays', 'Birthdays']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setModerationView(id)}
                aria-pressed={moderationView === id}
                className={`chip h-8 px-3 text-[length:calc(13px_*_var(--fs,1))] ${moderationView === id ? '!bg-raised !text-fg !border-line-strong' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          {moderationView === 'birthdays' ? <BirthdayCorrectionsTab /> : <ModerationTab onConfirm={setConfirm} />}
        </>
      )}
      {tab === 'updates' && <AppUpdatesTab onConfirm={setConfirm} />}

      <AdminToasts
        toasts={toasts}
        onDismiss={(key) => setToasts((prev) => prev.filter((t) => t.key !== key))}
        onOpen={(t) => {
          const target = t.kind === 'suggestion' ? 'suggestions' : 'reports';
          setToasts((prev) => prev.filter((x) => x.key !== t.key));
          go(target);
          setFocus({ tab: target, id: t.itemId });
        }}
      />

      <nav
        aria-label="Admin sections"
        className="tabbar desk:hidden fixed bottom-0 inset-x-0 z-40 bg-ink/90 backdrop-blur-xl border-t border-line pb-safe"
      >
        <div className="grid grid-cols-7 h-14 max-w-2xl mx-auto">
          {tabs.map(({ id, short, icon: Icon, badge }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => go(id)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                  active ? 'text-berry' : 'text-subtle hover:text-fg'
                }`}
              >
                <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[length:calc(11px_*_var(--fs,1))] font-medium leading-none">{short}</span>
                {badge ? (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-berry text-ink text-[length:calc(10px_*_var(--fs,1))] font-bold flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          tone="danger"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run().catch((err) => console.warn('[Admin] Action failed:', err));
          }}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------- Overview

const updatedLabel = (at: number | null) =>
  at ? `Updated ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';

const Overview: React.FC<{ openSuggestions: number; openReports: number }> = ({ openSuggestions, openReports }) => {
  const [range, setRange] = useState<StatsRange>(DEFAULT_STATS_RANGE);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [view, setView] = useState<'summary' | 'growth' | 'retention'>('summary');
  // Bumped by Refresh so the growth and retention views fetch fresh numbers too.
  const [reload, setReload] = useState(0);

  const refresh = useCallback((force = false) => {
    setLoading(true);
    setError(false);
    loadStats(range, force)
      .then((next) => {
        setStats(next);
        setUpdatedAt(statsFetchedAt(range));
      })
      .catch((err) => {
        console.warn('[Admin] Stats failed:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [range]);

  // Only the Summary needs these numbers; Growth and Retention load their own, so switching to them costs nothing extra.
  useEffect(() => {
    if (view === 'summary') refresh();
  }, [refresh, view]);

  // While another range loads, the last figures stay up (dimmed) and are labelled with the range they cover.
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Date range">
            {STATS_RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className="chip">
                {r}d
              </button>
            ))}
          </div>
          <span className="hidden sm:inline text-[length:calc(11px_*_var(--fs,1))] text-subtle tabular-nums" aria-live="polite">
            {view !== 'summary' ? '' : loading ? 'Updating…' : updatedLabel(updatedAt)}
          </span>
          <button onClick={() => { setReload((n) => n + 1); if (view === 'summary') refresh(true); }} className="icon-btn" aria-label="Refresh" disabled={view === 'summary' && loading}>
            <RefreshCw className={`w-[18px] h-[18px] ${view === 'summary' && loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Overview section">
        {([['summary', 'Summary'], ['growth', 'Growth'], ['retention', 'Retention']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className="chip">
            {label}
          </button>
        ))}
      </div>

      {error && <p className="card p-4 text-sm text-danger">Couldn’t load stats. Try refreshing.</p>}

      {view === 'growth' && <GrowthView range={range} reload={reload} />}
      {view === 'retention' && <RetentionView range={range} reload={reload} />}

      {stats?.indexLink && (
        <div className="card p-4 text-[length:calc(13px_*_var(--fs,1))] text-muted">
          <p className="text-fg font-medium">One-time setup for member growth</p>
          <p className="mt-1">
            Firestore needs an index to count new members by day.{' '}
            <a href={stats.indexLink} target="_blank" rel="noreferrer" className="text-berry font-medium underline">
              Create it here
            </a>
            , wait a few minutes, then refresh.
          </p>
        </div>
      )}

      {view !== 'summary' ? null : !stats && loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="card h-[92px] animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <section className="space-y-2.5">
            <SectionHeading hint="All time">Totals</SectionHeading>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat hero label="Members" value={stats.members} note={<>+{stats.membersRange} in {stats.range}d · <Delta current={stats.membersRange} previous={stats.membersPrevRange} versus={`prev ${stats.range}d`} /></>} />
              <Stat hero label="Chats started" value={stats.chatsTotal} note={<>+{stats.chatsRange} in {stats.range}d · <Delta current={stats.chatsRange} previous={stats.chatsPrevRange} versus={`prev ${stats.range}d`} /></>} />
              <Stat hero label="Echoes" value={stats.unsaidLive} note="posts on the wall" />
              <Stat hero label="To review" value={openSuggestions + openReports} note={`${openSuggestions} ${openSuggestions === 1 ? 'idea' : 'ideas'} · ${openReports} ${openReports === 1 ? 'report' : 'reports'}`} />
            </div>
          </section>

          <section className="space-y-2.5">
            <SectionHeading hint="Since midnight">Today</SectionHeading>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="New today" value={stats.membersToday} note={<Delta current={stats.membersToday} previous={stats.membersYesterday} versus="yesterday" />} />
              <Stat label="Chats today" value={stats.chatsToday} note={<Delta current={stats.chatsToday} previous={stats.chatsYesterday} versus="yesterday" />} />
              <Stat label="Public Room today" value={stats.roomToday} note={<>messages · <Delta current={stats.roomToday} previous={stats.roomYesterday} versus="yesterday" /></>} />
              <Stat label="Searching now" value={stats.searchingNow} note="live" />
            </div>
          </section>

          <section className="space-y-2.5">
            <SectionHeading hint={`Last ${stats.range} days`}>Trends</SectionHeading>
            <div className="grid sm:grid-cols-2 gap-3">
              <BarChart title="New members" data={stats.memberDays} />
              <BarChart title="Chats started" data={stats.chatDays} />
            </div>
          </section>

          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
            Members are people who finished setting up a profile. Join dates are tracked from a recent update on, so older
            members show up in the total but not in the daily chart or the comparisons.
          </p>
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------- Inbox tabs

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-center text-sm text-muted py-14">{text}</p>
);

const Skeleton: React.FC = () => (
  <div className="space-y-3" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <div key={i} className="card h-24 animate-pulse" />
    ))}
  </div>
);

// ---------------------------------------------------------------- Moderation

const ModerationTab: React.FC<{ onConfirm: (c: PendingConfirm) => void }> = ({ onConfirm }) => {
  const [unsaid, setUnsaid] = useState<AdminUnsaidPost[] | null>(null);
  const [community, setCommunity] = useState<CommunityPost[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(
    () =>
      whileActive(() =>
        subscribeToCommunity(setCommunity, () => {
          setCommunity([]);
          setError(true);
        })
      ),
    []
  );

  useEffect(() => {
    loadFlaggedUnsaid()
      .then(setUnsaid)
      .catch(() => {
        setUnsaid([]);
        setError(true);
      });
  }, []);

  const now = useMemo(() => Date.now(), [unsaid, community]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
      {error && <p className="card p-4 text-sm text-danger">Some items couldn’t load. Try again.</p>}

      <section>
        <h2 className="text-[length:calc(15px_*_var(--fs,1))] font-semibold mb-1">Flagged on Unsaid</h2>
        <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mb-3">Posts with 3 or more flags are hidden from everyone.</p>
        {!unsaid ? (
          <Skeleton />
        ) : unsaid.length === 0 ? (
          <Empty text="No flagged posts." />
        ) : (
          <ul className="space-y-3">
            {unsaid.map((p) => (
              <li key={p.id} className="card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`tag ${p.kind === 'confession' ? '!text-lavender' : '!text-berry'}`}>
                    {p.kind === 'confession' ? 'Confession' : 'Vent'}
                  </span>
                  <span className={`text-[length:calc(12px_*_var(--fs,1))] ${p.flags >= 3 ? 'text-danger' : 'text-subtle'}`}>
                    {p.flags} {p.flags === 1 ? 'flag' : 'flags'}
                    {p.flags >= 3 ? ' · hidden' : ''}
                  </span>
                </div>
                <p className="font-serif text-[length:calc(17px_*_var(--fs,1))] text-fg leading-relaxed whitespace-pre-wrap break-words">{p.text}</p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={async () => {
                      await restoreUnsaid(p.id);
                      setUnsaid((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    <RotateCcw className="w-4 h-4" /> Restore
                  </button>
                  <button
                    onClick={() =>
                      onConfirm({
                        title: 'Remove this post?',
                        message: 'It disappears for everyone right away.',
                        confirmLabel: 'Remove',
                        run: async () => {
                          await removeUnsaid(p.id);
                          setUnsaid((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
                        },
                      })
                    }
                    className="btn btn-danger btn-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[length:calc(15px_*_var(--fs,1))] font-semibold mb-1">Community</h2>
        <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mb-3">Latest posts. Deleting one removes it for everyone.</p>
        {!community ? (
          <Skeleton />
        ) : community.length === 0 ? (
          <Empty text="No posts yet." />
        ) : (
          <ul className="card divide-y divide-line">
            {community.map((p) => (
              <li key={p.id} className="flex items-start gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                    <span className="text-muted font-medium">{p.author}</span> · {formatAgo(p.timestamp, now)}
                  </p>
                  <p className="text-[length:calc(14px_*_var(--fs,1))] text-fg font-medium break-words">{p.title}</p>
                  <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted break-words line-clamp-2">{p.content}</p>
                </div>
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this post?',
                      message: `“${p.title.slice(0, 80)}” will be removed for everyone.`,
                      confirmLabel: 'Delete',
                      run: async () => {
                        await deleteCommunityPost(p.id);
                      },
                    })
                  }
                  className="icon-btn w-9 h-9 shrink-0"
                  aria-label={`Delete post from ${p.author}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
};
