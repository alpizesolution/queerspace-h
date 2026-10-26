import React from 'react';
import { Home, MessageCircle, Users, MessagesSquare, Feather, RadioTower } from 'lucide-react';

export type NavTarget = 'home' | 'setup' | 'public' | 'unsaid' | 'community' | 'signals';

/** Single source of truth for primary navigation (bottom tab bar on mobile, header tabs on desktop). */
export const NAV_ITEMS: { id: NavTarget; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'setup', label: 'Seek', icon: MessageCircle },
  { id: 'public', label: 'Galaxy', icon: Users },
  { id: 'unsaid', label: 'Echoes', icon: Feather },
  { id: 'community', label: 'Cosmos', icon: MessagesSquare },
  { id: 'signals', label: 'Signals', icon: RadioTower },
];

export const isNavActive = (id: NavTarget, currentView: string) =>
  id === 'setup' ? currentView === 'searching' || currentView === 'chat' : currentView === id;

interface Props {
  currentView: string;
  onNavigate: (view: NavTarget) => void;
}

export const BottomNavigation: React.FC<Props> = ({ currentView, onNavigate }) => (
  <nav
    aria-label="Main"
    className="tabbar desk:hidden fixed bottom-0 inset-x-0 z-40 bg-ink/90 backdrop-blur-xl border-t border-line pb-safe"
  >
    <div className="grid grid-cols-6 h-14 max-w-2xl mx-auto">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = isNavActive(id, currentView);
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            className={`min-w-0 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              active ? 'text-berry' : 'text-subtle hover:text-fg'
            }`}
          >
            <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.25 : 1.75} />
            <span className="max-w-full truncate px-0.5 text-[11px] font-medium leading-none">{label}</span>
          </button>
        );
      })}
    </div>
  </nav>
);
