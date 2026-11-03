import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Flag, LoaderCircle, MapPin, MessageCircle, Pencil, Share2, UserPlus, UserX } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { ConfirmDialog } from './Sheet.tsx';
import { ConnectionRequestSheet } from './ConnectionRequestSheet.tsx';
import { ReportMemberSheet } from './ReportMemberSheet.tsx';
import { ProfileLookingFor, ProfilePosts, Section } from './ProfileSections.tsx';
import type { UserPreferences } from '../types.ts';
import { calculateAge } from '../utils/ageEligibility.ts';
import { INTENTION_LABELS } from '../utils/matching-logic.ts';
import type { LookingForPost } from '../utils/lookingFor.ts';
import type { NsfwPreference } from '../utils/nsfwPreference.ts';
import {
  aboutDetails,
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
  const [load, setLoad] = useState<ProfileLoad | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const [lookingFor, setLookingFor] = useState<LookingForPost[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [requestPost, setRequestPost] = useState<LookingForPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const overlayOpen = reporting || blocking || requestPost !== null;

  const run = useCallback(async (force = false) => {
    setLoad(null);
    setAge(null);
    setLookingFor([]);
    const result = await fetchMemberProfile(memberId, force);
    setLoad(result);
    if (!result.ok || !result.data.member) return;
    const { data } = result;
    void fetchMemberLookingForPosts(memberId).then((posts) => setLookingFor(posts ?? []));
    if (data.self) {
      setAge(userPrefs.showAgeOnProfile && userPrefs.birthDate ? calculateAge(userPrefs.birthDate) : null);
    } else if (data.member?.showsAge && data.relation.state === 'connected') {
      void fetchMemberAge(memberId).then(setAge);
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
  // The action sees every post (so it can tell "all paused" from "none"); the list below shows only the live ones.
  const action: ProfileAction = data ? profileAction(data, lookingFor) : { kind: 'none' };
  const name = member?.displayName || 'Anonymous member';
  const cover = profileCover(member?.avatar, memberId);
  const details = member ? aboutDetails(member, intentionLabel(member.intention)) : [];
  const line = member ? identityLine(member, age) : '';
  const showBar = !isSelf && data !== null && action.kind !== 'none';

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
        <div className="mx-auto w-full max-w-xl pb-[calc(env(safe-area-inset-bottom)+7.5rem)]">
          <div className="h-36 w-full sm:mt-4 sm:h-44 sm:overflow-hidden sm:rounded-3xl" style={{ backgroundImage: cover }} aria-hidden="true" />

          {load === null ? (
            <div className="flex min-h-48 items-center justify-center gap-2 px-6 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin text-berry" /> Opening profile…</div>
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
              <AnimalAvatar avatar={member.avatar ?? undefined} seed={memberId} className="-mt-12 h-24 w-24 ring-4 ring-ink" />
              <h1 className="mt-3 text-[length:calc(26px_*_var(--fs,1))] font-semibold leading-tight tracking-tight text-fg [overflow-wrap:anywhere]">{name}</h1>
              {(line || member.location) && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:calc(14px_*_var(--fs,1))] text-muted">
                  {line && <span>{line}</span>}
                  {member.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {member.location}</span>}
                </p>
              )}
              {member.about && <p className="mt-3 whitespace-pre-wrap text-[length:calc(15px_*_var(--fs,1))] leading-relaxed text-fg [overflow-wrap:anywhere]">{member.about}</p>}

              {isSelf && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={onEditProfile} className="btn btn-primary btn-sm"><Pencil className="h-4 w-4" /> Edit profile</button>
                    <button type="button" onClick={() => void share()} className="btn btn-secondary btn-sm"><Share2 className="h-4 w-4" /> Share profile</button>
                  </div>
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
            {action.kind === 'request' && <button type="button" onClick={() => setRequestPost(action.post)} className="btn btn-primary w-full"><UserPlus className="h-4 w-4" /> Send Connection Request</button>}
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
