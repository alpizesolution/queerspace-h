import React, { useEffect, useState } from 'react';
import { CheckCircle2, Flag, HeartHandshake, Phone, Trash2 } from 'lucide-react';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import {
  deleteUnsaid,
  flagUnsaid,
  formatFadesIn,
  isUnsaidAvailable,
  loadMyUnsaidIds,
  needsCrisisSupport,
  postUnsaid,
  reactToUnsaid,
  subscribeToUnsaid,
  UNSAID_MAX_LENGTH,
  UNSAID_KINDS,
  UnsaidKind,
  UnsaidPost,
  UnsaidReaction,
  validateUnsaidText,
} from '../services/unsaidService.ts';
import { fetchIsCommunityAdmin } from '../services/communityService.ts';
import { whileActive } from '../utils/whileActive.ts';

const REACTED_KEY = 'qs_unsaid_reacted';
const REPORT_REASONS = ['Harassment or hate', 'Names or exposes someone', 'Spam or selling', 'Something else'];

const PLACEHOLDERS: Record<UnsaidKind, string> = {
  vent: "What's weighing on you?",
  confession: 'The thing you never said out loud…',
};

const FILTERS: { id: 'all' | UnsaidKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vent', label: 'Vents' },
  { id: 'confession', label: 'Confessions' },
];

/** `img` swaps the emoji for a custom image from public/emoji. */
const REACTIONS: { type: UnsaidReaction; emoji: string; label: string; img?: string }[] = [
  { type: 'hugs', emoji: '🫂', label: 'Sending a hug' },
  { type: 'same', emoji: '🤍', label: 'Same here' },
  { type: 'felt', emoji: '🥺', label: 'Felt this' },
  { type: 'strong', emoji: '💪', label: 'Stay strong' },
  { type: 'proud', emoji: '🌈', label: 'Proud of you' },
  { type: 'cry', emoji: '😭', label: 'Crying with you', img: '/emoji/cry.webp' },
];

