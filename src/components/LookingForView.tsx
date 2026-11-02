import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, EyeOff, Flag, MapPin, Pause, Pencil, Plus, ShieldAlert, SlidersHorizontal, Trash2, UserX } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { FloatingAddButton } from './FloatingAddButton.tsx';
import { LookingForBody } from './LookingForBody.tsx';
import { ConnectionRequestSheet } from './ConnectionRequestSheet.tsx';
import { LookingForComposer } from './LookingForComposer.tsx';
import type { UserPreferences } from '../types.ts';
import { sanitizeMessageText } from '../utils/matching-logic.ts';
import { formatRelativeTime } from '../utils/relativeTime.ts';
import { isAdultBirthDate } from '../utils/ageEligibility.ts';
import { PHILIPPINE_REGIONS_AND_LOCATIONS } from '../utils/philippines-locations.ts';
import { NSFW_PREFERENCE_OPTIONS, type NsfwPreference } from '../utils/nsfwPreference.ts';
import {
  activeFilterCount,
  applyLookingForFilters,
  INTENTION_LABELS,
  LOOKING_FOR_CATEGORIES,
  NO_FILTERS,
  popularTags,
  postPresentation,
  revealNeedsDialog,
  type LookingForFilters,
  type LookingForPost,
} from '../utils/lookingFor.ts';
import {
  deleteLookingForPost,
  isLookingForAvailable,
  REPORT_REASONS,
  reportLookingForPost,
  setRequestsPaused,
  subscribeToLookingFor,
} from '../services/lookingForService.ts';
import { whileActive } from '../utils/whileActive.ts';

interface Props {
  userPrefs: UserPreferences;
  blockedPartnerIds: string[];
  nsfwPreference: NsfwPreference;
  /** Opens Settings so the member can change how mature posts are handled. */
  onOpenSettings?: () => void;
  onBlockMember?: (memberId: string) => void;
  /** Opens Signals → Requests, where sent requests are managed. */
  onViewRequests?: () => void;
}

const fieldClass = 'w-full px-4 rounded-xl bg-ink border border-line text-base sm:text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-berry';

const Badge: React.FC<{ children: React.ReactNode; tone?: 'nsfw' | 'soft' }> = ({ children, tone = 'soft' }) => (
  <span className={`inline-flex items-center h-6 px-2 rounded-full text-[length:calc(11px_*_var(--fs,1))] font-semibold tracking-wide ${tone === 'nsfw' ? 'bg-danger/15 text-danger border border-danger/30' : 'bg-plum/30 text-lavender border border-lavender/20'}`}>
    {children}
  </span>
);

/** Soft placeholder lines standing in for hidden text, so nothing sensitive is in the page until it is revealed. */
const CoverLines: React.FC = () => (
  <div aria-hidden="true" className="space-y-2 blur-[3px] select-none">
    <div className="h-4 w-4/5 rounded-full bg-line-strong/60" />
    <div className="h-3 w-full rounded-full bg-line/70" />
    <div className="h-3 w-11/12 rounded-full bg-line/70" />
    <div className="h-3 w-2/3 rounded-full bg-line/70" />
  </div>
);

