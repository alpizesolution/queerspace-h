import React from 'react';
import { useFirebaseAuth } from '../hooks/useFirebaseAuth.ts';
import { WifiOff, Loader2 } from 'lucide-react';

interface AuthStatusBadgeProps {
  className?: string;
}

/** Quiet session indicator: a dot plus a short label on wider screens, full detail in the tooltip. */
export const AuthStatusBadge: React.FC<AuthStatusBadgeProps> = ({ className = '' }) => {
  const { status, shortUid, isAnonymous } = useFirebaseAuth();

  let dot: React.ReactNode;
  let label: string;
  let title: string;

  switch (status) {
    case 'loading':
      dot = <Loader2 className="w-3 h-3 text-berry animate-spin" />;
      label = 'Connecting';
      title = 'Connecting to session…';
      break;
    case 'connected':
      dot = <span className="w-2 h-2 rounded-full bg-emerald-400" />;
      label = isAnonymous ? `Anon #${shortUid || 'user'}` : 'Signed in';
      title = `Connected anonymously${shortUid ? ` as #${shortUid}` : ''}`;
      break;
    case 'error':
      dot = <WifiOff className="w-3 h-3 text-amber-400" />;
      label = 'Offline';
      title = 'Cloud offline. Running in local mode.';
      break;
    case 'local_fallback':
    default:
      dot = <span className="w-2 h-2 rounded-full bg-amber-400" />;
      label = 'Offline';
      title = 'Not connected. Live chat is unavailable.';
  }

  return (
    <div
      className={`inline-flex items-center justify-center gap-1.5 w-8 sm:w-auto h-7 sm:px-2.5 rounded-full sm:bg-surface sm:border sm:border-line text-[11px] font-medium text-muted shrink-0 ${className}`}
      title={title}
      role="status"
      aria-label={title}
    >
      <span className="flex items-center justify-center w-3 h-3">{dot}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
};
