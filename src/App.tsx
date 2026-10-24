import React, { useState, useEffect } from 'react';
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
import { InfoModals } from './components/InfoModals.tsx';
import { DonationModal } from './components/DonationModal.tsx';
import { FloatingCatsBackground } from './components/FloatingCatsBackground.tsx';
import { InstallPrompt } from './components/InstallPrompt.tsx';
import { PartnerProfile, UserPreferences } from './types.ts';
import { generateSapphicPseudonym } from './utils/matching-logic.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from './utils/storage.ts';
import { ensureAnonymousAuth, isFirebaseConfigured, logScreenView } from './lib/firebase.ts';
import { executeHonestStorageWrite } from './utils/sync-feedback.ts';
import { saveAnonymousProfile, loadAnonymousProfile } from './services/profilePersistence.ts';
import { CheckCircle2 } from 'lucide-react';
import { BottomNavigation, NavTarget } from './components/BottomNavigation.tsx';

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'searching' | 'chat' | 'public' | 'unsaid' | 'community'>('home');
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [setupInitialMode, setSetupInitialMode] = useState<'quick' | 'custom'>('quick');
  const [activePartner, setActivePartner] = useState<PartnerProfile | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [blockedPartnerIds, setBlockedPartnerIds] = useState<string[]>(() => {
    const saved = getStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, STORAGE_KEYS.BLOCKED_IDS.legacies);
    return saved ? JSON.parse(saved) : [];
  });

  const [setupPurpose, setSetupPurpose] = useState<'match' | 'profile'>('match');
  const [activeInfoModal, setActiveInfoModal] = useState<
    'about' | 'faq' | 'guidelines' | 'privacy' | 'terms' | 'contact' | null
  >(null);

  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return getStorageItem(STORAGE_KEYS.SOUND_MUTED.current, STORAGE_KEYS.SOUND_MUTED.legacies) === 'true';
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
      topics: ['WLW Books & Poetry', 'Plants & Coffee'],
      region: 'Anywhere / Worldwide',
    };
  });

  // Initialize anonymous auth session on startup and restore cloud profile if available
  useEffect(() => {
    if (isFirebaseConfigured) {
      ensureAnonymousAuth()
        .then((user) => {
          if (user) {
            loadAnonymousProfile().then((res) => {
              if (res.fromCloudSuccess) {
                setUserPrefs(res.prefs);
              }
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

  const handleSaveProfile = async (prefs: UserPreferences) => {
    setUserPrefs(prefs);
    setSetupModalOpen(false);
    const feedback = await saveAnonymousProfile(prefs, blockedPartnerIds);
    showToast(feedback.savedToCloud ? 'Profile updated.' : feedback.userMessage);
  };

  const handleOpenSetup = (mode: 'quick' | 'custom' = 'quick') => {
    setSetupPurpose('match');
    setSetupInitialMode(mode);
    setSetupModalOpen(true);
  };

  useEffect(() => {
    logScreenView(currentView);
  }, [currentView]);

  const handleNavigate = (view: NavTarget) => {
    if (view === 'setup') handleOpenSetup('quick');
    else setCurrentView(view);
    window.scrollTo({ top: 0 });
  };

  const handleStartMatching = async (mode: 'quick' | 'custom', prefs: UserPreferences) => {
    setUserPrefs(prefs);
    setSetupInitialMode(mode);
    setSetupModalOpen(false);

    const feedback = await saveAnonymousProfile(prefs, blockedPartnerIds);

    // Only speak up when something went wrong; a normal save stays quiet.
    if (feedback.userMessage && !feedback.savedToCloud) {
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
    <div
      className={`min-h-[100dvh] flex flex-col bg-ink text-fg relative ${
        showChrome && currentView !== 'public' ? 'pb-[var(--tabbar-h)]' : ''
      }`}
    >
      <FloatingCatsBackground />

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
          onOpenProfile={() => {
            setSetupPurpose('profile');
            setSetupModalOpen(true);
          }}
          profile={userPrefs}
        />
      )}

      <main className="relative flex-1 flex flex-col">
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
            prefs={userPrefs}
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

        {currentView === 'unsaid' && <UnsaidView />}

        {currentView === 'community' && <CommunityFeedView userPrefs={userPrefs} />}
      </main>

      {showChrome && currentView !== 'public' && (
        <Footer
          onOpenModal={(modal) => setActiveInfoModal(modal)}
          onOpenDonation={() => setDonationModalOpen(true)}
          className={currentView === 'community' ? 'hidden sm:block' : ''}
        />
      )}

      {showChrome && <BottomNavigation currentView={currentView} onNavigate={handleNavigate} />}

      {setupModalOpen && (
        <MatchSetupModal
          initialMode={setupInitialMode}
          currentPrefs={userPrefs}
          onClose={() => setSetupModalOpen(false)}
          onStartMatching={handleStartMatching}
          purpose={setupPurpose}
          onSaveProfile={handleSaveProfile}
        />
      )}

      <DonationModal isOpen={donationModalOpen} onClose={() => setDonationModalOpen(false)} />

      <InfoModals activeModal={activeInfoModal} onClose={() => setActiveInfoModal(null)} />
    </div>
  );
}
