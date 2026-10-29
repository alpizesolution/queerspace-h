import React, { useEffect, useState } from 'react';
import { ArrowUp, Check, CheckCircle2, Heart, MessageCircle, Plus, Share, Trash2, X } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { FloatingAddButton } from './FloatingAddButton.tsx';
import { CommunityPost, CommunityReply, UserPreferences } from '../types.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import {
  adminDeleteCommunityPost,
  adminDeleteCommunityReply,
  COMMUNITY_REPLY_MAX_LENGTH,
  createCommunityPost,
  deleteCommunityPost,
  fetchIsCommunityAdmin,
  isCommunityAvailable,
  replyToCommunityPost,
  setCommunityLike,
  subscribeToCommunity,
  subscribeToReplies,
} from '../services/communityService.ts';
import { whileActive } from '../utils/whileActive.ts';

/** What the confirmation dialog is about to remove. */
type PendingDelete =
  | { kind: 'post'; postId: string; admin: boolean }
  | { kind: 'reply'; postId: string; replyId: string };

interface CommunityFeedViewProps {
  userPrefs: UserPreferences;
}

// Which posts this device has liked, so the heart shows filled. The server still allows one like per person.
const LIKED_KEY = 'qs_community_liked';

function loadLiked(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LIKED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLiked(map: Record<string, boolean>) {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify(map));
  } catch {
    // Per-device convenience only.
  }
}

