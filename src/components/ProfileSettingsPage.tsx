import React, { useState } from 'react';
import { ArrowLeft, Cake, Check, ChevronRight, Compass, Eye, KeyRound, LifeBuoy, Palette, Sparkles, SquarePen, SunMoon, UserRound } from 'lucide-react';
import { AnimalAvatar } from './AnimalAvatar.tsx';
import { BackgroundStudio } from './BackgroundStudio.tsx';
import { BirthdayCorrectionSheet } from './BirthdayCorrectionSheet.tsx';
import { CosmicBackground } from './CosmicBackground.tsx';
import { auth } from '../lib/firebase.ts';
import { useBackgroundImage } from '../hooks/useBackgroundImage.ts';
import type { UserPreferences } from '../types.ts';
import { describeBackground, type ProfileBackground } from '../utils/profileBackground.ts';
import { ownerVisibility } from '../utils/profileView.ts';

export type SettingsSection = 'profile' | 'appearance' | 'privacy' | 'account';

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <UserRound className="h-[18px] w-[18px]" aria-hidden="true" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-[18px] w-[18px]" aria-hidden="true" /> },
  { id: 'privacy', label: 'Privacy & visibility', icon: <Eye className="h-[18px] w-[18px]" aria-hidden="true" /> },
  { id: 'account', label: 'Account', icon: <KeyRound className="h-[18px] w-[18px]" aria-hidden="true" /> },
];

interface Props {
  userPrefs: UserPreferences;
  /** Opens the existing profile editor (name, pronouns, about, vibe, style, avatar, and what is shown). */
  onEditProfile: () => void;
  /** Opens the existing discovery preferences (My Type). */
  onEditPreferences: () => void;
  /** Saves a new profile background (null = the default look) with the same profile save the rest of the app uses. */
  onSaveBackground: (background: ProfileBackground | null) => void | Promise<void>;
  /** Opens the existing theme and text size settings. */
  onOpenAppAppearance: () => void;
  onOpenSupport: () => void;
  onClose: () => void;
}

/** A tappable row: icon, title, a short line of what it holds, and a chevron. */
const Row: React.FC<{ icon: React.ReactNode; title: string; hint?: React.ReactNode; onClick: () => void; badge?: boolean; testId?: string }> = ({ icon, title, hint, onClick, badge, testId }) => (
  <button type="button" onClick={onClick} data-testid={testId} className="flex min-h-[3.5rem] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-raised/80 focus-visible:bg-raised/80 focus-visible:outline-none">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-plum/25 text-lavender">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">{title}</span>
      {hint && <span className="mt-px block truncate text-[length:calc(12.5px_*_var(--fs,1))] text-muted">{hint}</span>}
    </span>
    {badge && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-berry"><span className="sr-only">New</span></span>}
    <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
  </button>
);

/** A titled group of rows (one rounded surface, thin dividers) so settings read as a list, not a pile of cards. */
const Group: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    {title && <h3 className="mb-1.5 px-1 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">{title}</h3>}
    <div className="overflow-hidden rounded-2xl border border-line bg-raised/40 divide-y divide-line/60">{children}</div>
  </div>
);

