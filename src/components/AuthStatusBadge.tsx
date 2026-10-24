import React from 'react';
import { useFirebaseAuth } from '../hooks/useFirebaseAuth.ts';
import { Wifi, WifiOff, Loader2, ShieldCheck } from 'lucide-react';

interface AuthStatusBadgeProps {
  className?: string;
  compactMobile?: boolean;
}

export const AuthStatusBadge: React.FC<AuthStatusBadgeProps> = ({
  className = '',
  compactMobile = false,
}) => {
  const { status, shortUid, isAnonymous } = useFirebaseAuth();

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <div
            className="flex items-center gap-1 text-[#cbbccf] bg-[#1a0c2e] p-1 sm:px-2 sm:py-0.5 rounded-full border border-[#4a1f6d]"
            title="Connecting to session…"
          >
            <Loader2 className="w-3.5 h-3.5 text-[#e07bb8] animate-spin shrink-0" />
            <span className="hidden sm:inline font-medium text-[10px]">Connecting</span>
          </div>
        );

      case 'connected':
        return (
          <div
            className="flex items-center gap-1 text-[#d1fae5] bg-[#062c1e]/90 p-1 sm:px-2 sm:py-0.5 rounded-full border border-emerald-700/60 shadow-sm"
            title={`Connected (${shortUid ? `Anon #${shortUid}` : 'Anon'})`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline font-semibold text-[10px] tracking-tight">
              {isAnonymous ? `#${shortUid || 'user'}` : 'Auth'}
            </span>
          </div>
        );

      case 'error':
        return (
          <div
            className="flex items-center gap-1 text-amber-200 bg-amber-950/70 p-1 sm:px-2 sm:py-0.5 rounded-full border border-amber-800/60"
            title="Cloud Offline — Operating in Local Mode"
          >
            <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden sm:inline font-medium text-[10px]">Offline</span>
          </div>
        );

      case 'local_fallback':
      default:
        return (
          <div
            className="flex items-center gap-1 text-[#cbbccf] bg-[#1d0e33]/90 p-1 sm:px-2 sm:py-0.5 rounded-full border border-[#4a1f6d]"
            title="Local Demo Mode"
          >
            <Wifi className="w-3.5 h-3.5 text-[#e07bb8]/70 shrink-0" />
            <span className="hidden sm:inline font-medium text-[10px]">Demo</span>
          </div>
        );
    }
  };

  return (
    <div className={`inline-flex items-center shrink-0 transition-all ${className}`}>
      {renderContent()}
    </div>
  );
};