/** Live replies for one expanded post, plus the reply box. */
const Replies: React.FC<{
  post: CommunityPost;
  userPrefs: UserPreferences;
  isAdmin: boolean;
  onDeleteReply: (replyId: string) => void;
}> = ({ post, userPrefs, isAdmin, onDeleteReply }) => {
  const [replies, setReplies] = useState<CommunityReply[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => whileActive(() => subscribeToReplies(post.id, setReplies, () => setReplies([]))), [post.id]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeMessageText(text.trim());
    if (!text.trim()) return;
    if (sanitized.isBlocked) {
      setError("This goes against our guidelines, so it can't be posted.");
      return;
    }
    setSending(true);
    const result = await replyToCommunityPost(userPrefs, post.id, sanitized.cleanText);
    setSending(false);
    if (result === 'ok') {
      setText('');
      setError(null);
    } else {
      setError(result === 'too-fast' ? 'Slow down a little, then try again.' : "Couldn't send. Check your connection.");
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-line space-y-3 anim-fade">
      {replies === null ? (
        <div className="h-10 rounded-xl bg-raised animate-pulse" aria-hidden="true" />
      ) : (
        replies.map((reply) => (
          <div key={reply.id} className="flex gap-2.5 text-[length:calc(14px_*_var(--fs,1))]">
            <AnimalAvatar avatar={reply.authorAvatar} seed={reply.authorId || reply.author} className="w-7 h-7 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                <span className="font-semibold text-fg">{reply.author}</span> {reply.authorPronouns} ·{' '}
                {formatChatTime(reply.timestamp)}
              </p>
              <p className="text-muted leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] mt-0.5">{reply.content}</p>
            </div>
            {isAdmin && (
              <button
                onClick={() => onDeleteReply(reply.id)}
                className="icon-btn w-8 h-8 -mr-1.5 -mt-1 text-subtle"
                aria-label={`Delete reply by ${reply.author} (moderator)`}
                title="Delete reply (moderator)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))
      )}

      <form onSubmit={send} className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          maxLength={COMMUNITY_REPLY_MAX_LENGTH}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="Write a reply"
          aria-label={`Reply to ${post.title}`}
          enterKeyHint="send"
          className="flex-1 min-w-0 h-10 px-4 rounded-full bg-ink border border-line text-base sm:text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-berry"
        />
        <button
          type="submit"
          onMouseDown={(e) => e.preventDefault()}
          disabled={!text.trim() || sending}
          className="w-10 h-10 shrink-0 rounded-full bg-berry text-ink flex items-center justify-center disabled:bg-raised disabled:text-subtle cursor-pointer disabled:cursor-not-allowed"
          aria-label="Send reply"
        >
          <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </form>
      {error && (
        <p className="text-[length:calc(12px_*_var(--fs,1))] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export const CommunityFeedView: React.FC<CommunityFeedViewProps> = ({
  userPrefs,
}) => {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>(loadLiked);

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<CommunityPost['category']>('general');
  const [newTag, setNewTag] = useState('');
  const [tagsList, setTagsList] = useState<string[]>(['Sapphic']);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [copiedPostId, setCopiedPostId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const available = isCommunityAvailable();

  useEffect(() => {
    if (!available) return;
    return whileActive(() =>
      subscribeToCommunity(
        (next, me) => {
          setPosts(next);
          setUid(me);
          setLoading(false);
          setFeedError(false);
        },
        () => {
          setLoading(false);
          setFeedError(true);
        }
      )
    );
  }, [available]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    fetchIsCommunityAdmin().then((admin) => {
      if (!cancelled) setIsAdmin(admin);
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

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    let ok: boolean;
    if (pendingDelete.kind === 'reply') ok = await adminDeleteCommunityReply(pendingDelete.postId, pendingDelete.replyId);
    else if (pendingDelete.admin) ok = await adminDeleteCommunityPost(pendingDelete.postId);
    else ok = await deleteCommunityPost(pendingDelete.postId);
    setDeleting(false);
    setToast(
      ok
        ? { text: pendingDelete.kind === 'reply' ? 'Reply deleted.' : 'Post deleted.', ok: true }
        : { text: "Couldn't delete that. Nothing was removed, please try again.", ok: false }
    );
    setPendingDelete(null);
  };

  const updateLiked = (postId: string, value: boolean) => {
    setLiked((prev) => {
      const next = { ...prev };
      if (value) next[postId] = true;
      else delete next[postId];
      saveLiked(next);
      return next;
    });
  };

  const handleLikePost = async (postId: string) => {
    const wasLiked = Boolean(liked[postId]);
    updateLiked(postId, !wasLiked);
    const ok = await setCommunityLike(postId, !wasLiked);
    // A refused like means this account already liked it on another visit; a refused unlike just reverts.
    if (!ok) updateLiked(postId, true);
  };

  const handleAddTag = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!newTag.trim() || tagsList.length >= 4) return;
    if (!tagsList.includes(newTag.trim())) {
      setTagsList([...tagsList, newTag.trim()]);
    }
    setNewTag('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTagsList(tagsList.filter((t) => t !== tagToRemove));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const titleSanitized = sanitizeMessageText(newTitle.trim());
    const contentSanitized = sanitizeMessageText(newContent.trim());

    if (titleSanitized.isBlocked || contentSanitized.isBlocked) {
      setPostError("This goes against our guidelines, so it can't be posted.");
      return;
    }

    setPosting(true);
    const result = await createCommunityPost(userPrefs, {
      title: titleSanitized.cleanText,
      content: contentSanitized.cleanText,
      category: newCategory,
      tags: tagsList,
    });
    setPosting(false);
    if (result !== 'ok') {
      setPostError(
        result === 'too-fast'
          ? 'You can post every 30 seconds. Take a breath and try again.'
          : "Couldn't post. Check your connection and try again."
      );
      return;
    }
    setNewTitle('');
    setNewContent('');
    setTagsList(['Sapphic']);
    setPostError(null);
    setShowCreateModal(false);
  };

  const handleShare = async (post: CommunityPost) => {
    const text = `${post.title}\n\n${post.content}`;
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n\n${url}`);
      setCopiedPostId(post.id);
      setTimeout(() => setCopiedPostId(null), 2000);
    } catch {
      // Share sheet dismissed or clipboard unavailable: nothing to do.
    }
  };

  const filteredPosts =
    activeCategory === 'all'
      ? posts
      : posts.filter((p) => p.category === activeCategory);

  const openComposer = () => setShowCreateModal(true);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 sm:pt-10 pb-[calc(var(--tabbar-h)+6rem)] desk:pb-16">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-[length:calc(28px_*_var(--fs,1))] font-semibold tracking-tight text-fg">Cosmos</h1>
        <button onClick={openComposer} className="btn btn-primary btn-sm hidden sm:inline-flex">
          <Plus className="w-4 h-4" />
          New post
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Categories"
        className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto scrollbar-none pb-1 mb-5"
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            role="tab"
            aria-selected={activeCategory === cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`chip shrink-0 ${activeCategory === cat.id ? '!bg-fg !text-ink !border-fg' : ''}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {!available ? (
        <p className="card p-5 text-sm text-muted">Cosmos isn't available right now. Please try again later.</p>
      ) : loading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-36 animate-pulse" />
          ))}
        </div>
      ) : feedError ? (
        <p className="text-center text-sm text-muted py-12">Couldn't load posts. Please try again soon.</p>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-16 px-6">
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">Nothing here yet</p>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1 mb-5">Start the conversation.</p>
          <button onClick={openComposer} className="btn btn-secondary btn-sm">
            Write a post
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPosts.map((post) => {
            const isRepliesExpanded = expandedReplies[post.id];
            const userLiked = Boolean(liked[post.id]);
            const replyCount = post.replyCount ?? 0;
            return (
              <article key={post.id} className="rounded-3xl border border-line bg-gradient-to-b from-raised/60 to-surface p-4 sm:p-5">
                <header className="flex items-center gap-2.5 mb-3">
                  <AnimalAvatar avatar={post.authorAvatar} seed={post.authorId || post.author} className="w-9 h-9" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg truncate">
                      {post.author} <span className="font-normal text-subtle">{post.authorPronouns}</span>
                    </p>
                    <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                      {CATEGORY_EMOJI[post.category] ?? '🌸'} {CATEGORY_LABELS[post.category] ?? post.category} · {formatChatTime(post.timestamp)}
                    </p>
                  </div>
                  {(isAdmin || (uid && post.authorId === uid)) && (
                    <button
                      onClick={() => setPendingDelete({ kind: 'post', postId: post.id, admin: isAdmin })}
                      className="icon-btn w-9 h-9 -mr-2"
                      aria-label={isAdmin && post.authorId !== uid ? 'Delete post (moderator)' : 'Delete your post'}
                      title={isAdmin && post.authorId !== uid ? 'Delete post (moderator)' : 'Delete your post'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </header>

                <h2 className="text-[length:calc(15px_*_var(--fs,1))] sm:text-[length:calc(17px_*_var(--fs,1))] font-semibold text-fg leading-snug">{post.title}</h2>
                <p className="mt-1 text-[length:calc(14px_*_var(--fs,1))] sm:text-[length:calc(15px_*_var(--fs,1))] text-muted leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {post.content}
                </p>

                {post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {post.tags.map((tag) => (
                      <span key={tag} className="h-6 px-2.5 inline-flex items-center rounded-full bg-lavender/10 text-lavender text-[length:calc(12px_*_var(--fs,1))]">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1 mt-3 -ml-2 text-[length:calc(13px_*_var(--fs,1))] text-muted">
                  <button
                    onClick={() => handleLikePost(post.id)}
                    aria-pressed={!!userLiked}
                    aria-label={userLiked ? 'Unlike' : 'Like'}
                    className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full hover:bg-raised transition-colors cursor-pointer ${
                      userLiked ? 'text-berry' : 'hover:text-fg'
                    }`}
                  >
                    <Heart className={`w-[18px] h-[18px] ${userLiked ? 'fill-berry' : ''}`} />
                    {post.likes}
                  </button>
                  <button
                    onClick={() => setExpandedReplies({ ...expandedReplies, [post.id]: !isRepliesExpanded })}
                    aria-expanded={!!isRepliesExpanded}
                    aria-label={`${replyCount} replies`}
                    className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full hover:bg-raised hover:text-fg transition-colors cursor-pointer ${
                      isRepliesExpanded ? 'text-fg' : ''
                    }`}
                  >
                    <MessageCircle className="w-[18px] h-[18px]" />
                    {replyCount}
                  </button>
                  <button
                    onClick={() => handleShare(post)}
                    className="ml-auto inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full hover:bg-raised hover:text-fg transition-colors cursor-pointer"
                    aria-label="Share post"
                  >
                    {copiedPostId === post.id ? (
                      <>
                        <Check className="w-[18px] h-[18px] text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <Share className="w-[18px] h-[18px]" />
                    )}
                  </button>
                </div>

                {isRepliesExpanded && (
                  <Replies
                    post={post}
                    userPrefs={userPrefs}
                    isAdmin={isAdmin}
                    onDeleteReply={(replyId) => setPendingDelete({ kind: 'reply', postId: post.id, replyId })}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Mobile compose button, kept clear of the tab bar */}
      <FloatingAddButton onClick={openComposer} label="New post" />

      {showCreateModal && (
        <Sheet
          title="New post"
          onClose={() => setShowCreateModal(false)}
          footer={
            <button
              type="submit"
              form="qs-new-post"
              disabled={!newTitle.trim() || !newContent.trim() || posting}
              className="btn btn-primary w-full"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          }
        >
          <form id="qs-new-post" onSubmit={handleCreatePost} className="space-y-5 text-fg">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
              {CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="radio"
                  aria-checked={newCategory === cat.id}
                  aria-pressed={newCategory === cat.id}
                  onClick={() => setNewCategory(cat.id as CommunityPost['category'])}
                  className="chip"
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              required
              maxLength={90}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title"
              aria-label="Title"
              className="input"
            />

            <textarea
              required
              rows={5}
              maxLength={1000}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="What's on your mind?"
              aria-label="Post content"
              className="input"
            />

            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                {tagsList.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-0.5 h-8 pl-3 pr-1 rounded-full bg-raised border border-line text-[length:calc(13px_*_var(--fs,1))] text-lavender">
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-subtle hover:text-fg cursor-pointer"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
                {tagsList.length < 4 && (
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') handleAddTag(e);
                    }}
                    onBlur={(e) => newTag.trim() && handleAddTag(e)}
                    placeholder="Add tag"
                    aria-label="Add a tag"
                    maxLength={15}
                    className="h-8 w-28 px-2 bg-transparent text-base sm:text-[length:calc(13px_*_var(--fs,1))] text-fg placeholder:text-subtle focus:outline-none"
                  />
                )}
              </div>
              <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle mt-1.5">Up to 4 tags.</p>
            </div>
            {postError && (
              <p className="text-[length:calc(13px_*_var(--fs,1))] text-danger" role="alert">
                {postError}
              </p>
            )}
          </form>
        </Sheet>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'reply' ? 'Delete this reply?' : 'Delete this post?'}
          message={
            pendingDelete.kind === 'reply'
              ? 'This reply will be removed for everyone. This action cannot be undone.'
              : pendingDelete.admin
                ? 'This post and all of its replies will be removed for everyone. This action cannot be undone.'
                : 'This post will be removed for everyone. This action cannot be undone.'
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete permanently'}
          tone="danger"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
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

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'vents', label: 'Cozy Vents' },
  { id: 'media', label: 'Books & Media' },
  { id: 'friends', label: 'Friend Finder' },
  { id: 'advice', label: 'Dating & Advice' },
  { id: 'general', label: 'General' },
];

const CATEGORY_EMOJI: Record<string, string> = {
  vents: '☁️',
  media: '📚',
  friends: '🫶',
  advice: '💌',
  general: '🌸',
};
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
