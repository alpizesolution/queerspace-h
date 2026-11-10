import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Flag, Info, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { FloatingAddButton } from './FloatingAddButton.tsx';
import { CrisisSupportCard } from './CrisisSupportCard.tsx';
import { ReactionIcon } from './ReactionIcons.tsx';
import { EchoFilterBar, EchoKindPicker, EchoKindTag, echoCardClass, emptyEchoTitle } from './EchoCategories.tsx';
import { UnsaidReplies } from './UnsaidReplies.tsx';
import {
  deleteUnsaid,
  flagUnsaid,
  formatPostedAgo,
  isUnsaidAvailable,
  loadOlderUnsaid,
  mergeUnsaidPages,
  loadMyUnsaidIds,
  needsCrisisSupport,
  postUnsaid,
  reactToUnsaid,
  subscribeToUnsaid,
  UNSAID_MAX_LENGTH,
  UNSAID_REPORT_REASONS,
  UnsaidKind,
  UnsaidPost,
  UnsaidReaction,
  validateUnsaidText,
} from '../services/unsaidService.ts';
import { fetchIsCommunityAdmin } from '../services/communityService.ts';
import { whileActive } from '../utils/whileActive.ts';
import { dailyEchoPrompt } from '../utils/dailyEchoPrompt.ts';
import { kindAllowsReplies, kindInfo, matchesEchoFilter, type EchoFilter } from '../utils/echoKinds.ts';

const REACTED_KEY = 'qs_unsaid_reacted';

/** What App tells Echoes about replies to the member's own posts (see hooks/useEchoReplyNotices.ts). */
export interface EchoReplyNotices {
  /** Replies the member has not seen yet, per post of theirs. */
  unseenByPost: Record<string, number>;
  /** The member looked at a post's replies. */
  markSeen: (postId: string, replyCount: number) => void;
}

/**
 * The six reactions. `type` (stored) and the order never change. `emoji` is what each one means; it is drawn as line art by
 * ReactionIcon (ReactionIcons.tsx). `img` is Crygago's original artwork in public/emoji, which its line-art is made from.
 */
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

