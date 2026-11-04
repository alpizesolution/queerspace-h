import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin, MessageCircle } from 'lucide-react';
import { StardustCount } from './StardustButton.tsx';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { ExpandableText } from './ExpandableText.tsx';
import { LookingForBody } from './LookingForBody.tsx';
import { SensitiveCover } from './SensitiveCover.tsx';
import { ConfirmDialog } from './Sheet.tsx';
import type { CommunityPost } from '../types.ts';
import { CATEGORY_EMOJI, CATEGORY_LABELS } from '../utils/communityCategories.ts';
import { INTENTION_LABELS, postPresentation, revealNeedsDialog, type LookingForPost } from '../utils/lookingFor.ts';
import { postsView } from '../utils/profileView.ts';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';
import { formatRelativeTime } from '../utils/relativeTime.ts';
import { fetchMemberCommunityPosts, peekMemberPostsFirstPage } from '../services/profileViewService.ts';
import { PostCardSkeleton } from './Skeleton.tsx';
import { useOpenPost } from './ProfileNav.tsx';
import { isPostId } from '../utils/communityPostLink.ts';

/** Whether a tap landed on something with its own action (a button or link), which keeps it instead of opening the card. */
const isInnerControl = (target: EventTarget): boolean => target instanceof Element && target.closest('button, a, input, textarea, select') !== null;

/** A titled, clearly separated block of the profile page. */
export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-6">
    <h2 className="mb-2.5 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">{title}</h2>
    {children}
  </section>
);

/**
 * A member's public Cosmos Community posts, a few at a time. They come from the same collection and rules as the feed,
 * so nothing private is reachable: a deleted post is simply gone, and every post here was public when it was written.
 * Three different answers: still loading, loaded with nothing to show ("No public posts yet"), and a request that failed
 * (with a retry). An empty list is never treated as a failure.
 */
export const ProfilePosts: React.FC<{ memberId: string }> = ({ memberId }) => {
  // Posts read a moment ago (the profile starts reading them alongside itself) are shown at once, with no skeleton.
  const remembered = useRef(peekMemberPostsFirstPage(memberId));
  const [posts, setPosts] = useState<CommunityPost[]>(() => remembered.current?.posts ?? []);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(() => remembered.current?.cursor ?? null);
  const [done, setDone] = useState(() => remembered.current?.done ?? true);
  const [loading, setLoading] = useState(remembered.current === null);
  const [error, setError] = useState(false);
  const openPost = useOpenPost();
  /** Which member's posts are current, so an answer for a profile that has been left cannot land on this one. */
  const current = useRef(memberId);
  current.current = memberId;

  const load = useCallback(async (after: QueryDocumentSnapshot | null) => {
    setLoading(true);
    setError(false);
    const outcome = await fetchMemberCommunityPosts(memberId, after);
    if (current.current !== memberId) return;
    setLoading(false);
    if (!outcome.ok) {
      setError(true);
      return;
    }
    const { page } = outcome;
    setPosts((existing) => (after ? [...existing, ...page.posts] : page.posts));
    setCursor(page.cursor);
    setDone(page.done);
  }, [memberId]);

  const firstRun = useRef(true);
  useEffect(() => {
    // The very first run keeps what the memory gave; a different member starts over.
    if (firstRun.current) {
      firstRun.current = false;
      if (remembered.current) return;
    }
    const hit = peekMemberPostsFirstPage(memberId);
    if (hit) {
      setPosts(hit.posts);
      setCursor(hit.cursor);
      setDone(hit.done);
      setLoading(false);
      setError(false);
      return;
    }
    setPosts([]);
    setCursor(null);
    setDone(true);
    void load(null);
  }, [load, memberId]);

  const canOpen = (id: string) => openPost !== null && isPostId(id);
  const view = postsView({ loading, failed: error, count: posts.length });
  if (view === 'loading') {
    return (
      <Section title="Posts">
        <div role="status" aria-label="Loading posts" className="space-y-2.5">
          {[0, 1].map((n) => <PostCardSkeleton key={n} />)}
        </div>
      </Section>
    );
  }
  if (view === 'empty') {
    return (
      <Section title="Posts">
        <div className="rounded-2xl border border-dashed border-line bg-raised/30 px-4 py-6 text-center">
          <p className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">No public posts yet</p>
          <p className="mt-1 text-[length:calc(13px_*_var(--fs,1))] text-subtle">Their shared posts will appear here.</p>
        </div>
      </Section>
    );
  }
  if (view === 'error') {
    return (
      <Section title="Posts">
        <p role="alert" className="text-sm text-muted">Couldn’t load posts. <button type="button" onClick={() => void load(cursor)} className="font-semibold text-berry underline underline-offset-4">Try again</button></p>
      </Section>
    );
  }
  return (
    <Section title="Posts">
      <ul className="space-y-2.5">
        {posts.map((post) => (
          <li key={post.id}>
            {/* The whole card opens the original post; the controls inside it (such as "more") keep their own taps. */}
            <article
              role={canOpen(post.id) ? 'link' : undefined}
              tabIndex={canOpen(post.id) ? 0 : undefined}
              aria-label={canOpen(post.id) ? `Open post: ${post.title}` : undefined}
              onClick={(event) => { if (canOpen(post.id) && !isInnerControl(event.target)) openPost?.(post.id); }}
              onKeyDown={(event) => { if (canOpen(post.id) && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPost?.(post.id); } }}
              className={`rounded-2xl border border-line bg-raised/50 p-3.5 ${canOpen(post.id) ? 'cursor-pointer transition-colors hover:border-line-strong hover:bg-raised/70 active:bg-raised/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60' : ''}`}
            >
              <p className="flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                <span className="inline-flex items-center h-5 px-2 rounded-full bg-plum/30 text-lavender text-[length:calc(11px_*_var(--fs,1))] font-semibold">
                  {CATEGORY_EMOJI[post.category] ?? '🌸'} {CATEGORY_LABELS[post.category] ?? post.category}
                </span>
                <span>· {formatRelativeTime(post.timestamp)}</span>
              </p>
              {post.title && <h3 className="mt-2 text-[length:calc(15px_*_var(--fs,1))] font-semibold text-fg leading-snug [overflow-wrap:anywhere]">{post.title}</h3>}
              <ExpandableText text={post.content} className="mt-1 text-[length:calc(14px_*_var(--fs,1))] text-muted leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]" />
              <p className="mt-2 flex items-center gap-3 text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                <StardustCount count={post.stardustCount} />
                <span className="inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> {post.replyCount ?? 0}<span className="sr-only"> replies</span></span>
              </p>
            </article>
          </li>
        ))}
      </ul>
      {loading && <div className="flex justify-center py-4 text-muted"><LoaderCircle className="h-4 w-4 animate-spin text-berry" aria-label="Loading posts" /></div>}
      {error && (
        <p role="alert" className="text-sm text-muted">Couldn’t load posts. <button type="button" onClick={() => void load(cursor)} className="font-semibold text-berry underline underline-offset-4">Try again</button></p>
      )}
      {!loading && !error && !done && (
        <button type="button" onClick={() => void load(cursor)} className="mt-2.5 btn btn-secondary btn-sm w-full">Show more</button>
      )}
    </Section>
  );
};

