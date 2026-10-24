import React from 'react';
import { useFirebaseAuth, AuthStatus } from '../hooks/useFirebaseAuth.ts';
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
          <div className="flex items-center gap-1.5 text-xs text-[#cbbccf] bg-[#1a0c2e] px-2.5 py-1 rounded-full border border-[#4a1f6d]">
            <Loader2 className="w-3 h-3 text-[#e07bb8] animate-spin" />
            <span className="font-medium text-[11px]">Connecting…</span>
          </div>
        );

      case 'connected':
        return (
          <div
            className="flex items-center gap-1 text-xs text-[#d1fae5] bg-[#062c1e]/80 px-2 py-0.5 rounded-full border border-emerald-700/50 shadow-sm"
            title={`Connected to Firebase Anonymous Session (${shortUid ? `Anon #${shortUid}` : 'Anon'})`}
          >
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span className="font-semibold text-[10px] tracking-tight">
              {isAnonymous ? `Anon #${shortUid || 'user'}` : 'Auth'}
            </span>
          </div>
        );

      case 'error':
        return (
          <div
            className="flex items-center gap-1.5 text-xs text-amber-200 bg-amber-950/70 px-2.5 py-1 rounded-full border border-amber-800/60"
            title="Cloud Auth Offline — Operating in Local Mode"
          >
            <WifiOff className="w-3 h-3 text-amber-400" />
            <span className="font-medium text-[11px]">Cloud Offline</span>
          </div>
        );

      case 'local_fallback':
      default:
        return (
          <div
            className="flex items-center gap-1.5 text-xs text-[#cbbccf] bg-[#1d0e33]/90 px-2.5 py-1 rounded-full border border-[#4a1f6d]"
            title="Operating in Local Storage Demo Mode"
          >
            <Wifi className="w-3 h-3 text-[#e07bb8]/70" />
            <span className="font-medium text-[11px]">Local Demo Mode</span>
          </div>
        );
    }
  };

  return (
    <div
      className={`inline-flex items-center transition-all ${
        compactMobile ? 'text-[10px]' : ''
      } ${className}`}
    >
      {renderContent()}
    </div>
  );
};
