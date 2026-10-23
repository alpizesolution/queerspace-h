import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { Hero } from './components/Hero.tsx';
import { ModeSelector } from './components/ModeSelector.tsx';
import { HowItWorks } from './components/HowItWorks.tsx';
import { SafetySection } from './components/SafetySection.tsx';
import { Footer } from './components/Footer.tsx';
import { MatchSetupModal } from './components/MatchSetupModal.tsx';
import { SearchingState } from './components/SearchingState.tsx';
import { ChatView } from './components/ChatView.tsx';
import { PublicRoomView } from './components/PublicRoomView.tsx';
import { CommunityFeedView } from './components/CommunityFeedView.tsx';
import { InfoModals } from './components/InfoModals.tsx';
import { DonationModal } from './components/DonationModal.tsx';
import { FloatingCatsBackground } from './components/FloatingCatsBackground.tsx';
import { ChatMode, PartnerProfile, UserPreferences } from './types.ts';
import { findBestPartner } from './utils/mock-partners.ts';
import { generateSapphicPseudonym } from './utils/matching-logic.ts';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from './utils/storage.ts';
import { ensureAnonymousAuth, isFirebaseConfigured } from './lib/firebase.ts';
import { executeHonestStorageWrite } from './utils/sync-feedback.ts';
import { saveAnonymousProfile, loadAnonymousProfile } from './services/profilePersistence.ts';
import { findMatchCandidate } from './services/matchmakingService.ts';
import { CheckCircle2 } from 'lucide-react';





export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'searching' | 'chat' | 'public' | 'community'>('home');
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [setupInitialMode, setSetupInitialMode] = useState<'quick' | 'custom'>('quick');
  const [activePartner, setActivePartner] = useState<PartnerProfile | null>(null);
  const [activePartnerSource, setActivePartnerSource] = useState<'cloud' | 'local_fallback' | 'dynamic_fallback'>('local_fallback');
  const [blockedPartnerIds, setBlockedPartnerIds] = useState<string[]>(() => {
    const saved = getStorageItem(STORAGE_KEYS.BLOCKED_IDS.current, STORAGE_KEYS.BLOCKED_IDS.legacies);
    return saved ? JSON.parse(saved) : [];
  });

  const [activeInfoModal, setActiveInfoModal] = useState<
    'about' | 'guidelines' | 'privacy' | 'terms' | 'contact' | null
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

  // Handle URL query parameters (e.g. ?autostart=1 or ?view=setup)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const partner = findBestPartner(userPrefs, blockedPartnerIds);
      setActivePartner(partner);
      setActivePartnerSource('local_fallback');
      setCurrentView('chat');
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

  const handleOpenSetup = (mode: 'quick' | 'custom' = 'quick') => {
    setSetupInitialMode(mode);
    setSetupModalOpen(true);
  };

  const handleSelectMode = (mode: ChatMode) => {
    if (mode === 'quick') {
      // Direct quick matching
      setCurrentView('searching');
    } else if (mode === 'custom') {
      handleOpenSetup('custom');
    } else if (mode === 'public') {
      setCurrentView('public');
    } else if (mode === 'community') {
      setCurrentView('community');
    }
  };

  const handleStartMatching = async (mode: 'quick' | 'custom', prefs: UserPreferences) => {
    setUserPrefs(prefs);
    setSetupModalOpen(false);

    const feedback = await saveAnonymousProfile(prefs, blockedPartnerIds);

    if (feedback.userMessage) {
      showToast(feedback.userMessage);
    }

    setCurrentView('searching');
  };



  const handleMatchFound = async () => {
    const result = await findMatchCandidate(userPrefs, blockedPartnerIds);
    setActivePartner(result.candidate);
    setActivePartnerSource(result.source);
    setCurrentView('chat');
  };

  const handleNextMatch = async () => {
    // Cycle to next available partner
    const exclude = activePartner ? [...blockedPartnerIds, activePartner.id] : blockedPartnerIds;
    const result = await findMatchCandidate(userPrefs, exclude);
    setActivePartner(result.candidate);
    setActivePartnerSource(result.source);
    showToast(`Switched to new conversation with ${result.candidate.displayName}`);
  };


  const handleLeaveChat = () => {
    setActivePartner(null);
    setCurrentView('home');
    showToast('Conversation closed safely. Transcripts cleared.');
  };

  const handleBlockAndReport = (reason: string) => {
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

      showToast(`User reported for "${reason}" and blocked.`);
    }
    setActivePartner(null);
    setCurrentView('home');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080311] text-[#fcf7fa] relative">
      {/* Floating Cats Ambient Background */}
      <FloatingCatsBackground />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 flex items-center gap-2 bg-[#241B29] text-[#F7F0F6] px-4 py-3 rounded-2xl shadow-2xl border border-[#403247] text-xs sm:text-sm animate-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#C77DAA]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Header (hidden during active 1-on-1 chat for full conversation immersion) */}
      {currentView !== 'chat' && (
        <Header
          onStartChat={() => handleOpenSetup('quick')}
          onNavigate={(view) => {
            if (view === 'setup') handleOpenSetup('custom');
            else setCurrentView(view);
          }}
          currentView={currentView}
          isSoundMuted={isSoundMuted}
          onToggleSound={handleToggleSound}
          onOpenSafetyModal={() => setActiveInfoModal('guidelines')}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {currentView === 'home' && (
          <>
            <Hero
              onQuickChat={() => handleSelectMode('quick')}
              onExploreCommunity={() => setCurrentView('community')}
              onOpenSetup={() => handleOpenSetup('custom')}
            />
            <ModeSelector onSelectMode={handleSelectMode} />
            <HowItWorks />
            <SafetySection
              onOpenGuidelinesModal={() => setActiveInfoModal('guidelines')}
            />
          </>
        )}

        {currentView === 'searching' && (
          <SearchingState
            mode={setupInitialMode}
            prefs={userPrefs}
            onCancel={() => setCurrentView('home')}
            onMatchFound={handleMatchFound}
          />
        )}

        {currentView === 'chat' && activePartner && (
          <ChatView
            partner={activePartner}
            partnerSource={activePartnerSource}
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
            onBackToHome={() => setCurrentView('home')}
            onOpen1on1={() => handleOpenSetup('quick')}
            onOpenDonationModal={() => setDonationModalOpen(true)}
          />
        )}

        {currentView === 'community' && (
          <CommunityFeedView
            userPrefs={userPrefs}
            onBackToHome={() => setCurrentView('home')}
            onStart1on1={() => handleOpenSetup('quick')}
          />
        )}
      </main>

      {/* Match Setup Modal */}
      {setupModalOpen && (
        <MatchSetupModal
          initialMode={setupInitialMode}
          currentPrefs={userPrefs}
          onClose={() => setSetupModalOpen(false)}
          onStartMatching={handleStartMatching}
        />
      )}

      {/* Donation Modal */}
      <DonationModal
        isOpen={donationModalOpen}
        onClose={() => setDonationModalOpen(false)}
      />

      {/* Informational Policy & Guidelines Modals */}
      <InfoModals
        activeModal={activeInfoModal}
        onClose={() => setActiveInfoModal(null)}
      />

      {/* Footer (hidden during active 1-on-1 chat and public room) */}
      {currentView !== 'chat' && currentView !== 'public' && (
        <Footer
          onOpenModal={(modal) => setActiveInfoModal(modal)}
          onOpenDonation={() => setDonationModalOpen(true)}
        />
      )}
    </div>
  );
}
