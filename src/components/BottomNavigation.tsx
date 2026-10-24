import React from 'react';
import { Home, MessageSquare, Users, Settings } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface Props {
  currentView: string;
  onNavigate: (view: 'home' | 'public' | 'community') => void;
}

export const BottomNavigation: React.FC<Props> = ({ currentView, onNavigate }) => {
  const tabs = [
    { name: 'home', label: 'Home', icon: Home },
    { name: 'public', label: 'Rooms', icon: MessageSquare },
    { name: 'community', label: 'Feed', icon: Users },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#17121B]/90 backdrop-blur-md border-t border-[#403247] pb-safe">
      <div className="grid grid-cols-4 items-center h-16 pb-safe">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentView === tab.name;
          return (
            <button
              key={tab.name}
              onClick={() => onNavigate(tab.name as any)}
              className={`flex flex-col items-center justify-center w-full h-full ${
                isActive ? 'text-[#C77DAA]' : 'text-[#F7F0F6]/60'
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-[10px] font-medium mt-1">{tab.label}</span>
            </button>
          );
        })}
        <div className="flex flex-col items-center justify-center w-full h-full">
            <PWAInstallButton />
        </div>
      </div>
    </div>
  );
};