function loadReacted(): Record<string, UnsaidReaction> {
  try {
    return JSON.parse(localStorage.getItem(REACTED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveReacted(map: Record<string, UnsaidReaction>) {
  try {
    localStorage.setItem(REACTED_KEY, JSON.stringify(map));
  } catch {
    // Per-device convenience only; the server still allows one reaction per person.
  }
}

const CrisisCard: React.FC = () => (
  <div className="flex gap-3 rounded-2xl border border-berry/40 bg-plum/20 p-4 anim-fade" role="note">
    <HeartHandshake className="w-5 h-5 text-berry shrink-0 mt-0.5" />
    <div className="text-[length:calc(13px_*_var(--fs,1))] leading-relaxed">
      <p className="font-semibold text-fg">You're not alone, and you matter.</p>
      <p className="text-muted mt-0.5">
        Talk to someone right now, free and 24/7: NCMH Crisis Hotline{' '}
        <a href="tel:1553" className="text-berry font-semibold">1553</a> or{' '}
        <a href="tel:09178998727" className="text-berry font-semibold">0917 899 8727</a>.
      </p>
    </div>
  </div>
);

export const UnsaidView: React.FC = () => {
  const [posts, setPosts] = useState<UnsaidPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [reacted, setReacted] = useState<Record<string, UnsaidReaction>>(loadReacted);
  const [kind, setKind] = useState<UnsaidKind>('vent');
  const [filter, setFilter] = useState<'all' | UnsaidKind>('all');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Moderator controls: shown only when admins/{uid} exists for this session; firestore.rules re-check every delete.
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const available = isUnsaidAvailable();

  useEffect(() => {
    if (!available) return;
    const unsubscribe = whileActive(() =>
      subscribeToUnsaid(
        (next) => {
          setPosts(next);
          setLoading(false);
          setFeedError(false);
        },
        () => {
          setLoading(false);
          setFeedError(true);
        }
      )
    );
    loadMyUnsaidIds().then((ids) => setMyIds(new Set(ids)));
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubscribe();
      clearInterval(tick);
    };
  }, [available]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    fetchIsCommunityAdmin().then((ok) => {
      if (!cancelled) setIsAdmin(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const showCrisis = needsCrisisSupport(draft);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = validateUnsaidText(draft);
    if (!checked.ok) {
      setComposeError(checked.error);
      return;
    }
    setPosting(true);
    const result = await postUnsaid(kind, checked.text);
    setPosting(false);
    if (result === 'posted') {
      setDraft('');
      setComposeError(null);
      loadMyUnsaidIds().then((ids) => setMyIds(new Set(ids)));
    } else if (result === 'too-fast') {
      setComposeError('You can post once a minute. Take a breath and try again soon.');
    } else {
      setComposeError("Couldn't post. Check your connection and try again.");
    }
  };

  const handleReact = async (postId: string, type: UnsaidReaction) => {
    if (reacted[postId]) return;
    const next = { ...reacted, [postId]: type };
    setReacted(next);
    saveReacted(next);
    await reactToUnsaid(postId, type);
  };

  const handleReport = async (reason: string) => {
    if (!reportingId) return;
    const id = reportingId;
    setReportingId(null);
    setReportedIds((prev) => new Set(prev).add(id));
    await flagUnsaid(id, reason);
  };

  const handleDelete = async () => {
    if (!deletingId || deleting) return;
    const id = deletingId;
    setDeleting(true);
    const ok = await deleteUnsaid(id);
    setDeleting(false);
    setDeletingId(null);
    // Quiet for members deleting their own post; moderators get an explicit result.
    if (isAdmin) {
      setToast(
        ok
          ? { text: 'Post deleted.', ok: true }
          : { text: "Couldn't delete that. Nothing was removed, please try again.", ok: false }
      );
    }
  };

  const visible = posts.filter((p) => !reportedIds.has(p.id) && (filter === 'all' || p.kind === filter));

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 sm:pt-10 pb-10 md:pb-16">
      <h1 className="text-2xl sm:text-[length:calc(28px_*_var(--fs,1))] font-semibold tracking-tight text-fg">Echoes</h1>
      <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1 mb-5">Vent or confess anonymously. Gone in 48 hours.</p>

      {!available ? (
        <p className="card p-5 text-sm text-muted">Echoes isn't available right now. Please try again later.</p>
      ) : (
        <>
          <form onSubmit={handlePost} className="card p-3 sm:p-4 flex flex-col gap-3 mb-5">
            <div className="flex gap-2" role="group" aria-label="Post type">
              {UNSAID_KINDS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={kind === id}
                  onClick={() => setKind(id)}
                  className="chip"
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              maxLength={UNSAID_MAX_LENGTH}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setComposeError(null);
              }}
              placeholder={PLACEHOLDERS[kind]}
              aria-label="Write something unsaid"
              className="input text-base sm:text-[length:calc(15px_*_var(--fs,1))]"
            />
            {showCrisis && <CrisisCard />}
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[length:calc(12px_*_var(--fs,1))] ${composeError ? 'text-danger' : 'text-subtle'}`} aria-live="polite">
                {composeError ?? 'No names, no replies.'}
              </p>
              <button type="submit" disabled={!draft.trim() || posting} className="btn btn-primary btn-sm shrink-0">
                {posting ? 'Posting…' : 'Let it out'}
              </button>
            </div>
          </form>

          <div role="tablist" aria-label="Filter posts" className="flex gap-2 mb-4">
            {FILTERS.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
                className={`chip shrink-0 ${filter === id ? '!bg-fg !text-ink !border-fg' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-28 animate-pulse" />
              ))}
            </div>
          ) : feedError ? (
            <p className="text-center text-sm text-muted py-12">Couldn't load the wall. Please try again soon.</p>
          ) : visible.length === 0 ? (
            <div className="text-center py-14 px-6">
              <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">
                {filter === 'confession' ? 'No confessions yet' : filter === 'vent' ? 'No vents yet' : "It's quiet here"}
              </p>
              <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1">Be the first to let something out.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((post) => {
                const mine = myIds.has(post.id);
                const myReaction = reacted[post.id];
                return (
                  <li
                    key={post.id}
                    className={`relative overflow-hidden rounded-3xl border p-4 sm:p-5 anim-fade ${
                      post.kind === 'confession'
                        ? 'border-lavender/20 bg-gradient-to-br from-lavender/[0.09] via-surface to-surface'
                        : 'border-berry/20 bg-gradient-to-br from-berry/[0.09] via-surface to-surface'
                    }`}
                  >
                    <span aria-hidden="true" className="absolute -top-1 right-3 text-[length:calc(40px_*_var(--fs,1))] opacity-[0.08] select-none">
                      {post.kind === 'confession' ? '🌙' : '☁️'}
                    </span>
                    <span className={`tag mb-2 ${post.kind === 'confession' ? '!text-lavender' : '!text-berry'}`}>
                      {post.kind === 'confession' ? '🌙 Confession' : '☁️ Vent'}
                    </span>
                    <p className="text-[length:calc(14.5px_*_var(--fs,1))] sm:text-[length:calc(16px_*_var(--fs,1))] text-fg/90 leading-relaxed whitespace-pre-wrap break-words">
                      {post.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-y-1 mt-3 -ml-2 text-[length:calc(13px_*_var(--fs,1))] text-muted">
                      <div className="flex flex-wrap items-center gap-0.5">
                        {REACTIONS.map(({ type, emoji, label, img }) => {
                          const active = myReaction === type;
                          return (
                            <button
                              key={type}
                              onClick={() => handleReact(post.id, type)}
                              disabled={Boolean(myReaction) && !active}
                              aria-pressed={active}
                              aria-label={`${label}, ${post[type]}`}
                              title={label}
                              className={`inline-flex items-center gap-1 h-9 min-w-9 justify-center px-2 rounded-full transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 ${
                                active ? 'bg-plum/40 text-fg' : 'hover:bg-raised hover:text-fg'
                              }`}
                            >
                              {img ? (
                                <img src={img} alt="" aria-hidden="true" width={20} height={20} className="w-5 h-5" />
                              ) : (
                                <span aria-hidden="true" className="text-[length:calc(17px_*_var(--fs,1))] leading-none">{emoji}</span>
                              )}
                              {post[type] > 0 && <span className="text-subtle">{post[type]}</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="ml-auto flex items-center">
                        <span className="text-[length:calc(12px_*_var(--fs,1))] text-subtle whitespace-nowrap">
                          {formatFadesIn(post.expiresAt, now)}
                        </span>
                        {mine || isAdmin ? (
                          <button
                            onClick={() => setDeletingId(post.id)}
                            className="icon-btn w-9 h-9"
                            aria-label={mine ? 'Delete your post' : 'Delete post (moderator)'}
                            title={mine ? 'Delete your post' : 'Delete post (moderator)'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => setReportingId(post.id)} className="icon-btn w-9 h-9" aria-label="Report post">
                            <Flag className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-8 flex items-center justify-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle text-center">
            <Phone className="w-3.5 h-3.5 shrink-0" />
            Need to talk now? NCMH Crisis Hotline{' '}
            <a href="tel:1553" className="text-berry font-medium">1553</a>
          </p>
        </>
      )}

      {reportingId && (
        <Sheet title="Report this post" onClose={() => setReportingId(null)} size="sm">
          <p className="mb-3">It's hidden for you right away. Posts with several reports are hidden for everyone.</p>
          <div className="flex flex-col gap-2">
            {REPORT_REASONS.map((reason) => (
              <button key={reason} onClick={() => handleReport(reason)} className="btn btn-secondary justify-start">
                {reason}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {deletingId && (
        <ConfirmDialog
          title={myIds.has(deletingId) ? 'Delete your post?' : 'Delete this post?'}
          message={
            myIds.has(deletingId)
              ? 'It disappears for everyone right away.'
              : 'This post will be removed for everyone, for breaking the guidelines. This action cannot be undone.'
          }
          confirmLabel={deleting ? 'Deleting…' : myIds.has(deletingId) ? 'Delete' : 'Delete permanently'}
          tone="danger"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!deleting) setDeletingId(null);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-start gap-2.5 bg-raised/95 backdrop-blur-xl text-fg px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 border border-line text-sm anim-pop"
        >
          <CheckCircle2 className={`w-[18px] h-[18px] shrink-0 mt-px ${toast.ok ? 'text-berry' : 'text-danger'}`} />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};