/** The member's current background as it will look: the real scene (or still image), small. */
const BackgroundPreview: React.FC<{ background: ProfileBackground | null; memberId: string | null }> = ({ background, memberId }) => {
  const imageUrl = useBackgroundImage(memberId, background);
  return (
    <div data-testid="background-preview" className="relative h-28 overflow-hidden rounded-xl border border-line bg-surface sm:h-32">
      {background
        ? <CosmicBackground background={background} imageUrl={imageUrl} />
        : <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-plum/45 via-surface to-ink" />}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-0.5 text-[length:calc(11.5px_*_var(--fs,1))] font-medium text-white backdrop-blur-sm">{describeBackground(background)}</span>
    </div>
  );
};

/**
 * Profile settings: one organised place for everything about the member's own profile, in four groups. It only gathers what already
 * exists (the profile editor, the background studio, the visibility switches, the app appearance, account saving, support): each
 * row opens or reuses the existing control, so nothing is duplicated and nothing here is a dead option.
 *
 * Phones: one full-screen page with a back arrow and the groups stacked as compact rows. Larger screens: a grouped navigation on
 * the left and one group at a time on the right.
 */
export const ProfileSettingsPage: React.FC<Props> = ({
  userPrefs,
  onEditProfile, onEditPreferences, onSaveBackground, onOpenAppAppearance, onOpenSupport, onClose,
}) => {
  const [section, setSection] = useState<SettingsSection>('profile');
  const [studioOpen, setStudioOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const memberId = auth?.currentUser?.uid ?? null;
  const background = userPrefs.background ?? null;
  const visibility = ownerVisibility(userPrefs);
  const name = userPrefs.displayName || 'Anonymous member';
  // Larger screens show one group at a time; phones show every group in one scroll.
  const panel = (id: SettingsSection) => (section === id ? 'block' : 'hidden max-md:block');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" data-testid="profile-settings" className="fixed inset-0 z-[48] flex flex-col bg-ink text-fg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line/70 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-6">
        <button type="button" onClick={onClose} aria-label="Back to profile" autoFocus className="flex h-10 w-10 items-center justify-center rounded-full text-fg transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60"><ArrowLeft className="h-5 w-5" /></button>
        <h1 id="profile-settings-title" className="text-[length:calc(18px_*_var(--fs,1))] font-semibold tracking-tight">Profile settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-4xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-8 md:px-6 md:pt-6">
          <nav aria-label="Settings categories" className="hidden md:block">
            <ul className="sticky top-0 space-y-1">
              {SETTINGS_SECTIONS.map(({ id, label, icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={section === id ? 'page' : undefined}
                    onClick={() => setSection(id)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[length:calc(14px_*_var(--fs,1))] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berry/60 ${section === id ? 'bg-raised text-fg ring-1 ring-berry/40' : 'text-muted hover:bg-raised/60 hover:text-fg'}`}
                  >
                    <span className={section === id ? 'text-berry' : 'text-subtle'}>{icon}</span>
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-7">
            <section aria-labelledby="settings-profile" className={panel('profile')} data-testid="settings-profile">
              <h2 id="settings-profile" className="mb-2 px-1 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg md:text-[length:calc(16px_*_var(--fs,1))]">Profile</h2>
              <Group>
                <Row icon={<SquarePen className="h-[18px] w-[18px]" aria-hidden="true" />} title="Edit profile" hint={[name, userPrefs.pronouns].filter(Boolean).join(' · ')} onClick={onEditProfile} testId="row-edit-profile" />
                <button type="button" onClick={onEditProfile} data-testid="row-avatar" className="flex min-h-[3.5rem] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-raised/80 focus-visible:bg-raised/80 focus-visible:outline-none">
                  <AnimalAvatar avatar={userPrefs.avatar} seed={name} className="h-9 w-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">Avatar</span>
                    <span className="mt-px block truncate text-[length:calc(12.5px_*_var(--fs,1))] text-muted">Your anonymous avatar. No photos needed.</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                </button>
                <Row icon={<Compass className="h-[18px] w-[18px]" aria-hidden="true" />} title="Discovery preferences" hint="Who you’d like to meet. Only you see these." onClick={onEditPreferences} testId="row-discovery" />
              </Group>
            </section>

            <section aria-labelledby="settings-appearance" className={panel('appearance')} data-testid="settings-appearance">
              <h2 id="settings-appearance" className="mb-2 px-1 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg md:text-[length:calc(16px_*_var(--fs,1))]">Appearance</h2>
              <div className="space-y-3">
                <div className="rounded-2xl border border-line bg-raised/40 p-3">
                  <div className="mb-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[length:calc(15px_*_var(--fs,1))] font-medium text-fg">Profile background</p>
                      <p className="mt-px text-[length:calc(12.5px_*_var(--fs,1))] text-muted">
                        {background
                          ? background.kind === 'image' ? 'Your own picture, always still.' : background.animate ? 'An animated galaxy behind your whole profile.' : 'A galaxy, shown as a still frame.'
                          : 'Pick an animated galaxy or your own picture. Free for everyone.'}
                      </p>
                    </div>
                  </div>
                  <BackgroundPreview background={background} memberId={memberId} />
                  <button type="button" onClick={() => setStudioOpen(true)} data-testid="customize-background" className="btn btn-primary btn-sm mt-3 w-full sm:w-auto"><Sparkles className="h-4 w-4" aria-hidden="true" /> {background ? 'Customize background' : 'Choose a background'}</button>
                </div>
                <Group>
                  <Row icon={<SunMoon className="h-[18px] w-[18px]" aria-hidden="true" />} title="Theme and text size" hint="Dark or light, and how large text reads" onClick={onOpenAppAppearance} testId="row-app-appearance" />
                </Group>
              </div>
            </section>

            <section aria-labelledby="settings-privacy" className={panel('privacy')} data-testid="settings-privacy">
              <h2 id="settings-privacy" className="mb-2 px-1 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg md:text-[length:calc(16px_*_var(--fs,1))]">Privacy &amp; visibility</h2>
              <div className="space-y-3">
                <div className="rounded-2xl border border-line bg-raised/40 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.14em] text-subtle">What others can see</p>
                    <button type="button" onClick={onEditProfile} className="text-[length:calc(13px_*_var(--fs,1))] font-semibold text-berry underline underline-offset-4">Change</button>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {visibility.map((row) => (
                      <li key={row.label} className="flex items-center justify-between gap-3 text-[length:calc(14px_*_var(--fs,1))]">
                        <span className="text-fg">{row.label}</span>
                        <span className={`inline-flex items-center gap-1 text-right ${row.shown ? 'text-lavender' : 'text-subtle'}`}>{row.shown && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{row.hint}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-xs text-subtle">Your birthday and exact location are never shown. Each field above is switched on or off in Edit profile.</p>
                </div>
              </div>
            </section>

            <section aria-labelledby="settings-account" className={panel('account')} data-testid="settings-account">
              <h2 id="settings-account" className="mb-2 px-1 text-[length:calc(13px_*_var(--fs,1))] font-semibold text-fg md:text-[length:calc(16px_*_var(--fs,1))]">Account</h2>
              <Group>
                {userPrefs.birthDate && <Row icon={<Cake className="h-[18px] w-[18px]" aria-hidden="true" />} title="Correct my birthday" hint="Reviewed by the team. Never shown to others." onClick={() => setCorrecting(true)} testId="row-birthday" />}
                <Row icon={<LifeBuoy className="h-[18px] w-[18px]" aria-hidden="true" />} title="Help and support" hint="Talk to the team" onClick={onOpenSupport} testId="row-support" />
              </Group>
            </section>
          </div>
        </div>
      </div>

      {studioOpen && (
        <BackgroundStudio
          initial={background}
          displayName={name}
          avatar={userPrefs.avatar}
          aboutMe={userPrefs.aboutMe}
          onClose={() => setStudioOpen(false)}
          onApply={(next) => { setStudioOpen(false); void onSaveBackground(next); }}
        />
      )}
      {correcting && <BirthdayCorrectionSheet onClose={() => setCorrecting(false)} />}
    </div>
  );
};
