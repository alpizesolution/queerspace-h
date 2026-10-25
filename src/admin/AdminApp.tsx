import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { ArrowLeft, Check, Copy, LogOut, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/Sheet.tsx';
import { isFirebaseConfigured, subscribeAuthState } from '../lib/firebase.ts';
import {
  AdminReport,
  AdminRoomMessage,
  AdminStats,
  AdminSuggestion,
  AdminUnsaidPost,
  AdminCheck,
  checkAdmin,
  deleteInboxItem,
  deleteRoomMessage,
  InboxStatus,
  isGoogleUser,
  loadDisplayName,
  loadFlaggedUnsaid,
  loadReports,
  loadRoomMessages,
  loadStats,
  loadSuggestions,
  postTeamRoomMessage,
  removeUnsaid,
  restoreUnsaid,
  setInboxStatus,
  signInAdmin,
  signOutAdmin,
} from '../services/adminService.ts';
import { BarChart } from './BarChart.tsx';
import { SupportTab } from './SupportTab.tsx';
import { countUnreadSupport, TEAM_NAME } from '../services/supportService.ts';
import { deleteCommunityPost, subscribeToCommunity } from '../services/communityService.ts';
import type { CommunityPost } from '../types.ts';

type Tab = 'overview' | 'support' | 'suggestions' | 'reports' | 'moderation';

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

const Shell: React.FC<{ children: React.ReactNode; user?: User | null }> = ({ children, user }) => (
  <div className="min-h-dvh bg-ink text-fg">
    <header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-xl border-b border-line pt-safe">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-[var(--header-h)] flex items-center gap-3">
        <a href="/" className="icon-btn -ml-2" aria-label="Back to the site">
          <ArrowLeft className="w-[18px] h-[18px]" />
        </a>
        <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-[9px] border border-line" />
        <p className="font-serif font-semibold text-[17px] tracking-tight">
          Admin
        </p>
        {user && isGoogleUser(user) && (
          <div className="ml-auto flex items-center gap-1 min-w-0">
            <span className="text-[12px] text-subtle truncate hidden sm:block">{user.email}</span>
            <button onClick={() => signOutAdmin()} className="icon-btn" aria-label="Sign out" title="Sign out">
              <LogOut className="w-[18px] h-[18px]" />
            </button>
          </div>
        )}
      </div>
    </header>
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">{children}</main>
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
        checkAdmin(next).then(setAdminCheck);
      }),
    []
  );

  const handleSignIn = async () => {
    setSignInError(null);
    try {
      await signInAdmin();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setSignInError(
        code === 'auth/operation-not-allowed'
          ? 'Google sign-in is turned off. Enable it in Firebase → Authentication → Sign-in method.'
          : code === 'auth/unauthorized-domain'
            ? 'This domain isn’t allowed yet. Add it in Firebase → Authentication → Settings → Authorized domains.'
            : 'Couldn’t sign in. Please try again.'
      );
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
          <p className="text-[13px] text-muted mt-1.5 mb-6">For the QUEERSPACE PH team only.</p>
          <button onClick={handleSignIn} className="btn btn-primary w-full">
            Sign in with Google
          </button>
          {signInError && (
            <p className="text-[13px] text-danger mt-3" role="alert">
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
          <p className="text-[13px] text-muted mt-1.5">
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
            className="mt-4 w-full flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-left font-mono text-[12px] text-fg cursor-pointer"
          >
            <span className="truncate">{uid}</span>
            {copied ? <Check className="w-4 h-4 text-berry shrink-0" /> : <Copy className="w-4 h-4 text-muted shrink-0" />}
          </button>
          <p className="text-[12px] text-subtle mt-3">Give it any field, for example role: owner.</p>
          <p className="text-[12px] mt-3 text-danger" role="status">
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
  const [suggestions, setSuggestions] = useState<AdminSuggestion[] | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const refreshInbox = useCallback(() => {
    loadSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
    loadReports().then(setReports).catch(() => setReports([]));
  }, []);

  useEffect(refreshInbox, [refreshInbox]);

  const [unreadSupport, setUnreadSupport] = useState(0);
  useEffect(() => {
    countUnreadSupport().then(setUnreadSupport);
  }, []);

  const openSuggestions = suggestions?.filter((s) => s.status === 'open').length ?? 0;
  const openReports = reports?.filter((r) => r.status === 'open').length ?? 0;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'support', label: 'Support', badge: unreadSupport },
    { id: 'suggestions', label: 'Suggestions', badge: openSuggestions },
    { id: 'reports', label: 'Reports', badge: openReports },
    { id: 'moderation', label: 'Moderation' },
  ];

  return (
    <>
      <div role="tablist" aria-label="Admin sections" className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(({ id, label, badge }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`chip shrink-0 ${tab === id ? '!bg-fg !text-ink !border-fg' : ''}`}
          >
            {label}
            {badge ? (
              <span className={`ml-1.5 text-[11px] font-semibold ${tab === id ? 'text-plum' : 'text-berry'}`}>{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview openSuggestions={openSuggestions} openReports={openReports} />}
      {tab === 'support' && <SupportTab formatAgo={(ms) => formatAgo(ms)} onUnreadChange={setUnreadSupport} />}
      {tab === 'suggestions' && (
        <SuggestionsTab items={suggestions} setItems={setSuggestions} onConfirm={setConfirm} />
      )}
      {tab === 'reports' && <ReportsTab items={reports} setItems={setReports} onConfirm={setConfirm} />}
      {tab === 'moderation' && <ModerationTab onConfirm={setConfirm} />}

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

const Stat: React.FC<{ label: string; value: number | string; note?: string }> = ({ label, value, note }) => (
  <div className="card p-4">
    <p className="text-[12px] text-muted">{label}</p>
    <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">{value}</p>
    {note && <p className="text-[12px] text-subtle mt-0.5">{note}</p>}
  </div>
);

const Overview: React.FC<{ openSuggestions: number; openReports: number }> = ({ openSuggestions, openReports }) => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(false);
    loadStats()
      .then(setStats)
      .catch((err) => {
        console.warn('[Admin] Stats failed:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <button onClick={refresh} className="icon-btn" aria-label="Refresh" disabled={loading}>
          <RefreshCw className={`w-[18px] h-[18px] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="card p-4 text-sm text-danger">Couldn’t load stats. Try refreshing.</p>}

      {stats?.indexLink && (
        <div className="card p-4 text-[13px] text-muted">
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

      {!stats && loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="card h-[92px] animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Members" value={stats.members} note={`+${stats.membersWeek} this week`} />
            <Stat label="New today" value={stats.membersToday} />
            <Stat label="Chats started" value={stats.chatsTotal} note={`+${stats.chatsWeek} this week`} />
            <Stat label="Chats today" value={stats.chatsToday} />
            <Stat label="Searching now" value={stats.searchingNow} />
            <Stat label="Public Room today" value={stats.roomToday} note="messages" />
            <Stat label="Unsaid live" value={stats.unsaidLive} note="posts" />
            <Stat label="To review" value={openSuggestions + openReports} note={`${openSuggestions} ${openSuggestions === 1 ? 'idea' : 'ideas'} · ${openReports} ${openReports === 1 ? 'report' : 'reports'}`} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <BarChart title="New members" data={stats.memberDays} />
            <BarChart title="Chats started" data={stats.chatDays} />
          </div>
          <p className="text-[12px] text-subtle">
            Members are people who finished setting up a profile. Join dates are tracked from this update on, so older
            members show up in the total but not in the daily chart.
          </p>
        </>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------- Inbox tabs

function useStatusFilter() {
  const [filter, setFilter] = useState<InboxStatus>('open');
  const chips = (
    <div className="flex gap-2 mb-4" role="group" aria-label="Filter">
      {(['open', 'done'] as const).map((s) => (
        <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)} className="chip">
          {s === 'open' ? 'Open' : 'Done'}
        </button>
      ))}
    </div>
  );
  return { filter, chips };
}

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

interface InboxProps<T> {
  items: T[] | null;
  setItems: React.Dispatch<React.SetStateAction<T[] | null>>;
  onConfirm: (c: PendingConfirm) => void;
}

function StatusButton({ status, onToggle }: { status: InboxStatus; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="btn btn-secondary btn-sm">
      {status === 'open' ? (
        <>
          <Check className="w-4 h-4" /> Done
        </>
      ) : (
        <>
          <RotateCcw className="w-4 h-4" /> Reopen
        </>
      )}
    </button>
  );
}

const SuggestionsTab: React.FC<InboxProps<AdminSuggestion>> = ({ items, setItems, onConfirm }) => {
  const { filter, chips } = useStatusFilter();
  const visible = items?.filter((s) => s.status === filter) ?? [];

  const toggle = async (s: AdminSuggestion) => {
    const next: InboxStatus = s.status === 'open' ? 'done' : 'open';
    setItems((prev) => prev?.map((x) => (x.id === s.id ? { ...x, status: next } : x)) ?? prev);
    await setInboxStatus('suggestions', s.id, next).catch(() =>
      setItems((prev) => prev?.map((x) => (x.id === s.id ? { ...x, status: s.status } : x)) ?? prev)
    );
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Suggestions</h1>
      {chips}
      {!items ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        <Empty text={filter === 'open' ? 'Inbox zero. Nothing new.' : 'Nothing marked done yet.'} />
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => (
            <li key={s.id} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="tag capitalize">{s.category}</span>
                <span className="text-[12px] text-subtle">{formatAgo(s.createdAt)}</span>
              </div>
              <p className="text-[15px] text-fg leading-relaxed whitespace-pre-wrap break-words">{s.text}</p>
              <div className="flex gap-2 mt-3">
                <StatusButton status={s.status} onToggle={() => toggle(s)} />
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this suggestion?',
                      message: 'It’s removed for good.',
                      confirmLabel: 'Delete',
                      run: async () => {
                        await deleteInboxItem('suggestions', s.id);
                        setItems((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
                      },
                    })
                  }
                  className="icon-btn w-9 h-9 ml-auto"
                  aria-label="Delete suggestion"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function describeTarget(r: AdminReport, names: Record<string, string | null>): string {
  if (r.reason.startsWith('Unsaid:')) return 'Unsaid post';
  if (r.targetType === 'user') return names[r.targetId] ? `User “${names[r.targetId]}”` : 'User';
  if (r.targetType === 'message') return 'Message';
  return 'Post';
}

const ReportsTab: React.FC<InboxProps<AdminReport>> = ({ items, setItems, onConfirm }) => {
  const { filter, chips } = useStatusFilter();
  const [names, setNames] = useState<Record<string, string | null>>({});
  const visible = items?.filter((r) => r.status === filter) ?? [];

  useEffect(() => {
    const missing = [...new Set(visible.filter((r) => r.targetType === 'user').map((r) => r.targetId))].filter(
      (id) => !(id in names)
    );
    missing.forEach((id) => loadDisplayName(id).then((name) => setNames((prev) => ({ ...prev, [id]: name }))));
  }, [visible.map((r) => r.id).join()]);

  const toggle = async (r: AdminReport) => {
    const next: InboxStatus = r.status === 'open' ? 'done' : 'open';
    setItems((prev) => prev?.map((x) => (x.id === r.id ? { ...x, status: next } : x)) ?? prev);
    await setInboxStatus('reports', r.id, next).catch(() =>
      setItems((prev) => prev?.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)) ?? prev)
    );
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Reports</h1>
      <p className="text-[13px] text-muted mb-4">Flagged Unsaid posts can be restored or removed under Moderation.</p>
      {chips}
      {!items ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        <Empty text={filter === 'open' ? 'No open reports. All calm.' : 'Nothing marked done yet.'} />
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="tag !text-danger">{describeTarget(r, names)}</span>
                <span className="text-[12px] text-subtle">{formatAgo(r.createdAt)}</span>
              </div>
              <p className="text-[15px] text-fg">{r.reason.replace(/^Unsaid:\s*/, '')}</p>
              <p className="text-[12px] text-subtle mt-1 font-mono break-all">
                {r.targetType === 'user' ? 'user' : 'id'}: {r.targetId}
              </p>
              <div className="flex gap-2 mt-3">
                <StatusButton status={r.status} onToggle={() => toggle(r)} />
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this report?',
                      message: 'It’s removed for good.',
                      confirmLabel: 'Delete',
                      run: async () => {
                        await deleteInboxItem('reports', r.id);
                        setItems((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
                      },
                    })
                  }
                  className="icon-btn w-9 h-9 ml-auto"
                  aria-label="Delete report"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Moderation

const ModerationTab: React.FC<{ onConfirm: (c: PendingConfirm) => void }> = ({ onConfirm }) => {
  const [unsaid, setUnsaid] = useState<AdminUnsaidPost[] | null>(null);
  const [room, setRoom] = useState<AdminRoomMessage[] | null>(null);
  const [community, setCommunity] = useState<CommunityPost[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(
    () =>
      subscribeToCommunity(setCommunity, () => {
        setCommunity([]);
        setError(true);
      }),
    []
  );

  useEffect(() => {
    loadFlaggedUnsaid()
      .then(setUnsaid)
      .catch(() => {
        setUnsaid([]);
        setError(true);
      });
    loadRoomMessages()
      .then(setRoom)
      .catch(() => {
        setRoom([]);
        setError(true);
      });
  }, []);

  const now = useMemo(() => Date.now(), [unsaid, room]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
      {error && <p className="card p-4 text-sm text-danger">Some items couldn’t load. Try again.</p>}

      <section>
        <h2 className="text-[15px] font-semibold mb-1">Flagged on Unsaid</h2>
        <p className="text-[13px] text-muted mb-3">Posts with 3 or more flags are hidden from everyone.</p>
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
                  <span className={`text-[12px] ${p.flags >= 3 ? 'text-danger' : 'text-subtle'}`}>
                    {p.flags} {p.flags === 1 ? 'flag' : 'flags'}
                    {p.flags >= 3 ? ' · hidden' : ''}
                  </span>
                </div>
                <p className="font-serif text-[17px] text-fg leading-relaxed whitespace-pre-wrap break-words">{p.text}</p>
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
        <h2 className="text-[15px] font-semibold mb-1">Community</h2>
        <p className="text-[13px] text-muted mb-3">Latest posts. Deleting one removes it for everyone.</p>
        {!community ? (
          <Skeleton />
        ) : community.length === 0 ? (
          <Empty text="No posts yet." />
        ) : (
          <ul className="card divide-y divide-line">
            {community.map((p) => (
              <li key={p.id} className="flex items-start gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-subtle">
                    <span className="text-muted font-medium">{p.author}</span> · {formatAgo(p.timestamp, now)}
                  </p>
                  <p className="text-[14px] text-fg font-medium break-words">{p.title}</p>
                  <p className="text-[13px] text-muted break-words line-clamp-2">{p.content}</p>
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

      <section>
        <h2 className="text-[15px] font-semibold mb-1">Public Room</h2>
        <p className="text-[13px] text-muted mb-3">Latest messages. Deleting one removes it for everyone.</p>
        <TeamPostForm onPosted={(m) => setRoom((prev) => [m, ...(prev ?? [])])} />
        {!room ? (
          <Skeleton />
        ) : room.length === 0 ? (
          <Empty text="No messages yet." />
        ) : (
          <ul className="card divide-y divide-line">
            {room.map((m) => (
              <li key={m.id} className="flex items-start gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-subtle">
                    <span className={`font-medium ${m.authorName === TEAM_NAME ? 'text-berry' : 'text-muted'}`}>{m.authorName}</span> ·{' '}
                    {formatAgo(m.createdAt, now)}
                  </p>
                  <p className="text-[14px] text-fg break-words">{m.text}</p>
                </div>
                <button
                  onClick={() =>
                    onConfirm({
                      title: 'Delete this message?',
                      message: `“${m.text.slice(0, 80)}${m.text.length > 80 ? '…' : ''}” will be removed for everyone.`,
                      confirmLabel: 'Delete',
                      run: async () => {
                        await deleteRoomMessage(m.id);
                        setRoom((prev) => prev?.filter((x) => x.id !== m.id) ?? prev);
                      },
                    })
                  }
                  className="icon-btn w-9 h-9 shrink-0"
                  aria-label={`Delete message from ${m.authorName}`}
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

/** Post to the Public Room as the team, with the verified badge members see. */
const TeamPostForm: React.FC<{ onPosted: (m: AdminRoomMessage) => void }> = ({ onPosted }) => {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || state === 'sending') return;
    setState('sending');
    try {
      const posted = await postTeamRoomMessage(text);
      if (!posted) throw new Error('not posted');
      onPosted(posted);
      setText('');
      setState('idle');
    } catch (err) {
      console.warn('[Admin] Team post failed:', err);
      setState('failed');
    }
  };

  return (
    <form onSubmit={submit} className="card p-3 mb-3">
      <label htmlFor="team-post" className="block text-[12px] text-muted mb-2">
        Post as <span className="text-berry font-medium">{TEAM_NAME}</span> (shows a Team badge)
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="team-post"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Announcements, welcomes, reminders…"
          className="flex-1 min-w-0 resize-none px-3.5 py-2.5 rounded-2xl bg-ink border border-line text-[14px] text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button type="submit" disabled={!text.trim() || state === 'sending'} className="btn btn-primary btn-sm">
          {state === 'sending' ? 'Posting…' : 'Post'}
        </button>
      </div>
      {state === 'failed' && <p className="mt-2 text-[12px] text-danger">Couldn’t post. Try again.</p>}
    </form>
  );
};
