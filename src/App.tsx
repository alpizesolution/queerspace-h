import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Header } from './components/Header.tsx';
import { Hero } from './components/Hero.tsx';
import { SafetySection } from './components/SafetySection.tsx';
import { Footer } from './components/Footer.tsx';
import { MatchSetupModal } from './components/MatchSetupModal.tsx';
import { SearchingState } from './components/SearchingState.tsx';
import { ChatView } from './components/ChatView.tsx';
import { PublicRoomView } from './components/PublicRoomView.tsx';
import { CommunityFeedView } from './components/CommunityFeedView.tsx';
import { UnsaidView } from './components/UnsaidView.tsx';
import { SignalsView, fetchNewestPendingSenderName, fetchPartnerName } from './components/SignalsView.tsx';
import { InfoModals } from './components/InfoModals.tsx';
import { DonationModal } from './components/DonationModal.tsx';
import { SupportChat } from './components/SupportChat.tsx';
import { FloatingCatsBackground } from './components/FloatingCatsBackground.tsx';
import { InstallPrompt } from './components/InstallPrompt.tsx';
import { PartnerProfile, UserPreferences } from './types.ts';
import { generateSapphicPseudonym } from './utils/matching-logic.ts';
import { reservePseudonym } from './services/pseudonymService.ts';
import { createNameGate } from './services/pseudonymGate.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from './utils/storage.ts';
import { auth, ensureAnonymousAuth, isFirebaseConfigured, logScreenView } from './lib/firebase.ts';
import { ProfilePage } from './components/ProfilePage.tsx';
import { ProfileNavProvider } from './components/ProfileNav.tsx';
import { isMemberId, profileIdFromSearch } from './utils/profileView.ts';
import { isPostId, postIdFromSearch } from './utils/communityPostLink.ts';
import { recordDailyActivity } from './services/activityService.ts';
import { executeHonestStorageWrite } from './utils/sync-feedback.ts';
import { saveAnonymousProfile, loadAnonymousProfile, cloudProfileSignature } from './services/profilePersistence.ts';
import { applyFilters, applyProfile, FilterFields, matchPrefsForMode, ProfileFields } from './utils/preferences.ts';
import { ProfileEditorSheet } from './components/ProfileEditorSheet.tsx';
import { ProfilePageSheet } from './components/ProfilePageSheet.tsx';
import { hasUnreadSupportReply } from './services/supportService.ts';
import { getMySuspension } from './services/suspensionService.ts';
import { SuspendedNotice } from './components/SuspendedNotice.tsx';
import { CheckCircle2, RadioTower } from 'lucide-react';
import { AgeEligibilityGate } from './components/AgeEligibilityGate.tsx';
import { calculateAge, isAdultBirthDate } from './utils/ageEligibility.ts';
import { submitAgeEligibilityReview, watchAgeReviewClearance } from './services/ageReviewService.ts';