export const LookingForView: React.FC<Props> = ({ userPrefs, blockedPartnerIds, nsfwPreference, onOpenSettings, onBlockMember, onViewRequests }) => {
  const [filters, setFilters] = useState<LookingForFilters>(NO_FILTERS);
  const [posts, setPosts] = useState<LookingForPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'denied' | 'failed' | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  /** Posts the member has chosen to reveal in this visit. Never stored, never automatic. */
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [confirmReveal, setConfirmReveal] = useState<LookingForPost | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [composer, setComposer] = useState<{ editing: LookingForPost | null } | null>(null);
  const [requestPost, setRequestPost] = useState<LookingForPost | null>(null);
  const [reportPost, setReportPost] = useState<LookingForPost | null>(null);
  const [deletePost, setDeletePost] = useState<LookingForPost | null>(null);
  const [blockPost, setBlockPost] = useState<LookingForPost | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const available = isLookingForAvailable();
  const adult = isAdultBirthDate(userPrefs.birthDate);

  useEffect(() => {
    if (!available) return;
    setLoading(true);
    return whileActive(() =>
      subscribeToLookingFor(
        filters.category,
        (next, me) => {
          setPosts(next);
          setUid(me);
          setLoading(false);
          setLoadError(null);
        },
        (reason) => {
          setLoading(false);
          setLoadError(reason);
        }
      )
    );
  }, [available, filters.category]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  const visible = useMemo(() => applyLookingForFilters(posts, filters, blockedPartnerIds), [posts, filters, blockedPartnerIds]);
  const tags = useMemo(() => popularTags(posts), [posts]);
  const ownPostIds = useMemo(() => posts.filter((p) => p.authorId === uid).map((p) => p.id), [posts, uid]);
  const filterCount = activeFilterCount(filters);

  const reveal = (post: LookingForPost) => {
    if (nsfwPreference === 'hide') return;
    if (revealNeedsDialog(nsfwPreference)) setConfirmReveal(post);
    else setRevealed((prev) => new Set(prev).add(post.id));
  };

  const doDelete = async () => {
    if (!deletePost || busy) return;
    setBusy(true);
    const ok = await deleteLookingForPost(deletePost.id);
    setBusy(false);
    setDeletePost(null);
    setToast(ok ? { text: 'Post deleted.', ok: true } : { text: 'Couldn’t delete that. Please try again.', ok: false });
  };

  const openComposer = (editing: LookingForPost | null) => {
    if (!adult || userPrefs.profileComplete !== true) {
      setToast({ text: 'Save your profile with your birthday to post in Looking For.', ok: false });
      return;
    }
    setComposer({ editing });
  };

  const setFilter = <K extends keyof LookingForFilters>(key: K, value: LookingForFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div role="tablist" aria-label="Looking for categories" className="-mx-4 px-4 sm:mx-0 sm:px-0 flex flex-1 min-w-0 gap-2 overflow-x-auto scrollbar-none pb-1">
          {LOOKING_FOR_CATEGORIES.map((cat) => (
            <button key={cat.id} role="tab" aria-selected={filters.category === cat.id} onClick={() => setFilter('category', cat.id)} className={`chip shrink-0 ${filters.category === cat.id ? '!bg-fg !text-ink !border-fg' : ''}`}>
              {cat.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setFiltersOpen(true)} aria-label={filterCount ? `Filters, ${filterCount} on` : 'Filters'} className="chip shrink-0 !px-3">
          <SlidersHorizontal className="w-4 h-4" />
          {filterCount > 0 && <span className="text-berry font-semibold">{filterCount}</span>}
        </button>
        <button type="button" onClick={() => openComposer(null)} className="btn btn-primary btn-sm hidden sm:inline-flex shrink-0">
          <Plus className="w-4 h-4" />
          New post
        </button>
      </div>

      {!available ? (
        <p className="card p-5 text-sm text-muted">Looking For isn’t available right now. Please try again later.</p>
      ) : loading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="card h-48 animate-pulse" />)}
        </div>
      ) : loadError === 'denied' ? (
        <div className="card p-5 text-center">
          <ShieldAlert className="w-6 h-6 text-lavender mx-auto mb-2" aria-hidden="true" />
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">Looking For is for adult members</p>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1">Add your birthday and save your profile to see and post connection requests.</p>
        </div>
      ) : loadError ? (
        <p className="text-center text-sm text-muted py-12">Couldn’t load posts. Please try again soon.</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 px-6">
          <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">{filterCount > 0 ? 'No one matches those filters' : 'No posts here yet'}</p>
          <p className="text-[length:calc(13px_*_var(--fs,1))] text-muted mt-1 mb-5">{filterCount > 0 ? 'Try loosening a filter.' : 'Be the first to say what you are looking for.'}</p>
          {filterCount > 0
            ? <button onClick={() => setFilters({ ...NO_FILTERS, category: filters.category })} className="btn btn-secondary btn-sm">Clear filters</button>
            : <button onClick={() => openComposer(null)} className="btn btn-secondary btn-sm">Write a post</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((post) => {
            const mine = post.authorId === uid;
            // Members always see their own posts open (so they can find, edit and delete them); the NSFW badge stays on.
            const presentation = mine ? 'open' : postPresentation(post, nsfwPreference, revealed.has(post.id));
            return (
              <article key={post.id} className="scroll-mt-[calc(var(--header-h)+0.5rem)] rounded-3xl border border-line bg-gradient-to-b from-raised/60 to-surface p-4 sm:p-5">
                <header className="flex items-center gap-2.5">
                  <AnimalAvatar avatar={post.authorAvatar} seed={post.authorId || post.author} className="w-10 h-10" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg truncate">
                      {post.author} {post.authorPronouns && <span className="font-normal text-subtle">{post.authorPronouns}</span>}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle min-w-0">
                      <Badge>{INTENTION_LABELS[post.intention]}</Badge>
                      {post.requestsPaused && <span className="shrink-0 text-subtle">Paused</span>}
                      <span className="truncate">
                        {presentation === 'open' && post.age !== undefined && <>{post.age} · </>}
                        {presentation === 'open' && post.region && <><MapPin className="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> {post.region} · </>}
                        {formatRelativeTime(post.timestamp)}
                      </span>
                    </p>
                  </div>
                  {post.isNsfw && <Badge tone="nsfw">NSFW</Badge>}
                  <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setMenuFor(menuFor === post.id ? null : post.id)} aria-label={`More for ${post.author}'s post`} aria-expanded={menuFor === post.id} aria-haspopup="menu" className="icon-btn w-9 h-9 -mr-2 text-subtle">
                      <span aria-hidden="true" className="text-lg leading-none">⋯</span>
                    </button>
                    {menuFor === post.id && (
                      <div role="menu" className="absolute right-0 top-10 z-20 min-w-40 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-lg shadow-black/40">
                        {mine ? (
                          <>
                            <button role="menuitem" type="button" onClick={() => { setMenuFor(null); openComposer(post); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-fg hover:bg-surface/70"><Pencil className="w-4 h-4" /> Edit</button>
                            <button role="menuitem" type="button" onClick={async () => { setMenuFor(null); const ok = await setRequestsPaused(post.id, !post.requestsPaused); setToast(ok ? { text: post.requestsPaused ? 'Requests are open again.' : 'New requests are paused. Existing ones stay in Signals.', ok: true } : { text: 'Couldn’t change that. Please try again.', ok: false }); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-fg hover:bg-surface/70"><Pause className="w-4 h-4" /> {post.requestsPaused ? 'Resume requests' : 'Pause requests'}</button>
                            <button role="menuitem" type="button" onClick={() => { setMenuFor(null); setDeletePost(post); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-danger hover:bg-surface/70"><Trash2 className="w-4 h-4" /> Delete</button>
                          </>
                        ) : (
                          <>
                            <button role="menuitem" type="button" onClick={() => { setMenuFor(null); setReportPost(post); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-fg hover:bg-surface/70"><Flag className="w-4 h-4" /> Report</button>
                            {onBlockMember && <button role="menuitem" type="button" onClick={() => { setMenuFor(null); setBlockPost(post); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-danger hover:bg-surface/70"><UserX className="w-4 h-4" /> Block</button>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </header>

                {presentation === 'open' ? (
                  <LookingForBody
                    post={post}
                    mine={mine}
                    canCoverAgain={post.isNsfw && !mine && nsfwPreference !== 'hide'}
                    onCoverAgain={() => setRevealed((prev) => { const next = new Set(prev); next.delete(post.id); return next; })}
                    onRequest={() => setRequestPost(post)}
                  />
                ) : (
                  <div className="mt-3 relative rounded-2xl border border-line bg-ink/40 overflow-hidden">
                    <div className="absolute inset-0 p-4"><CoverLines /></div>
                    <div className="relative flex flex-col items-center gap-1.5 bg-surface/60 px-4 py-4 text-center">
                      <EyeOff className="w-5 h-5 text-lavender" aria-hidden="true" />
                      <p className="text-[length:calc(14px_*_var(--fs,1))] font-semibold text-fg">Sensitive content</p>
                      {post.contentWarning && <p className="text-[length:calc(12px_*_var(--fs,1))] text-muted [overflow-wrap:anywhere]">{post.contentWarning}</p>}
                      {presentation === 'blocked' ? (
                        <>
                          <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle">Hidden by your content setting.</p>
                          {onOpenSettings && <button type="button" onClick={onOpenSettings} className="btn btn-secondary btn-sm">Change setting</button>}
                        </>
                      ) : (
                        <button type="button" onClick={() => reveal(post)} className="btn btn-secondary btn-sm">Reveal content</button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <FloatingAddButton onClick={() => openComposer(null)} label="New Looking For post" />

      {filtersOpen && (
        <Sheet
          title="Filters"
          size="sm"
          onClose={() => setFiltersOpen(false)}
          footer={
            <div className="flex gap-2">
              <button type="button" onClick={() => setFilters({ ...NO_FILTERS, category: filters.category })} className="btn btn-ghost flex-1">Reset</button>
              <button type="button" onClick={() => setFiltersOpen(false)} className="btn btn-primary flex-1">Done</button>
            </div>
          }
        >
          <div className="space-y-5">
            <div>
              <p className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg mb-1.5">Age range</p>
              <div className="flex items-center gap-2">
                <input aria-label="Youngest age" inputMode="numeric" value={filters.ageMin ?? ''} onChange={(e) => setFilter('ageMin', e.target.value ? Number(e.target.value.replace(/\D/g, '').slice(0, 2)) : null)} placeholder="From" className={`${fieldClass} h-11`} />
                <span className="text-subtle" aria-hidden="true">–</span>
                <input aria-label="Oldest age" inputMode="numeric" value={filters.ageMax ?? ''} onChange={(e) => setFilter('ageMax', e.target.value ? Number(e.target.value.replace(/\D/g, '').slice(0, 2)) : null)} placeholder="To" className={`${fieldClass} h-11`} />
              </div>
              <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">Only posts that show an age can match.</p>
            </div>
            <div>
              <label htmlFor="lf-filter-region" className="block text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg mb-1.5">Location</label>
              <select id="lf-filter-region" value={filters.region ?? ''} onChange={(e) => setFilter('region', e.target.value || null)} className={`${fieldClass} h-11`}>
                <option value="">Anywhere</option>
                {PHILIPPINE_REGIONS_AND_LOCATIONS.map((group) => (
                  <optgroup key={group.region} label={group.region}>
                    {group.provincesAndCities.map((place) => <option key={place} value={place}>{place}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {tags.length > 0 && (
              <div>
                <p className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg mb-1.5">Interests</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button key={tag} type="button" aria-pressed={filters.tag?.toLowerCase() === tag.toLowerCase()} onClick={() => setFilter('tag', filters.tag?.toLowerCase() === tag.toLowerCase() ? null : tag)} className="chip">#{tag}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg mb-1.5">Mature posts</p>
              <div role="radiogroup" aria-label="Mature posts" className="grid grid-cols-2 gap-1 rounded-full border border-line bg-ink p-1">
                {([['any', 'Follow my setting'], ['hide', 'Leave out']] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={filters.mature === id} onClick={() => setFilter('mature', id)} className={`h-9 rounded-full text-[length:calc(13px_*_var(--fs,1))] font-semibold transition-colors cursor-pointer ${filters.mature === id ? 'bg-berry text-ink' : 'text-muted hover:text-fg'}`}>{label}</button>
                ))}
              </div>
              <p className="mt-1.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">Currently: {NSFW_PREFERENCE_OPTIONS.find((o) => o.id === nsfwPreference)?.label}. Change it in Settings.</p>
            </div>
          </div>
        </Sheet>
      )}

      {composer && (
        <LookingForComposer
          userPrefs={userPrefs}
          editing={composer.editing}
          ownPostIds={ownPostIds}
          uid={uid}
          onClose={() => setComposer(null)}
          onSaved={(edited) => {
            setComposer(null);
            setToast({ text: edited ? 'Your post was updated.' : 'Your post is live.', ok: true });
          }}
        />
      )}

      {requestPost && <ConnectionRequestSheet post={requestPost} onClose={() => setRequestPost(null)} onViewRequests={onViewRequests} />}
      {reportPost && <ReportSheet post={reportPost} onClose={() => setReportPost(null)} onDone={(ok) => { setReportPost(null); setToast(ok ? { text: 'Thanks. Our safety team will review this post.', ok: true } : { text: 'Couldn’t send your report. Please try again.', ok: false }); }} />}

      {confirmReveal && (
        <ConfirmDialog
          title="Show sensitive content?"
          message={confirmReveal.contentWarning ? `The author added a warning: “${confirmReveal.contentWarning}”. This post is marked NSFW. Only continue if you are comfortable.` : 'This post is marked NSFW and may contain mature themes. Only continue if you are comfortable.'}
          confirmLabel="Show this post"
          cancelLabel="Keep it hidden"
          onCancel={() => setConfirmReveal(null)}
          onConfirm={() => { setRevealed((prev) => new Set(prev).add(confirmReveal.id)); setConfirmReveal(null); }}
        />
      )}
      {deletePost && (
        <ConfirmDialog title="Delete this post?" message="Your post will be removed for everyone. This can’t be undone." confirmLabel={busy ? 'Deleting…' : 'Delete post'} tone="danger" busy={busy} onConfirm={doDelete} onCancel={() => { if (!busy) setDeletePost(null); }} />
      )}
      {blockPost && onBlockMember && (
        <ConfirmDialog
          title={`Block ${blockPost.author}?`}
          message="You won’t see their posts, and they won’t be able to send you a Signal."
          confirmLabel="Block"
          tone="danger"
          onConfirm={() => { onBlockMember(blockPost.authorId); setBlockPost(null); }}
          onCancel={() => setBlockPost(null)}
        />
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-start gap-2.5 bg-raised/95 backdrop-blur-xl text-fg px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 border border-line text-sm anim-pop">
          <CheckCircle2 className={`w-[18px] h-[18px] shrink-0 mt-px ${toast.ok ? 'text-berry' : 'text-danger'}`} />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};

const ReportSheet: React.FC<{ post: LookingForPost; onClose: () => void; onDone: (ok: boolean) => void }> = ({ post, onClose, onDone }) => {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [sending, setSending] = useState(false);
  return (
    <Sheet
      title="Report this post"
      size="sm"
      onClose={() => { if (!sending) onClose(); }}
      footer={
        <button
          type="button"
          disabled={sending}
          onClick={async () => { setSending(true); const ok = await reportLookingForPost(post.id, reason); setSending(false); onDone(ok); }}
          className="btn btn-primary w-full"
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
      }
    >
      <div role="radiogroup" aria-label="Reason" className="space-y-1.5">
        {REPORT_REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`flex w-full items-center gap-3 min-h-11 rounded-xl border px-3 text-left text-sm transition-colors cursor-pointer ${reason === r ? 'border-berry bg-raised text-fg' : 'border-line text-muted hover:text-fg'}`}>
            <span className={`h-4 w-4 shrink-0 rounded-full border ${reason === r ? 'border-berry bg-berry' : 'border-line-strong'}`} aria-hidden="true" />
            {r}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">Reports go to our safety team. They are never shown to the author.</p>
    </Sheet>
  );
};