const Badge: React.FC<{ children: React.ReactNode; tone?: 'nsfw' | 'soft' }> = ({ children, tone = 'soft' }) => (
  <span className={`inline-flex items-center h-6 px-2 rounded-full text-[length:calc(11px_*_var(--fs,1))] font-semibold tracking-wide ${tone === 'nsfw' ? 'bg-danger/15 text-danger border border-danger/30' : 'bg-plum/30 text-lavender border border-lavender/20'}`}>
    {children}
  </span>
);

/**
 * A member's live Looking For posts, drawn with the same card pieces as the board: the same preview and details, the same
 * cover for mature posts and the same reveal rules, and Send Connection Request opens the usual request composer. Paused
 * posts are not listed for visitors (they are not open opportunities), and a mature post stays covered until the visitor
 * reveals it, whatever their setting.
 */
export const ProfileLookingFor: React.FC<{
  posts: LookingForPost[];
  isSelf: boolean;
  nsfwPreference: NsfwPreference;
  onOpenSettings?: () => void;
  onRequest: (post: LookingForPost) => void;
}> = ({ posts, isSelf, nsfwPreference, onOpenSettings, onRequest }) => {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<LookingForPost | null>(null);

  if (posts.length === 0) return null;
  const reveal = (post: LookingForPost) => {
    if (nsfwPreference === 'hide') return;
    if (revealNeedsDialog(nsfwPreference)) setConfirm(post);
    else setRevealed((prev) => new Set(prev).add(post.id));
  };

  return (
    <Section title="Looking for">
      <ul className="space-y-2.5">
        {posts.map((post) => {
          // A member always sees their own posts open; everyone else follows the content setting, one post at a time.
          const presentation = isSelf ? 'open' : postPresentation(post, nsfwPreference, revealed.has(post.id));
          return (
            <li key={post.id}>
              <article className="rounded-2xl border border-line bg-raised/50 p-3.5">
                <p className="flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle min-w-0">
                  {presentation !== 'open' && <Badge>{INTENTION_LABELS[post.intention]}</Badge>}
                  {post.requestsPaused && <span className="shrink-0">Paused</span>}
                  <span className="truncate">
                    {presentation === 'open' && post.region && <><MapPin className="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> {post.region} · </>}
                    {formatRelativeTime(post.timestamp)}
                  </span>
                  {post.isNsfw && <span className="ml-auto"><Badge tone="nsfw">NSFW</Badge></span>}
                </p>
                {presentation === 'open' ? (
                  <LookingForBody
                    post={post}
                    mine={isSelf}
                    canCoverAgain={post.isNsfw && !isSelf && nsfwPreference !== 'hide'}
                    onCoverAgain={() => setRevealed((prev) => { const next = new Set(prev); next.delete(post.id); return next; })}
                    onRequest={() => onRequest(post)}
                  />
                ) : (
                  <SensitiveCover contentWarning={post.contentWarning} blocked={presentation === 'blocked'} onReveal={() => reveal(post)} onOpenSettings={onOpenSettings} />
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {confirm && (
        <ConfirmDialog
          title="Show sensitive content?"
          message={confirm.contentWarning ? `The author added a warning: “${confirm.contentWarning}”. This post is marked NSFW. Only continue if you are comfortable.` : 'This post is marked NSFW and may contain mature themes. Only continue if you are comfortable.'}
          confirmLabel="Show this post"
          cancelLabel="Keep it hidden"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setRevealed((prev) => new Set(prev).add(confirm.id)); setConfirm(null); }}
        />
      )}
    </Section>
  );
};
