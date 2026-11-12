import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Flag, LoaderCircle, MapPin, MessageCircle, Pencil, SatelliteDish, Share2, Sparkles, UserX } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ProfileSkeleton } from './Skeleton.tsx';
import { ConfirmDialog } from './Sheet.tsx';
import { CurrentVibeCard, CurrentVibeSheet, SetVibePrompt } from './CurrentVibe.tsx';
import { useMinuteClock } from '../hooks/useMemberVibe.ts';
import { removeCurrentVibe, vibeProblemText } from '../services/currentVibeService.ts';
import { isLive, type VibeView } from '../utils/currentVibe.ts';
import { ConnectionRequestSheet } from './ConnectionRequestSheet.tsx';
import { ReportMemberSheet } from './ReportMemberSheet.tsx';
import { ProfileLookingFor, ProfilePosts, Section } from './ProfileSections.tsx';
import type { UserPreferences } from '../types.ts';
import { fetchStardustTotal } from '../services/stardustService.ts';
import { calculateAge } from '../utils/ageEligibility.ts';
import { INTENTION_LABELS } from '../utils/matching-logic.ts';
import type { LookingForPost } from '../utils/lookingFor.ts';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';
import {
  aboutDetails,
  formatMemberSince,
  identityLine,
  ownerVisibility,
  profileAction,
  profileCover,
  visibleLookingForPosts,
  type ProfileAction,
  type ProfileResponse,
} from '../utils/profileView.ts';
import {
  clearProfileCache,
  fetchMemberAge,
  fetchMemberLookingForPosts,
  fetchMemberProfile,
  peekMemberProfile,
  prefetchMemberPosts,
  shareMemberProfile,
  type ProfileLoad,
} from '../services/profileViewService.ts';

interface Props {
  memberId: string;
  selfId: string | null;
  /** The signed-in member's own saved details, used only on their own page. */
  userPrefs: UserPreferences;
  nsfwPreference: NsfwPreference;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenRequests: () => void;
  onEditProfile: () => void;
  onBlockMember: (memberId: string) => void;
  onOpenSettings: () => void;
}

const RETRYABLE_REASONS: string[] = ['failed', 'rate_limited', 'unsupported'];

const failureTitle = (reason: string): string =>
  reason === 'unavailable' ? 'This profile isn’t available'
    : reason === 'forbidden' ? 'Profiles are for adult members'
      : reason === 'rate_limited' ? 'You’re opening profiles quickly'
        : reason === 'unsupported' ? 'Profiles aren’t ready yet'
          : 'Couldn’t open this profile';

const failureHint = (reason: string): string =>
  reason === 'unavailable' || reason === 'forbidden' ? 'It may have been removed, or it isn’t shared with you.'
    : reason === 'rate_limited' ? 'Wait a moment, then try again.'
      : reason === 'unsupported' ? 'QUEERSPACE is updating. Refresh the page in a moment and try again.'
        : 'Check your connection and try again.';

const intentionLabel = (value: string | null): string | null => (value ? (INTENTION_LABELS as Record<string, string>)[value] ?? null : null);

/**
 * A member's profile as a full-screen page. Everything shown was decided by the server (what they chose to share, and whether
 * you may see them at all); the only way to start contact from here is the existing connection-request flow, about one of
 * their live Looking For posts. The owner sees the same page with their own controls instead of connection actions.
 */
