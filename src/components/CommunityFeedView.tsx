import React, { useState } from 'react';
import {
  MessageSquare,
  Heart,
  Plus,
  ArrowLeft,
  Sparkles,
  Send,
  X,
  Share2,
  Check,
} from 'lucide-react';
import { CommunityPost, UserPreferences } from '../types.ts';
import { INITIAL_COMMUNITY_POSTS } from '../utils/community-data.ts';
import { formatChatTime, sanitizeMessageText } from '../utils/matching-logic.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../utils/storage.ts';

interface CommunityFeedViewProps {
  userPrefs: UserPreferences;
  onBackToHome: () => void;
  onStart1on1: () => void;
}

export const CommunityFeedView: React.FC<CommunityFeedViewProps> = ({
  userPrefs,
  onBackToHome,
  onStart1on1,
}) => {
  const [posts, setPosts] = useState<CommunityPost[]>(() => {
    const saved = getStorageItem(
      STORAGE_KEYS.COMMUNITY_POSTS.current,
      STORAGE_KEYS.COMMUNITY_POSTS.legacies
    );
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_COMMUNITY_POSTS;
      }
    }
    return INITIAL_COMMUNITY_POSTS;
  });

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<CommunityPost['category']>('general');
  const [newTag, setNewTag] = useState('');
  const [tagsList, setTagsList] = useState<string[]>(['Sapphic']);
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [copiedPostId, setCopiedPostId] = useState<string | null>(null);

  const savePosts = (newPosts: CommunityPost[]) => {
    setPosts(newPosts);
    setStorageItem(STORAGE_KEYS.COMMUNITY_POSTS.current, JSON.stringify(newPosts));
  };

  const handleLikePost = (postId: string) => {
    const updated = posts.map((post) => {
      if (post.id !== postId) return post;
      const isLiked = post.userLiked;
      return {
        ...post,
        likes: isLiked ? post.likes - 1 : post.likes + 1,
        userLiked: !isLiked,
      };
    });
    savePosts(updated);
  };

  const handleAddTag = (e: React.FormEvent) => {
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

  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    const titleSanitized = sanitizeMessageText(newTitle);
    const contentSanitized = sanitizeMessageText(newContent);

    if (titleSanitized.isBlocked || contentSanitized.isBlocked) return;

    const newPost: CommunityPost = {
      id: `post-${Date.now()}`,
      author: userPrefs.displayName || 'Sapphic Guest',
      authorPronouns: userPrefs.pronouns || 'she/her',
      category: newCategory,
      title: titleSanitized.cleanText,
      content: contentSanitized.cleanText,
      timestamp: Date.now(),
      likes: 1,
      userLiked: true,
      replies: [],
      tags: tagsList,
    };

    savePosts([newPost, ...posts]);
    setNewTitle('');
    setNewContent('');
    setTagsList(['Sapphic']);
    setShowCreateModal(false);
  };

  const handleAddReply = (postId: string) => {
    const text = replyTextMap[postId];
    if (!text || !text.trim()) return;

    const sanitized = sanitizeMessageText(text);
    if (sanitized.isBlocked) return;

    const reply = {
      id: `reply-${Date.now()}`,
      author: userPrefs.displayName || 'Sapphic Guest',
      authorPronouns: userPrefs.pronouns || 'she/her',
      content: sanitized.cleanText,
      timestamp: Date.now(),
    };

    const updated = posts.map((post) => {
      if (post.id !== postId) return post;
      return {
        ...post,
        replies: [...post.replies, reply],
      };
    });

    savePosts(updated);
    setReplyTextMap({ ...replyTextMap, [postId]: '' });
    setExpandedReplies({ ...expandedReplies, [postId]: true });
  };

  const handleCopyLink = (postId: string) => {
    setCopiedPostId(postId);
    setTimeout(() => setCopiedPostId(null), 2000);
  };

  const filteredPosts =
    activeCategory === 'all'
      ? posts
      : posts.filter((p) => p.category === activeCategory);

  return (
    <div className="max-w-4xl mx-auto px-3.5 sm:px-6 py-4 sm:py-8 pb-24 sm:pb-8">
      {/* Feed Top Header - Optimized for Mobile */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 sm:pb-6 mb-4 sm:mb-6 border-b border-[#4a1f6d]">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={onBackToHome}
            className="p-2 sm:p-2.5 rounded-full bg-[#150826] hover:bg-[#230d3b] text-[#cbbccf] hover:text-[#fcf7fa] border border-[#4a1f6d] transition-colors cursor-pointer shrink-0 active:scale-95"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-xl sm:text-2xl font-bold text-[#fcf7fa] truncate">
              Sapphic Community Posts
            </h1>
            <p className="text-xs text-[#cbbccf] truncate">
              Stories, cozy vents, book picks, and friend finders
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-xs sm:text-sm font-bold shadow-md shadow-[#e07bb8]/20 transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Community Post</span>
          </button>
        </div>
      </div>

      {/* Category Pills - Smooth Touch Pan & Edge-to-Edge Scroll on Mobile */}
      <div className="-mx-3.5 px-3.5 sm:mx-0 sm:px-0 flex items-center gap-2 overflow-x-auto pb-3 mb-4 sm:mb-6 scrollbar-none snap-x snap-mandatory touch-pan-x">
        {[
          { id: 'all', label: 'All Posts' },
          { id: 'vents', label: 'Cozy Vents' },
          { id: 'media', label: 'Books & Media' },
          { id: 'friends', label: 'Friend Finder' },
          { id: 'advice', label: 'Dating & Advice' },
          { id: 'general', label: 'General' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`snap-start shrink-0 whitespace-nowrap px-4 py-2 sm:py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeCategory === cat.id
                ? 'bg-[#e07bb8] text-[#080311] font-bold shadow-sm'
                : 'bg-[#150826] text-[#cbbccf] border border-[#4a1f6d] hover:border-[#e07bb8]/60 hover:text-[#fcf7fa]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Posts List */}
      <div className="space-y-4 sm:space-y-5">
        {filteredPosts.length === 0 ? (
          <div className="text-center py-12 sm:py-16 glass-card rounded-3xl p-6 sm:p-8">
            <Sparkles className="w-8 h-8 text-[#e07bb8] mx-auto mb-3 animate-pulse" />
            <h3 className="font-serif text-lg font-bold text-[#fcf7fa] mb-1">
              No posts in this topic yet
            </h3>
            <p className="text-xs text-[#cbbccf] mb-4">
              Be the first to share a cozy thought or recommendation.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-2.5 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
            >
              Write First Post
            </button>
          </div>
        ) : (
          filteredPosts.map((post) => {
            const isRepliesExpanded = expandedReplies[post.id];
            return (
              <article
                key={post.id}
                className="glass-card glass-card-hover rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden"
              >
                {/* Post Author Header Row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#230d3b] text-[#e07bb8] border border-[#4a1f6d] flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 shadow-xs">
                      {post.author.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-xs sm:text-sm text-[#fcf7fa] truncate">
                          {post.author}
                        </span>
                        <span className="text-[10px] text-[#cbbccf] bg-[#230d3b] px-2 py-0.5 rounded-full border border-[#4a1f6d] shrink-0">
                          {post.authorPronouns}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#cbbccf]/70 block mt-0.5">
                        {formatChatTime(post.timestamp)}
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#e07bb8] bg-[#230d3b] px-2.5 py-1 rounded-full border border-[#4a1f6d] shrink-0">
                    {post.category}
                  </span>
                </div>

                {/* Post Content */}
                <h3 className="font-serif text-base sm:text-lg font-bold text-[#fcf7fa] mb-2 leading-snug">
                  {post.title}
                </h3>
                <p className="text-xs sm:text-sm text-[#cbbccf] leading-relaxed mb-3.5 whitespace-pre-wrap break-words">
                  {post.content}
                </p>

                {/* Tags */}
                {post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3.5">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] font-medium text-[#cbbccf] bg-[#080311]/60 border border-[#4a1f6d] px-2.5 py-0.5 rounded-full"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Mobile-Friendly Action Bar */}
                <div className="flex items-center justify-between pt-3 border-t border-[#4a1f6d]/80 text-xs text-[#cbbccf]">
                  <div className="flex items-center gap-3 sm:gap-4">
                    {/* Like button */}
                    <button
                      onClick={() => handleLikePost(post.id)}
                      className={`flex items-center gap-1.5 py-1 px-2.5 rounded-full transition-colors cursor-pointer active:scale-95 ${
                        post.userLiked
                          ? 'text-[#e07bb8] font-bold bg-[#230d3b] border border-[#4a1f6d]'
                          : 'hover:text-[#fcf7fa] hover:bg-[#230d3b]/50'
                      }`}
                      aria-label="Like post"
                    >
                      <Heart
                        className={`w-4 h-4 ${
                          post.userLiked ? 'fill-[#e07bb8] text-[#e07bb8]' : ''
                        }`}
                      />
                      <span>{post.likes}</span>
                    </button>

                    {/* Replies count button */}
                    <button
                      onClick={() =>
                        setExpandedReplies({
                          ...expandedReplies,
                          [post.id]: !isRepliesExpanded,
                        })
                      }
                      className="flex items-center gap-1.5 py-1 px-2.5 rounded-full hover:text-[#fcf7fa] hover:bg-[#230d3b]/50 transition-colors cursor-pointer active:scale-95"
                    >
                      <MessageSquare className="w-4 h-4 text-[#e07bb8]" />
                      <span>{post.replies.length} <span className="hidden xs:inline">replies</span></span>
                    </button>
                  </div>

                  {/* Share button */}
                  <button
                    onClick={() => handleCopyLink(post.id)}
                    className="flex items-center gap-1 py-1 px-2.5 rounded-full hover:text-[#fcf7fa] hover:bg-[#230d3b]/50 transition-colors cursor-pointer text-[11px] active:scale-95"
                  >
                    {copiedPostId === post.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded Threaded Replies Container */}
                {isRepliesExpanded && (
                  <div className="mt-4 pt-4 border-t border-[#4a1f6d] space-y-3 bg-[#080311]/80 -mx-4 -mb-4 sm:-mx-6 sm:-mb-6 p-3.5 sm:p-5 rounded-b-3xl">
                    <h4 className="text-xs font-bold text-[#fcf7fa] flex items-center justify-between">
                      <span>Discussion & Replies ({post.replies.length})</span>
                    </h4>

                    {post.replies.length === 0 ? (
                      <p className="text-[11px] text-[#cbbccf]/70 italic py-1">
                        No replies yet. Start the conversation!
                      </p>
                    ) : (
                      post.replies.map((reply) => (
                        <div
                          key={reply.id}
                          className="bg-[#150826] p-3 rounded-2xl border border-[#4a1f6d] text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[#fcf7fa] truncate">{reply.author}</span>
                              <span className="text-[10px] text-[#cbbccf] shrink-0">({reply.authorPronouns})</span>
                            </div>
                            <span className="text-[10px] text-[#cbbccf]/70 shrink-0">
                              {formatChatTime(reply.timestamp)}
                            </span>
                          </div>
                          <p className="text-[#cbbccf] leading-relaxed whitespace-pre-wrap break-words">{reply.content}</p>
                        </div>
                      ))
                    )}

                    {/* Mobile-Optimized Inline Reply Composer */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={replyTextMap[post.id] || ''}
                        onChange={(e) =>
                          setReplyTextMap({
                            ...replyTextMap,
                            [post.id]: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddReply(post.id);
                          }
                        }}
                        placeholder={`Reply as ${userPrefs.displayName || 'Sapphic Guest'}...`}
                        className="flex-1 px-3.5 py-2.5 rounded-full bg-[#150826] border border-[#4a1f6d] text-xs text-[#fcf7fa] placeholder-[#cbbccf]/50 focus:outline-none focus:border-[#e07bb8]"
                      />
                      <button
                        onClick={() => handleAddReply(post.id)}
                        disabled={!replyTextMap[post.id]?.trim()}
                        className="p-2.5 rounded-full bg-[#e07bb8] hover:bg-[#a85293] disabled:opacity-40 text-[#080311] hover:text-white cursor-pointer transition-all active:scale-95 shrink-0 shadow-xs"
                        aria-label="Send reply"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {/* Mobile Floating "New Post" Button for Quick Access */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="sm:hidden fixed bottom-6 right-5 z-30 flex items-center gap-2 px-4 py-3 rounded-full bg-[#e07bb8] text-[#080311] font-bold text-xs shadow-2xl shadow-[#e07bb8]/40 border border-white/20 active:scale-95 transition-transform cursor-pointer"
        aria-label="Create new community post"
      >
        <Plus className="w-4 h-4" />
        <span>New Post</span>
      </button>

      {/* Create Post Modal - Mobile Bottom-Sheet & Keyboard Friendly */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#150826] w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#4a1f6d] p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#4a1f6d] mb-4">
              <h3 className="font-serif text-lg font-bold text-[#fcf7fa]">
                Create a Community Post
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-full text-[#cbbccf] hover:bg-[#230d3b] hover:text-[#fcf7fa] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePost} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#fcf7fa] mb-1.5">
                  Category Topic
                </label>
                <select
                  value={newCategory}
                  onChange={(e) =>
                    setNewCategory(e.target.value as CommunityPost['category'])
                  }
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-[#4a1f6d] text-xs text-[#fcf7fa] bg-[#080311] focus:outline-none focus:border-[#e07bb8]"
                >
                  <option value="general">General Sapphic Thought</option>
                  <option value="media">Books, Music & Cinema</option>
                  <option value="vents">Cozy Vent & Life</option>
                  <option value="friends">Friend Finder / Gaming</option>
                  <option value="advice">Dating & Advice</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#fcf7fa] mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={90}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-[#4a1f6d] text-xs sm:text-sm text-[#fcf7fa] bg-[#080311] placeholder-[#cbbccf]/50 focus:outline-none focus:border-[#e07bb8]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#fcf7fa] mb-1.5">
                  Content
                </label>
                <textarea
                  required
                  rows={4}
                  maxLength={1000}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Share your story, question, or cozy recommendation..."
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-[#4a1f6d] text-xs sm:text-sm text-[#fcf7fa] bg-[#080311] placeholder-[#cbbccf]/50 focus:outline-none focus:border-[#e07bb8]"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-bold text-[#fcf7fa] mb-1.5">
                  Tags ({tagsList.length}/4)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tagsList.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#230d3b] text-[#e07bb8] px-2.5 py-1 rounded-full border border-[#4a1f6d]"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-red-400 cursor-pointer font-bold ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Add a tag..."
                    maxLength={15}
                    className="flex-1 px-3.5 py-2 rounded-2xl border border-[#4a1f6d] text-xs text-[#fcf7fa] bg-[#080311] placeholder-[#cbbccf]/50 focus:outline-none focus:border-[#e07bb8]"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    disabled={!newTag.trim() || tagsList.length >= 4}
                    className="px-3.5 py-2 rounded-2xl bg-[#230d3b] text-[#e07bb8] disabled:opacity-50 text-xs font-semibold border border-[#4a1f6d] hover:bg-[#a85293] hover:text-white transition-colors cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#4a1f6d]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-full border border-[#4a1f6d] text-xs font-semibold text-[#cbbccf] hover:bg-[#230d3b] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || !newContent.trim()}
                  className="px-5 py-2.5 rounded-full bg-[#e07bb8] hover:bg-[#a85293] text-[#080311] hover:text-white text-xs font-bold disabled:opacity-40 transition-all cursor-pointer shadow-md active:scale-95"
                >
                  Publish Post
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