export const UnsaidView: React.FC<{ replyNotices?: EchoReplyNotices }> = ({ replyNotices }) => {
  /** The reaction just chosen ("postId:type"), so only that one plays the small pop. */
  const [popped, setPopped] = useState<string | null>(null);
  const [posts, setPosts] = useState<UnsaidPost[]>([]);
  // Older pages (loaded on request) and where the next one starts. Echoes stay until deleted or removed.
  const [older, setOlder] = useState<UnsaidPost[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const olderLoaded = useRef(false);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [reacted, setReacted] = useState<Record<string, UnsaidReaction>>(loadReacted);
  const [kind, setKind] = useState<UnsaidKind>('vent');
  const [filter, setFilter] = useState<EchoFilter>('all');
  /** Posts whose replies are open. */
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  // The draft lives here, not in the sheet, so dismissing the composer by accident keeps what was typed.
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [anonInfoOpen, setAnonInfoOpen] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Moderator controls: shown only when admins/{uid} exists for this session; firestore.rules re-check every delete.
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Same for every member until midnight in Manila; `now` ticks, so it rolls over without a reload.
  const todaysPrompt = dailyEchoPrompt(now);

  const available = isUnsaidAvailable();

  useEffect(() => {
    if (!available) return;
    const unsubscribe = whileActive(() =>
      subscribeToUnsaid(
        (next, meta) => {
          setPosts(next);
          // The live page only owns the newest Echoes; keep the cursor of whatever older page we already loaded.
          setNextBefore((current) => (olderLoaded.current ? current : meta.nextBefore));
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

  // Today's Echo prompt is optional inspiration. The ordinary buttons always open a blank composer,
  // so a prompt that was inserted earlier and never edited is cleared; anything the member typed is kept.
  const insertedPrompt = useRef<string | null>(null);
  const openBlank = () => {
    if (insertedPrompt.current !== null && draft === insertedPrompt.current) setDraft('');
    insertedPrompt.current = null;
    setComposeOpen(true);
  };
  const openWithPrompt = () => {
    // A draft in progress is never overwritten by the prompt.
    if (!draft.trim()) {
      setDraft(todaysPrompt.text + '\n\n');
      insertedPrompt.current = todaysPrompt.text + '\n\n';
    }
    setComposeError(null);
    setComposeOpen(true);
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (posting) return;
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
      setComposeOpen(false);
      setAnonInfoOpen(false);
      setToast({ text: 'Your echo is out there.', ok: true });
      loadMyUnsaidIds().then((ids) => setMyIds(new Set(ids)));
    } else if (result === 'too-fast') {
      setComposeError('You can post once a minute. Take a breath and try again soon.');
    } else {
      setComposeError("Couldn't post. Check your connection and try again.");
    }
  };

  const handleReact = async (postId: string, type: UnsaidReaction) => {
    if (reacted[postId]) return;
    setPopped(`${postId}:${type}`);
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
    // Gone for good: also drop it from any older page already on screen.
    if (ok) setRemovedIds((prev) => new Set(prev).add(id));
    // Quiet for members deleting their own post; moderators get an explicit result.
    if (isAdmin) {
      setToast(
        ok
          ? { text: 'Post deleted.', ok: true }
          : { text: "Couldn't delete that. Nothing was removed, please try again.", ok: false }
      );
    }
  };

  const showOlder = async () => {
    if (nextBefore === null || loadingOlder) return;
    setLoadingOlder(true);
    const page = await loadOlderUnsaid(nextBefore);
    setLoadingOlder(false);
    if (!page) {
      setToast({ text: "Couldn't load older Echoes. Please try again.", ok: false });
      return;
    }
    olderLoaded.current = true;
    setOlder((current) => mergeUnsaidPages(current, page.posts));
    setNextBefore(page.nextBefore);
  };

  const visible = mergeUnsaidPages(posts, older).filter(
    (p) => !reportedIds.has(p.id) && !removedIds.has(p.id) && matchesEchoFilter(p.kind, filter)
  );

  const toggleThread = (postId: string) =>
    setOpenThreads((current) => {
      const next = new Set(current);
      if (!next.delete(postId)) next.add(postId);
      return next;
    });

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 sm:pt-10 pb-[calc(var(--tabbar-h)+6rem)] desk:pb-16">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[length:calc(28px_*_var(--fs,1))] font-semibold tracking-tight text-fg">Echoes</h1>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-0.5">Release, connect and uplift, anonymously.</p>
        </div>
        {available && (
          <button onClick={openBlank} className="btn btn-primary btn-sm hidden sm:inline-flex shrink-0">
            <Plus className="w-4 h-4" />
            Write an Echo
          </button>
        )}
      </div>

      {!available ? (
        <p className="card p-5 text-sm text-muted">Echoes isn't available right now. Please try again later.</p>
      ) : (
        <>
          <section className="card p-4 mb-3" aria-label="Today's Echo">
            <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-wide text-subtle">Today's Echo</p>
            <p className="mt-1 text-[length:calc(15px_*_var(--fs,1))] leading-snug text-fg" data-testid="daily-echo-prompt">{todaysPrompt.text}</p>
            <button type="button" onClick={openWithPrompt} className="btn btn-secondary btn-sm mt-3">
              Write an Echo
            </button>
          </section>

          <EchoFilterBar filter={filter} onChange={setFilter} />

          {loading ? (
            <div className="space-y-2.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-24 animate-pulse" />
              ))}
            </div>
          ) : feedError ? (
            <p className="text-center text-sm text-muted py-12">Couldn't load the wall. Please try again soon.</p>
          ) : visible.length === 0 ? (
            <div className="text-center py-14 px-6">
              <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">{emptyEchoTitle(filter)}</p>
              <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1 mb-5">Be the first to share something.</p>
              <button onClick={openBlank} className="btn btn-secondary btn-sm">
                Write an Echo
              </button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visible.map((post) => {
                const mine = myIds.has(post.id);
                const myReaction = reacted[post.id];
                return (
                  <li
                    key={post.id}
                    className={`relative overflow-hidden rounded-2xl border px-3.5 py-3 sm:px-4 anim-fade ${echoCardClass(post.kind)}`}
                  >
                    <EchoKindTag kind={post.kind} className="mb-1.5" />
                    <p className="text-[length:calc(15px_*_var(--fs,1))] text-fg/90 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {post.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-y-0.5 mt-2 -ml-2 text-[length:calc(13px_*_var(--fs,1))] text-muted">
                      <div className="flex flex-wrap items-center gap-1 max-[340px]:gap-0">
                        {REACTIONS.map(({ type, label }) => {
                          const active = myReaction === type;
                          return (
                            <button
                              key={type}
                              onClick={() => handleReact(post.id, type)}
                              disabled={Boolean(myReaction) && !active}
                              aria-pressed={active}
                              aria-label={`${label}, ${post[type]}`}
                              title={label}
                              // Monochrome line art on a transparent button: muted lavender-gray at rest, the accent lavender
                              // (with a faint outline) when chosen. Hover and press just scale the drawing a little.
                              className={`group inline-flex items-center gap-1 h-8 min-w-8 justify-center px-1.5 max-[340px]:px-1 rounded-full bg-transparent transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 disabled:cursor-default disabled:opacity-40 ${
                                active ? 'text-lavender ring-1 ring-inset ring-lavender/35' : 'text-[var(--reaction-rest)]'
                              }`}
                            >
                              <span className={`inline-flex items-center justify-center transition-transform duration-150 ease-out group-enabled:group-hover:scale-110 group-enabled:group-active:scale-90 ${popped === `${post.id}:${type}` ? 'reaction-pop' : ''}`}>
                                <ReactionIcon type={type} />
                              </span>
                              {post[type] > 0 && <span className={`text-[length:calc(11px_*_var(--fs,1))] tabular-nums ${active ? 'text-lavender' : 'text-subtle'}`}>{post[type]}</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="ml-auto flex items-center">
                        <span className="text-[length:calc(12px_*_var(--fs,1))] text-subtle whitespace-nowrap">
                          {formatPostedAgo(post.createdAt, now)}
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

                    {/* Replies exist only for Need Advice and the Uplift categories. The other four never show a Reply control
                        (and firestore.rules refuses a reply to them regardless). */}
                    {kindAllowsReplies(post.kind) && (
                      <div className="mt-0.5 -ml-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleThread(post.id)}
                          aria-expanded={openThreads.has(post.id)}
                          aria-label={post.replyCount > 0 ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}. ${openThreads.has(post.id) ? 'Hide' : 'Show'} replies` : 'Reply'}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[length:calc(13px_*_var(--fs,1))] font-medium text-[var(--reaction-rest)] transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 cursor-pointer"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" />
                          <span>{post.replyCount > 0 ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</span>
                        </button>
                        {mine && (replyNotices?.unseenByPost[post.id] ?? 0) > 0 && (
                          <span className="inline-flex h-5 items-center rounded-full bg-berry px-2 text-[length:calc(11px_*_var(--fs,1))] font-bold text-ink" aria-label={`${replyNotices!.unseenByPost[post.id]} new ${replyNotices!.unseenByPost[post.id] === 1 ? 'reply' : 'replies'}`}>
                            {replyNotices!.unseenByPost[post.id]} new
                          </span>
                        )}
                      </div>
                    )}
                    {kindAllowsReplies(post.kind) && openThreads.has(post.id) && (
                      <UnsaidReplies
                        post={post}
                        isAdmin={isAdmin}
                        onViewed={mine ? (count) => replyNotices?.markSeen(post.id, count) : undefined}
                        onToast={setToast}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <CrisisSupportCard className="mt-6" />

          {!loading && !feedError && nextBefore !== null && (
            <div className="mt-4 text-center">
              <button onClick={showOlder} disabled={loadingOlder} className="btn btn-secondary btn-sm">
                {loadingOlder ? 'Loading…' : 'Show older Echoes'}
              </button>
            </div>
          )}

          <FloatingAddButton onClick={openBlank} label="Write an Echo" />
        </>
      )}

      {composeOpen && (
        <Sheet
          title="Write an Echo"
          onClose={() => setComposeOpen(false)}
          footer={
            <button type="submit" form="qs-new-echo" disabled={!draft.trim() || posting} className="btn btn-primary w-full">
              {posting ? 'Posting…' : 'Let it out'}
            </button>
          }
        >
          <form id="qs-new-echo" onSubmit={handlePost} className="flex flex-col gap-3 text-fg">
            <EchoKindPicker value={kind} onChange={setKind} />
            <textarea
              rows={5}
              maxLength={UNSAID_MAX_LENGTH}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setComposeError(null);
              }}
              placeholder={kindInfo(kind).placeholder}
              aria-label="Write something unsaid"
              className="input text-base sm:text-[length:calc(15px_*_var(--fs,1))] resize-none"
            />
            {showCrisis && <CrisisSupportCard message="You're not alone, and you matter." />}
            <div>
              <div className="flex items-center gap-1.5">
                <p className={`text-[length:calc(12px_*_var(--fs,1))] flex-1 ${composeError ? 'text-danger' : 'text-subtle'}`} aria-live="polite">
                  {composeError ?? 'Echoes stay visible until you delete them or they’re removed by moderation.'}
                </p>
                <span className="text-[length:calc(12px_*_var(--fs,1))] tabular-nums text-subtle">{draft.length}/{UNSAID_MAX_LENGTH}</span>
                <button
                  type="button"
                  onClick={() => setAnonInfoOpen((open) => !open)}
                  aria-expanded={anonInfoOpen}
                  aria-label="About anonymity"
                  className="icon-btn w-8 h-8 text-subtle"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
              {anonInfoOpen && (
                <p className="mt-1 text-[length:calc(12px_*_var(--fs,1))] leading-relaxed text-muted">
                  No names. Nobody can see who wrote an echo or a reply; only you can tell which ones are yours, and you can delete them any time. Need Advice, Little Wins, Gratitude and Daydreams take replies; the rest are reactions only.
                </p>
              )}
            </div>
          </form>
        </Sheet>
      )}

      {reportingId && (
        <Sheet title="Report this post" onClose={() => setReportingId(null)} size="sm">
          <p className="mb-3">It's hidden for you right away. Posts with several reports are hidden for everyone.</p>
          <div className="flex flex-col gap-2">
            {UNSAID_REPORT_REASONS.map((reason) => (
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