export const ProfilePage: React.FC<Props> = ({
  memberId, selfId, userPrefs, nsfwPreference, onClose, onOpenConversation, onOpenRequests, onEditProfile, onBlockMember, onOpenSettings,
}) => {
  // A profile seen in the last minute opens at once, with no skeleton and no request.
  const [load, setLoad] = useState<ProfileLoad | null>(() => {
    const hit = peekMemberProfile(memberId);
    return hit ? { ok: true, data: hit } : null;
  });
  /** Which load is current, so an answer for a profile the member has already left can never land on this one. */
  const runId = useRef(0);
  const [age, setAge] = useState<number | null>(null);
  const [stardustTotal, setStardustTotal] = useState<number | null>(null);
  const [lookingFor, setLookingFor] = useState<LookingForPost[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [requestPost, setRequestPost] = useState<LookingForPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Current Vibe: what the member just published or removed (undefined = use what the profile answer says), and its editor.
  const [vibeOverride, setVibeOverride] = useState<VibeView | null | undefined>(undefined);
  const [editingVibe, setEditingVibe] = useState(false);
  const [removingVibe, setRemovingVibe] = useState(false);
  const clock = useMinuteClock();

  const overlayOpen = reporting || blocking || requestPost !== null || editingVibe;

  const run = useCallback(async (force = false) => {
    const id = ++runId.current;
    if (force) clearProfileCache(memberId);
    const cached = force ? null : peekMemberProfile(memberId);
    if (!cached) setLoad(null);
    setAge(null);
    setLookingFor([]);
    setVibeOverride(undefined);
    // The posts do not wait for the profile: their reads start now, alongside it. Nothing from them is shown until the
    // server has said this viewer may see the profile (a blocked or unavailable profile discards them).
    prefetchMemberPosts(memberId);
    const lookingForRead = fetchMemberLookingForPosts(memberId);
    const result: ProfileLoad = cached ? { ok: true, data: cached } : await fetchMemberProfile(memberId, force);
    if (id !== runId.current) return;
    setLoad(result);
    if (!result.ok || !result.data.member) return;
    const { data } = result;
    void lookingForRead.then((posts) => { if (id === runId.current) setLookingFor(posts ?? []); });
    if (data.self) {
      setAge(userPrefs.showAgeOnProfile && userPrefs.birthDate ? calculateAge(userPrefs.birthDate) : null);
    } else if (data.member?.showsAge && data.relation.state === 'connected') {
      void fetchMemberAge(memberId).then((value) => { if (id === runId.current) setAge(value); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOpen) return;
      if (menuOpen) setMenuOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, overlayOpen, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const data: ProfileResponse | null = load?.ok ? load.data : null;
  // The server says whether this is the member's own page; the id comparison only covers the moment before it answers.
  const isSelf = data?.self ?? (selfId !== null && memberId === selfId);
  const member = data?.member ?? null;
  const posts = useMemo(() => visibleLookingForPosts(lookingFor, isSelf), [lookingFor, isSelf]);
  // The member's one Stardust total (Community and Looking For together): a single small document, read only when a profile is shown.
  const hasMember = member !== null;
  useEffect(() => {
    setStardustTotal(null);
    if (!hasMember) return;
    let live = true;
    void fetchStardustTotal(memberId).then((total) => { if (live) setStardustTotal(total); });
    return () => { live = false; };
  }, [memberId, hasMember]);
  // The action sees every post (so it can tell "all paused" from "none"); the list below shows only the live ones.
  const action: ProfileAction = data ? profileAction(data, lookingFor) : { kind: 'none' };
  const name = member?.displayName || 'Anonymous member';
  const cover = profileCover(member?.avatar, memberId);
  const joined = formatMemberSince(member?.memberSince);
  const details = member ? aboutDetails(member, intentionLabel(member.intention)) : [];
  const line = member ? identityLine(member, age) : '';
  const showBar = !isSelf && data !== null && action.kind !== 'none';
  // The status shown: always one that has not expired (the server already drops expired ones; this keeps an open page honest).
  const shownVibe = (vibeOverride !== undefined ? vibeOverride : data?.currentVibe ?? null);
  const vibe = isLive(shownVibe, clock) ? shownVibe : null;

  const removeVibe = async () => {
    if (removingVibe) return;
    setRemovingVibe(true);
    const result = await removeCurrentVibe();
    setRemovingVibe(false);
    if (result.ok) { clearProfileCache(memberId); setVibeOverride(null); setToast('Current Vibe removed.'); }
    else setToast(vibeProblemText(result.reason));
  };

  const share = async () => {
    const result = await shareMemberProfile(memberId, name);
    if (result === 'copied') setToast('Link copied.');
    else if (result === 'failed') setToast('Couldn’t share that. Please try again.');
  };

  const roundButton = 'flex h-10 w-10 items-center justify-center rounded-full border border-line bg-ink/70 text-fg backdrop-blur transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 cursor-pointer';

  return (
    <div role="dialog" aria-modal="true" aria-label={member ? `${name}’s profile` : 'Profile'} className="fixed inset-0 z-[45] flex flex-col bg-ink">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={onClose} aria-label="Back" className={roundButton} autoFocus><ArrowLeft className="h-5 w-5" /></button>
        {member && !isSelf && (
          <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} className={roundButton}>
              <span aria-hidden="true" className="text-lg leading-none">⋯</span>
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-11 z-20 min-w-40 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-lg shadow-black/40">
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setReporting(true); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-fg hover:bg-surface/70"><Flag className="h-4 w-4" /> Report</button>
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setBlocking(true); }} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm text-danger hover:bg-surface/70"><UserX className="h-4 w-4" /> Block</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl md:max-w-2xl pb-[calc(env(safe-area-inset-bottom)+7.5rem)]">
          <div className="h-28 w-full sm:mt-4 sm:h-40 sm:overflow-hidden sm:rounded-3xl" style={{ backgroundImage: cover }} aria-hidden="true" />

          {load === null ? (
            <ProfileSkeleton />
          ) : !load.ok ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[length:calc(16px_*_var(--fs,1))] font-semibold text-fg">{failureTitle(load.reason)}</p>
              <p className="mt-1 text-sm text-muted">{failureHint(load.reason)}</p>
              <div className="mt-5 flex justify-center gap-2">
                {RETRYABLE_REASONS.includes(load.reason) && <button type="button" onClick={() => void run(true)} className="btn btn-primary btn-sm">Try again</button>}
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Back</button>
              </div>
            </div>
          ) : data?.blocked === 'by_me' ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[length:calc(16px_*_var(--fs,1))] font-semibold text-fg">You blocked this member</p>
              <p className="mt-1 text-sm text-muted">You won’t see their profile or posts, and they can’t contact you.</p>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm mt-5">Back</button>
            </div>
          ) : member ? (
            <div className="px-4 sm:px-6">
              <div className="-mt-10 flex items-end justify-between gap-3">
                <AnimalAvatar avatar={member.avatar ?? undefined} seed={memberId} className="h-20 w-20 shrink-0 ring-4 ring-ink shadow-lg shadow-black/30" />
                {isSelf && (
                  <div className="flex items-center gap-2 pb-1">
                    <button type="button" onClick={onEditProfile} className="btn btn-primary btn-sm"><Pencil className="h-4 w-4" /> Edit profile</button>
                    <button type="button" onClick={() => void share()} aria-label="Share profile" title="Share profile" className="btn btn-secondary btn-sm !px-3"><Share2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <h1 className="mt-3 text-[length:calc(24px_*_var(--fs,1))] font-semibold leading-tight tracking-tight text-fg [overflow-wrap:anywhere]">{name}</h1>
              {(line || member.location) && (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:calc(14px_*_var(--fs,1))] text-muted">
                  {line && <span>{line}</span>}
                  {line && member.location && <span aria-hidden="true" className="text-line-strong">·</span>}
                  {member.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {member.location}</span>}
                </p>
              )}
              {member.about && <p className="mt-3 whitespace-pre-wrap text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-fg [overflow-wrap:anywhere]">{member.about}</p>}

              {(joined || stardustTotal !== null) && (
                // Member since and the Stardust earned share one small line (they wrap on a narrow screen).
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:calc(12px_*_var(--fs,1))] text-subtle">
                  {joined && (
                    <span title={`Member since ${joined.since}`}>
                      <span aria-hidden="true">✦ </span>Member since {joined.since}<span aria-hidden="true"> · </span><span className="sr-only">, </span>{joined.duration.replace('Member for ', '')}
                    </span>
                  )}
                  {joined && stardustTotal !== null && <span aria-hidden="true" className="text-line-strong">·</span>}
                  {stardustTotal !== null && (
                    <span className="inline-flex items-center gap-1 text-lavender" aria-label={`${stardustTotal} Stardust earned`}>
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      <span className="tabular-nums font-semibold">{stardustTotal}</span> Stardust
                    </span>
                  )}
                </p>
              )}

              {/* Current Vibe: a card when there is a live status; on the member's own page, a quiet prompt when there is none. Never an empty card, and nothing at all on someone else's page without one. */}
              {(vibe || isSelf) && (
                <div className="mt-4">
                  {vibe
                    ? <CurrentVibeCard vibe={vibe} self={isSelf} onEdit={() => setEditingVibe(true)} onRemove={() => void removeVibe()} removing={removingVibe} />
                    : <SetVibePrompt onClick={() => setEditingVibe(true)} />}
                </div>
              )}

              {isSelf && (
                <div className="mt-4">
                  <div className="rounded-2xl border border-line bg-raised/50 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">What others can see</p>
                      <button type="button" onClick={onEditProfile} className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-berry underline underline-offset-4">Change</button>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {ownerVisibility(userPrefs).map((row) => (
                        <li key={row.label} className="flex items-center justify-between gap-3 text-[length:calc(14px_*_var(--fs,1))]">
                          <span className="text-fg">{row.label}</span>
                          <span className={`inline-flex items-center gap-1 ${row.shown ? 'text-lavender' : 'text-subtle'}`}>{row.shown && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{row.hint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {details.length > 0 && (
                <Section title="About">
                  <dl className="divide-y divide-line/60 rounded-2xl border border-line bg-raised/50">
                    {details.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
                        <dt className="text-[length:calc(13px_*_var(--fs,1))] text-subtle">{row.label}</dt>
                        <dd className="text-right text-[length:calc(14px_*_var(--fs,1))] text-fg [overflow-wrap:anywhere]">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}

              {member.interests.length > 0 && (
                <Section title="Interests">
                  <div className="flex flex-wrap gap-1.5">
                    {member.interests.map((interest) => <span key={interest} className="tag">#{interest}</span>)}
                  </div>
                </Section>
              )}

              <ProfilePosts memberId={memberId} />
              <ProfileLookingFor posts={posts} isSelf={isSelf} nsfwPreference={nsfwPreference} onOpenSettings={onOpenSettings} onRequest={setRequestPost} />
            </div>
          ) : (
            // Not reachable for a validated answer, but a profile page must never be blank: say so and offer a way out.
            <div className="px-6 py-14 text-center">
              <p className="text-[length:calc(16px_*_var(--fs,1))] font-semibold text-fg">Couldn’t open this profile</p>
              <p className="mt-1 text-sm text-muted">Something unexpected came back. Please try again.</p>
              <div className="mt-5 flex justify-center gap-2">
                <button type="button" onClick={() => void run(true)} className="btn btn-primary btn-sm">Try again</button>
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showBar && (
        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-ink/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-xl">
            {action.kind === 'request' && <button type="button" onClick={() => setRequestPost(action.post)} aria-label="Send connection signal" className="btn btn-primary w-full"><SatelliteDish className="h-4 w-4" aria-hidden="true" /> Send Signal</button>}
            {action.kind === 'open_conversation' && <button type="button" onClick={() => onOpenConversation(action.conversationId)} className="btn btn-primary w-full"><MessageCircle className="h-4 w-4" /> Open conversation</button>}
            {action.kind === 'respond' && <button type="button" onClick={onOpenRequests} className="btn btn-primary w-full">Respond to their request</button>}
            {action.kind === 'pending' && (
              <>
                <button type="button" disabled className="btn btn-secondary w-full">Request pending</button>
                <button type="button" onClick={onOpenRequests} className="mt-1.5 w-full text-center text-[length:calc(13px_*_var(--fs,1))] font-semibold text-berry underline underline-offset-4">View in Requests</button>
              </>
            )}
            {action.kind === 'paused' && <button type="button" disabled className="btn btn-secondary w-full">Requests paused</button>}
            {action.kind === 'declined' && <button type="button" disabled className="btn btn-secondary w-full">Request declined</button>}
            {action.kind === 'unavailable' && <p className="py-2 text-center text-[length:calc(13px_*_var(--fs,1))] text-subtle">Not taking connection requests right now.</p>}
          </div>
        </div>
      )}

      {editingVibe && isSelf && (
        <CurrentVibeSheet
          existing={vibe}
          onClose={() => setEditingVibe(false)}
          onPublished={(published) => { clearProfileCache(memberId); setVibeOverride(published); setEditingVibe(false); setToast('Current Vibe updated.'); }}
        />
      )}
      {requestPost && <ConnectionRequestSheet post={requestPost} onClose={() => { setRequestPost(null); clearProfileCache(memberId); void run(true); }} onViewRequests={onOpenRequests} />}
      {reporting && (
        <ReportMemberSheet
          memberId={memberId}
          context="Profile"
          onClose={() => setReporting(false)}
          onDone={(ok) => { setReporting(false); setToast(ok ? 'Thanks. Our safety team will review this.' : 'Couldn’t send your report. Please try again.'); }}
        />
      )}
      {blocking && (
        <ConfirmDialog
          title={`Block ${name}?`}
          message="You won’t see their profile or posts, and they won’t be able to contact you."
          confirmLabel="Block"
          tone="danger"
          onConfirm={() => { clearProfileCache(memberId); setBlocking(false); onBlockMember(memberId); onClose(); }}
          onCancel={() => setBlocking(false)}
        />
      )}
      {toast && <div role="status" aria-live="polite" className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-line bg-raised/95 px-4 py-3 text-sm text-fg shadow-2xl shadow-black/50 backdrop-blur-xl anim-pop">{toast}</div>}
    </div>
  );
};