import { AppearanceSettingsModal } from './components/AppearanceSettingsModal.tsx';
import { BottomNavigation, NavTarget } from './components/BottomNavigation.tsx';
import { FONT_SIZE_CHOSEN_KEY, FONT_SIZE_KEY, FontSize, isPhoneDevice, resolveFontSize } from './utils/fontSize.ts';
import { loadNsfwPreference, saveNsfwPreference, type NsfwPreference } from './utils/nsfwPreference.ts';
import { useSignalsInbox } from './hooks/useSignalsInbox.ts';
import { useEchoReplyNotices } from './hooks/useEchoReplyNotices.ts';
import { useUnreadUpdates } from './hooks/useUnreadUpdates.ts';
import { WhatsNewSheet } from './components/WhatsNewSheet.tsx';

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'searching' | 'chat' | 'public' | 'unsaid' | 'community' | 'signals'>(() =>
    /^\/signals\/?$/.test(window.location.pathname) ? 'signals' : 'home'
  );
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const { hasUnread: hasUnreadUpdates, refresh: refreshUnreadUpdates } = useUnreadUpdates();
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    getStorageItem('queerspace_theme') === 'light' ? 'light' : 'dark'
  );
  const [fontSize, setFontSize] = useState<FontSize>(() =>
    resolveFontSize(getStorageItem(FONT_SIZE_KEY), getStorageItem(FONT_SIZE_CHOSEN_KEY) === '1', isPhoneDevice())
  );
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [hasSupportReply, setHasSupportReply] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [setupInitialMode, setSetupInitialMode] = useState<'quick' | 'custom'>('quick');
  const [activePartner, setActivePartner] = useState<PartnerProfile | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [blockedPartnerIds, setBlockedPartnerIds] = useState<string[]>(() => {
    const saved = getStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, STORAGE_KEYS.BLOCKED_IDS.legacies);
    return saved ? JSON.parse(saved) : [];
  });

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  // Another member's (or the member's own) profile page, opened by tapping an avatar or a shared link.
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
  const profileOpenRef = useRef(false);
  profileOpenRef.current = profileMemberId !== null;
  // One Cosmos post shown on its own, opened from a member's profile or a shared link.
  const [focusPostId, setFocusPostId] = useState<string | null>(null);
  const openProfile = useCallback((memberId: string) => {
    if (!isMemberId(memberId)) return;
    // One history entry while a profile is open, so the phone's back gesture closes it instead of leaving the app. The entry
    // remembers which profile it is for, so coming back from a post lands on the same one.
    if (!profileOpenRef.current) window.history.pushState({ qsProfile: memberId }, '');
    else window.history.replaceState({ qsProfile: memberId }, '');
    setProfileMemberId(memberId);
  }, []);
  const closeProfile = useCallback(() => {
    if (window.history.state?.qsProfile) window.history.back();
    else setProfileMemberId(null);
  }, []);
  // Opens the original post in Cosmos. The profile's own history entry stays underneath, so Back returns to the profile.
  const openPost = useCallback((postId: string) => {
    if (!isPostId(postId)) return;
    window.history.pushState({ qsPost: postId }, '');
    setProfileMemberId(null);
    setFocusPostId(postId);
    setCurrentView('community');
    window.scrollTo({ top: 0 });
  }, []);
  const closePost = useCallback(() => {
    if (typeof window.history.state?.qsPost === 'string') window.history.back();
    else setFocusPostId(null);
  }, []);
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as { qsProfile?: unknown; qsPost?: unknown } | null;
      if (typeof state?.qsPost === 'string') {
        setProfileMemberId(null);
        setFocusPostId(state.qsPost);
        setCurrentView('community');
        return;
      }
      setFocusPostId(null);
      setProfileMemberId(typeof state?.qsProfile === 'string' && isMemberId(state.qsProfile) ? state.qsProfile : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A shared link (/?profile=id or /?post=id) opens that profile or post once, then the address goes back to normal.
  useEffect(() => {
    const id = profileIdFromSearch(window.location.search);
    const postId = postIdFromSearch(window.location.search);
    if (!id && !postId) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (postId) {
      setFocusPostId(postId);
      setCurrentView('community');
    } else {
      setProfileMemberId(id);
    }
  }, []);
  const profileNav = useMemo(() => ({ openProfile, openPost }), [openProfile, openPost]);
  // What the cloud last held, so saves that change nothing there skip Firestore entirely.
  const cloudSignatureRef = useRef<string | null>(null);
  /** True once the cloud holds this member's birthday (restored from it, or saved). It is never rewritten afterwards. */
  const cloudHasBirthDateRef = useRef(false);
  const [activeInfoModal, setActiveInfoModal] = useState<
    'about' | 'faq' | 'guidelines' | 'privacy' | 'terms' | 'contact' | null
  >(null);

  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return getStorageItem(STORAGE_KEYS.SOUND_MUTED.current, STORAGE_KEYS.SOUND_MUTED.legacies) === 'true';
  });

  const [nsfwPreference, setNsfwPreference] = useState<NsfwPreference>(loadNsfwPreference);
  const chooseNsfwPreference = (value: NsfwPreference) => {
    setNsfwPreference(value);
    saveNsfwPreference(value);
  };

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Live Signals: a one-time banner for each new incoming request while the app is open.
  const [signalAlert, setSignalAlert] = useState(false);
  const [signalSender, setSignalSender] = useState<string | null>(null);
  // A request this member sent was accepted: one banner per acceptance, and the connection to open from it.
  const [acceptedAlert, setAcceptedAlert] = useState<{ pairId: string; name: string | null } | null>(null);
  const [signalsOpenPairId, setSignalsOpenPairId] = useState<string | null>(null);
  // A new connection request: one generic banner (no name, no message), and where Signals should open.
  const [requestAlert, setRequestAlert] = useState(false);
  const [signalsStartSection, setSignalsStartSection] = useState<'inbox' | 'requests'>('inbox');
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;
  // Keep /signals in the address bar while the Signals inbox is open, and drop it when leaving.
  useEffect(() => {
    const onSignalsPath = /^\/signals\/?$/.test(window.location.pathname);
    if (currentView === 'signals' && !onSignalsPath) window.history.replaceState(null, '', '/signals');
    else if (currentView !== 'signals' && onSignalsPath) window.history.replaceState(null, '', '/');
  }, [currentView]);
  const signalsInbox = useSignalsInbox(
    () => {
      if (currentViewRef.current === 'signals') return;
      setSignalSender(null);
      setSignalAlert(true);
      // The API resolves the sender's public pseudonym; until then the banner stays generic.
      void fetchNewestPendingSenderName().then(setSignalSender);
    },
    (pairId) => {
      // On the Signals screen the notification card is already in view.
      if (currentViewRef.current === 'signals') return;
      setAcceptedAlert({ pairId, name: null });
      void fetchPartnerName(pairId).then((name) => setAcceptedAlert((current) => (current?.pairId === pairId ? { pairId, name } : current)));
    },
    () => {
      if (currentViewRef.current === 'signals') return;
      setRequestAlert(true);
    }
  );
  useEffect(() => {
    if (!requestAlert) return;
    const timer = window.setTimeout(() => setRequestAlert(false), 9000);
    return () => window.clearTimeout(timer);
  }, [requestAlert]);
  useEffect(() => {
    if (!acceptedAlert) return;
    const timer = window.setTimeout(() => setAcceptedAlert(null), 9000);
    return () => window.clearTimeout(timer);
  }, [acceptedAlert]);
  useEffect(() => {
    if (!signalAlert) return;
    const timer = window.setTimeout(() => setSignalAlert(false), 9000);
    return () => window.clearTimeout(timer);
  }, [signalAlert]);

  const [userPrefs, setUserPrefs] = useState<UserPreferences>(() => {
    const saved = getStorageItem(STORAGE_KEYS.USER_PREFS.current, STORAGE_KEYS.USER_PREFS.legacies);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    const initial = generateSapphicPseudonym();
    return {
      displayName: initial.name,
      pronouns: initial.pronouns,
      intention: 'open',
      topics: [],
      region: 'Anywhere / Worldwide',
    };
  });

  const [ageGateOpen, setAgeGateOpen] = useState(() => !isAdultBirthDate(userPrefs.birthDate));
  const [ageRestricted, setAgeRestricted] = useState(() => getStorageItem('queerspace_age_restricted') === 'true');
  const [ageReviewSubmitted, setAgeReviewSubmitted] = useState(() => getStorageItem('queerspace_age_review_requested') === 'true');

  // A locked member waits for the team: when an admin allows another try, the birthday form comes back (once).
  useEffect(() => {
    if (!ageRestricted) return;
    return watchAgeReviewClearance(() => {
      setAgeRestricted(false);
      setAgeReviewSubmitted(false);
      setStorageItem('queerspace_age_restricted', 'false');
      setStorageItem('queerspace_age_review_requested', 'false');
      setAgeGateOpen(true);
    });
  }, [ageRestricted]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content', theme === 'light' ? '#fbf9fc' : '#120b17'
    );
    setStorageItem('queerspace_theme', theme);
  }, [theme]);

  // Reading size applies at once through a root attribute (see --fs in index.css).
  useEffect(() => {
    document.documentElement.dataset.fontsize = fontSize;
  }, [fontSize]);

  // Only a size the person picks is remembered; until then it follows the device (Tiny on phones, Small elsewhere).
  const chooseFontSize = (size: FontSize) => {
    setFontSize(size);
    setStorageItem(FONT_SIZE_KEY, size);
    setStorageItem(FONT_SIZE_CHOSEN_KEY, '1');
  };

  // Initialize anonymous auth session on startup and restore cloud profile if available
  useEffect(() => {
    if (isFirebaseConfigured) {
      ensureAnonymousAuth()
        .then((user) => {
          if (user) {
            loadAnonymousProfile().then((res) => {
              if (!res.fromCloudSuccess) return;
              setUserPrefs(res.prefs);
              nameGate.markHeld(res.cloudDisplayName ?? null);
              setAgeGateOpen(!isAdultBirthDate(res.prefs.birthDate));
              setAgeRestricted(false);
              cloudSignatureRef.current = cloudProfileSignature(res.prefs, res.blockedPartnerIds ?? []);
              // A birthday that only lives on this device is sent with the next profile save; the cloud copy is never overwritten.
              cloudHasBirthDateRef.current = Boolean(res.cloudHasBirthDate);
              // Never shrink the blocklist: keep this device's blocks and add any saved in the cloud.
              const cloudBlocked = res.blockedPartnerIds ?? [];
              setBlockedPartnerIds((current) => {
                if (cloudBlocked.every((id) => current.includes(id))) return current;
                const merged = [...new Set([...current, ...cloudBlocked])];
                setStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, JSON.stringify(merged));
                return merged;
              });
            });
            getMySuspension().then((s) => setSuspended(Boolean(s)));
            hasUnreadSupportReply().then((unread) => {
              if (!unread) return;
              setHasSupportReply(true);
              showToast('The QUEERSPACE Team replied. Open "Chat with us" in the menu or footer.');
            });
          }
        })
        .catch((err) => {
          console.warn('Firebase anonymous auth setup notice:', err);
        });
    }
  }, []);

  const handleToggleSound = () => {
    setIsSoundMuted((prev) => {
      const next = !prev;
      setStorageItem(STORAGE_KEYS.SOUND_MUTED.current, String(next));
      return next;
    });
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Replies to the member's own Echoes (Need Advice and Uplift): a badge on the Echoes tab, a "new" tag on the post, and a toast.
  // Replies are anonymous, so the notice never says who. On the Echoes screen itself the post already shows it.
  const echoNotices = useEchoReplyNotices(isFirebaseConfigured && !ageGateOpen && !ageRestricted, (notice) => {
    if (notice.kind === 'new' && currentViewRef.current === 'unsaid') return;
    showToast(
      notice.kind === 'summary'
        ? `You have ${notice.count} new ${notice.count === 1 ? 'reply' : 'replies'} on your echoes.`
        : 'Someone replied to your echo.'
    );
  });

  const openSupport = () => {
    setActiveInfoModal(null);
    setHasSupportReply(false);
    setSupportOpen(true);
  };

  // The server decides who holds a name. Nothing carrying a name it has not confirmed is written to the cloud.
  const nameGate = useRef(createNameGate((name, options) => reservePseudonym(name, options))).current;

  /** Saves on this device, and to the cloud only when something the cloud stores has changed and the name is confirmed. */
  const persistPrefs = async (prefs: UserPreferences, options: { withBirthDate?: boolean; blocked?: string[] } = {}) => {
    const blocked = options.blocked ?? blockedPartnerIds;
    let toSave = prefs;
    let nameProblem: string | null = null;
    if (isFirebaseConfigured) {
      const check = await nameGate.ensure(prefs.displayName, prefs.profileComplete !== true);
      if (check.ok) {
        if (check.name !== prefs.displayName) { toSave = { ...prefs, displayName: check.name }; setUserPrefs(toSave); }
      } else {
        nameProblem = check.message;
      }
    }
    const signature = cloudProfileSignature(toSave, blocked);
    // The birthday is immutable once the cloud has it, so it is sent only until the cloud is known to hold it.
    const withBirthDate = Boolean(options.withBirthDate || (!cloudHasBirthDateRef.current && isAdultBirthDate(toSave.birthDate)));
    const cloudChanged = withBirthDate || signature !== cloudSignatureRef.current;
    const feedback = await saveAnonymousProfile(toSave, blocked, cloudChanged && !nameProblem, { withBirthDate });
    if (nameProblem && cloudChanged) {
      return { feedback: { ...feedback, savedToCloud: false, userMessage: nameProblem }, cloudChanged };
    }
    if (feedback.savedToCloud) {
      cloudSignatureRef.current = signature;
      if (withBirthDate) cloudHasBirthDateRef.current = true;
    }
    return { feedback, cloudChanged };
  };

  // Profile and filters are saved separately: each only replaces its own fields.
  const handleSaveProfile = async (profile: ProfileFields) => {
    // A new or changed name must be confirmed by the server before anything is saved, on this device or in the cloud.
    // Unchanged names are not re-checked. An untouched name the app made up is swapped for a free one if it was taken.
    if (isFirebaseConfigured) {
      const untouchedSuggestion = userPrefs.profileComplete !== true && profile.displayName === userPrefs.displayName;
      const check = await nameGate.ensure(profile.displayName, untouchedSuggestion);
      if (!check.ok) { showToast(check.message); return; }
      if (check.replaced) showToast(`${profile.displayName} was taken, so you're ${check.name}.`);
      profile = { ...profile, displayName: check.name };
    }
    const next = { ...applyProfile(userPrefs, profile), profileComplete: true };
    setUserPrefs(next);
    setProfileEditOpen(false);
    setProfileOpen(true);
    const { feedback, cloudChanged } = await persistPrefs(next);
    showToast(feedback.savedToCloud || !cloudChanged ? 'Profile updated.' : feedback.userMessage);
  };

  const handleOpenSetup = (mode: 'quick' | 'custom' = 'quick') => {
    if (!isAdultBirthDate(userPrefs.birthDate)) { setAgeGateOpen(true); return; }
    if (userPrefs.profileComplete !== true) { setProfileEditOpen(true); showToast('Save your anonymous profile before matching.'); return; }
    if (suspended) {
      showToast('Matching is paused on this account while the team reviews a report.');
      return;
    }
    setSetupInitialMode(mode);
    setSetupModalOpen(true);
  };

  useEffect(() => {
    logScreenView(currentView);
  }, [currentView]);

  // Counts the member as active once a day (see activityService); a tab left open overnight counts again on return.
  useEffect(() => {
    if (!isFirebaseConfigured || userPrefs.profileComplete !== true || ageRestricted) return;
    void recordDailyActivity();
    const onVisible = () => document.visibilityState === 'visible' && void recordDailyActivity();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userPrefs.profileComplete, ageRestricted]);

  const handleNavigate = (view: NavTarget) => {
    if (view === 'signals') { setSignalAlert(false); setAcceptedAlert(null); setRequestAlert(false); }
    if (view === 'setup') handleOpenSetup('quick');
    else setCurrentView(view);
    window.scrollTo({ top: 0 });
  };

  const handleStartMatching = async (mode: 'quick' | 'custom', filters: FilterFields) => {
    if (!isAdultBirthDate(userPrefs.birthDate) || userPrefs.profileComplete !== true) {
      setSetupModalOpen(false);
      if (!isAdultBirthDate(userPrefs.birthDate)) setAgeGateOpen(true); else setProfileEditOpen(true);
      return;
    }
    // Quick only changes how this search runs; the saved Custom filters are kept as chosen.
    const next = applyFilters(userPrefs, filters);
    setUserPrefs(next);
    setSetupInitialMode(mode);
    setSetupModalOpen(false);

    const { feedback, cloudChanged } = await persistPrefs(next);

    // Only speak up when something went wrong; a normal save stays quiet.
    if (cloudChanged && feedback.userMessage && !feedback.savedToCloud) {
      showToast(feedback.userMessage);
    }

    setCurrentView('searching');
  };



  const handleNextMatch = () => {
    // The chat screen has already ended the current conversation; go back to the live queue.
    setActivePartner(null);
    setActiveConvId(null);
    setCurrentView('searching');
  };

  const handleLeaveChat = () => {
    setActivePartner(null);
    setCurrentView('home');
    showToast('Conversation closed safely. Transcripts cleared.');
  };

  /** Blocks a member from Looking For: hidden from this member's board, and the server refuses their Signals. */
  const handleBlockMember = (memberId: string) => {
    if (!memberId || blockedPartnerIds.includes(memberId)) return;
    const updated = [...blockedPartnerIds, memberId];
    setBlockedPartnerIds(updated);
    setStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, JSON.stringify(updated));
    void persistPrefs(userPrefs, { blocked: updated }).then(({ feedback }) => {
      showToast(feedback.savedToCloud ? 'Blocked. You won’t see their posts and they can’t Signal you.' : 'Blocked on this device. We’ll sync it when you’re back online.');
    });
  };

  const handleBlockAndReport = (
    reason: string,
    statusOutcome?: { reportSent?: boolean; convEnded?: boolean; isCloud?: boolean }
  ) => {
    if (activePartner) {
      const updated = [...blockedPartnerIds, activePartner.id];
      setBlockedPartnerIds(updated);
      setStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, JSON.stringify(updated));

      // Record structured report log
      try {
        const existingReports = JSON.parse(
          getStorageItem(STORAGE_KEYS.REPORTS.current, STORAGE_KEYS.REPORTS.legacy) || '[]'
        );
        const reportEntry = {
          id: `rep-${Date.now()}`,
          partnerId: activePartner.id,
          partnerName: activePartner.displayName,
          reportedBy: userPrefs.displayName,
          reason,
          timestamp: Date.now(),
        };
        setStorageItem(STORAGE_KEYS.REPORTS.current, JSON.stringify([...existingReports, reportEntry]));
      } catch {
        // Fallback
      }

      if (statusOutcome?.isCloud) {
        if (statusOutcome.reportSent && statusOutcome.convEnded) {
          showToast(`Report submitted to safety team and user blocked.`);
        } else if (statusOutcome.reportSent && !statusOutcome.convEnded) {
          showToast(`Report submitted, but cloud conversation termination failed. User blocked locally.`);
        } else {
          showToast(`Cloud report submission failed. User blocked locally.`);
        }
      } else {
        showToast(`Reported and blocked. You won't be matched again.`);
      }
    }
    setActivePartner(null);
    setCurrentView('home');
  };

  const showChrome = currentView !== 'chat';

  return (
    <ProfileNavProvider value={profileNav}>
    <div
      className={`min-h-[100dvh] flex flex-col bg-ink text-fg relative ${
        showChrome && currentView !== 'public' ? 'pb-[var(--tabbar-h)]' : ''
      }`}
    >
      <FloatingCatsBackground />

      {(ageGateOpen || (ageRestricted && !supportOpen)) && (
        <AgeEligibilityGate initialBirthDate={userPrefs.birthDate} restricted={ageRestricted} reviewSubmitted={ageReviewSubmitted}
          onSubmit={async (birthDate) => {
            const age = calculateAge(birthDate);
            if (age === null || age < 18) {
              const submitted = await submitAgeEligibilityReview();
              setAgeReviewSubmitted(submitted || ageReviewSubmitted);
              if (submitted) setStorageItem('queerspace_age_review_requested', 'true');
              setAgeRestricted(true); setAgeGateOpen(true); setStorageItem('queerspace_age_restricted', 'true'); return;
            }
            const next = { ...userPrefs, birthDate, profileComplete: userPrefs.profileComplete === true };
            setUserPrefs(next); setAgeRestricted(false); setAgeReviewSubmitted(false); setStorageItem('queerspace_age_restricted', 'false');
            const { feedback } = await persistPrefs(next, { withBirthDate: true });
            if (!feedback.savedToCloud && isFirebaseConfigured) showToast('Birthday saved on this device. Cloud sync needs attention.');
            setAgeGateOpen(false);
          }}
          onContactSupport={() => { setAgeGateOpen(false); openSupport(); }} />
      )}

      {signalAlert && currentView !== 'signals' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-center gap-2.5 bg-raised/95 backdrop-blur-xl text-fg pl-4 pr-2 py-2.5 rounded-2xl shadow-2xl shadow-black/50 border border-lavender/30 text-sm anim-pop"
        >
          <RadioTower className="w-[18px] h-[18px] text-lavender shrink-0" />
          <span className="min-w-0 flex-1 truncate">{signalSender ? <><strong className="font-semibold">{signalSender}</strong> wants to connect.</> : 'Someone would like to connect.'}</span>
          <button type="button" onClick={() => handleNavigate('signals')} className="rounded-full bg-berry px-3.5 py-1.5 text-xs font-semibold text-ink hover:brightness-110">View</button>
          <button type="button" onClick={() => setSignalAlert(false)} aria-label="Dismiss" className="rounded-full px-2 py-1 text-muted hover:text-fg">✕</button>
        </div>
      )}

      {requestAlert && currentView !== 'signals' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-center gap-2.5 bg-raised/95 backdrop-blur-xl text-fg pl-4 pr-2 py-2.5 rounded-2xl shadow-2xl shadow-black/50 border border-lavender/30 text-sm anim-pop"
        >
          <RadioTower className="w-[18px] h-[18px] text-lavender shrink-0" />
          <span className="min-w-0 flex-1 truncate">You have a new connection request.</span>
          <button type="button" onClick={() => { setSignalsStartSection('requests'); handleNavigate('signals'); }} className="rounded-full bg-berry px-3.5 py-1.5 text-xs font-semibold text-ink hover:brightness-110">View</button>
          <button type="button" onClick={() => setRequestAlert(false)} aria-label="Dismiss" className="rounded-full px-2 py-1 text-muted hover:text-fg">✕</button>
        </div>
      )}

      {acceptedAlert && currentView !== 'signals' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-start gap-2.5 bg-raised/95 backdrop-blur-xl text-fg pl-4 pr-2 py-2.5 rounded-2xl shadow-2xl shadow-black/50 border border-berry/40 text-sm anim-pop"
        >
          <CheckCircle2 className="w-[18px] h-[18px] text-berry shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Connection request accepted!</p>
            <p className="mt-0.5 text-xs leading-snug text-muted">{acceptedAlert.name ?? 'Someone'} accepted your connection request. You can now start chatting on QUEERSPACE.</p>
          </div>
          <button type="button" onClick={() => { setSignalsOpenPairId(acceptedAlert.pairId); handleNavigate('signals'); }} className="shrink-0 rounded-full bg-berry px-3.5 py-1.5 text-xs font-semibold text-ink hover:brightness-110">Chat</button>
          <button type="button" onClick={() => setAcceptedAlert(null)} aria-label="Dismiss" className="shrink-0 rounded-full px-2 py-1 text-muted hover:text-fg">✕</button>
        </div>
      )}

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] w-[calc(100%-2rem)] max-w-sm flex items-start gap-2.5 bg-raised/95 backdrop-blur-xl text-fg px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 border border-line text-sm anim-pop"
        >
          <CheckCircle2 className="w-[18px] h-[18px] text-berry shrink-0 mt-px" />
          <span>{toastMessage}</span>
        </div>
      )}

      {showChrome && (
        <Header
          onNavigate={handleNavigate}
          currentView={currentView}
          isSoundMuted={isSoundMuted}
          onToggleSound={handleToggleSound}
          onOpenSafetyModal={() => setActiveInfoModal('guidelines')}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenWhatsNew={() => setWhatsNewOpen(true)}
          onOpenInfo={(modal) => setActiveInfoModal(modal)}
          onOpenSupport={openSupport}
          hasSupportReply={hasSupportReply}
          hasUnreadUpdates={hasUnreadUpdates}
          profile={userPrefs}
          badges={{ signals: signalsInbox.pendingIds.length + signalsInbox.acceptedUnread.length + signalsInbox.requestIds.length, unsaid: echoNotices.unseenTotal }}
        />
      )}

      <main className="relative flex-1 flex flex-col">
        {suspended && <SuspendedNotice onContact={openSupport} />}
        {currentView === 'home' && (
          <>
            <Hero
              onStartChat={() => handleOpenSetup('quick')}
              onCustomMatch={() => handleOpenSetup('custom')}
              onOpenPublicRoom={() => handleNavigate('public')}
              onOpenCommunity={() => handleNavigate('community')}
              onOpenUnsaid={() => handleNavigate('unsaid')}
            />
            <SafetySection onOpenGuidelinesModal={() => setActiveInfoModal('guidelines')} />
            <InstallPrompt />
          </>
        )}

        {currentView === 'searching' && (
          <SearchingState
            mode={setupInitialMode}
            prefs={matchPrefsForMode(userPrefs, setupInitialMode)}
            blockedPartnerIds={blockedPartnerIds}
            onCancel={() => setCurrentView('home')}
            onMatched={({ partner, convId }) => {
              setActivePartner(partner);
              setActiveConvId(convId);
              setCurrentView('chat');
            }}
          />
        )}

        {currentView === 'chat' && activePartner && (
          <ChatView
            partner={activePartner}
            conversationId={activeConvId ?? undefined}
            userPrefs={userPrefs}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onNextMatch={handleNextMatch}
            onLeaveChat={handleLeaveChat}
            onBlockAndReport={handleBlockAndReport}
            onOpenSetup={() => handleOpenSetup('custom')}
            onOpenDonationModal={() => setDonationModalOpen(true)}
          />
        )}

        {currentView === 'public' && (
          <PublicRoomView
            userPrefs={userPrefs}
            isSoundMuted={isSoundMuted}
            onOpenDonationModal={() => setDonationModalOpen(true)}
          />
        )}

        {currentView === 'unsaid' && <UnsaidView replyNotices={echoNotices} />}

        {currentView === 'community' && <CommunityFeedView userPrefs={userPrefs} blockedPartnerIds={blockedPartnerIds} nsfwPreference={nsfwPreference} onOpenSettings={() => setSettingsOpen(true)} onBlockMember={handleBlockMember} onViewRequests={() => { setSignalsStartSection('requests'); handleNavigate('signals'); }} focusPostId={focusPostId} onCloseFocus={closePost} />}

        {currentView === 'signals' && <SignalsView inbox={signalsInbox} isSoundMuted={isSoundMuted} requestedPairId={signalsOpenPairId} onRequestedPairHandled={() => setSignalsOpenPairId(null)} initialSection={signalsStartSection} onInitialSectionHandled={() => setSignalsStartSection('inbox')} onBlockMember={handleBlockMember} />}
      </main>

      {showChrome && currentView !== 'public' && (
        <Footer
          onOpenModal={(modal) => setActiveInfoModal(modal)}
          onOpenSupport={openSupport}
          onOpenWhatsNew={() => setWhatsNewOpen(true)}
          hasUnreadUpdates={hasUnreadUpdates}
          hasSupportReply={hasSupportReply}
          className="hidden desk:block"
        />
      )}

      {showChrome && <BottomNavigation currentView={currentView} onNavigate={handleNavigate} badges={{ signals: signalsInbox.pendingIds.length + signalsInbox.acceptedUnread.length + signalsInbox.requestIds.length, unsaid: echoNotices.unseenTotal }} />}

      {setupModalOpen && (
        <MatchSetupModal
          initialMode={setupInitialMode}
          currentPrefs={userPrefs}
          onClose={() => setSetupModalOpen(false)}
          onStartMatching={handleStartMatching}
          onEditProfile={() => {
            setSetupModalOpen(false);
            setProfileEditOpen(true);
          }}
        />
      )}

      {profileOpen && !ageGateOpen && !ageRestricted && (
        <ProfilePageSheet currentPrefs={userPrefs} onClose={() => setProfileOpen(false)}
          onEditProfile={() => { setProfileOpen(false); setProfileEditOpen(true); }}
          onEditPreferences={() => { setProfileOpen(false); setSetupInitialMode('custom'); setSetupModalOpen(true); }} />
      )}

      {profileEditOpen && !ageGateOpen && !ageRestricted && (
        <ProfileEditorSheet currentPrefs={userPrefs} onClose={() => setProfileEditOpen(false)} onSave={handleSaveProfile} />
      )}

      <DonationModal isOpen={donationModalOpen} onClose={() => setDonationModalOpen(false)} />

      {settingsOpen && (
        <AppearanceSettingsModal
          theme={theme}
          onChangeTheme={setTheme}
          fontSize={fontSize}
          onChangeFontSize={chooseFontSize}
          nsfwPreference={nsfwPreference}
          onChangeNsfwPreference={chooseNsfwPreference}
          hasUnreadUpdates={hasUnreadUpdates}
          onOpenWhatsNew={() => { setSettingsOpen(false); setWhatsNewOpen(true); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {whatsNewOpen && <WhatsNewSheet onClose={() => setWhatsNewOpen(false)} onChanged={refreshUnreadUpdates} />}

      <InfoModals activeModal={activeInfoModal} onClose={() => setActiveInfoModal(null)} onOpenSupport={openSupport} />

      {supportOpen && (
        <SupportChat
          userPrefs={userPrefs}
          onClose={() => setSupportOpen(false)}
          onOpenSuggestions={() => {
            setSupportOpen(false);
            setActiveInfoModal('contact');
          }}
        />
      )}

      {profileMemberId && !ageGateOpen && !ageRestricted && (
        <ProfilePage
          key={profileMemberId}
          memberId={profileMemberId}
          selfId={auth?.currentUser?.uid ?? null}
          userPrefs={userPrefs}
          nsfwPreference={nsfwPreference}
          onClose={closeProfile}
          onOpenConversation={(conversationId) => { closeProfile(); setSignalsOpenPairId(conversationId); handleNavigate('signals'); }}
          onOpenRequests={() => { closeProfile(); setSignalsStartSection('requests'); handleNavigate('signals'); }}
          onEditProfile={() => { closeProfile(); setProfileEditOpen(true); }}
          onBlockMember={handleBlockMember}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
    </div>
    </ProfileNavProvider>
  );
}
