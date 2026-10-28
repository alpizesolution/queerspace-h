import React from 'react';
import { Plus } from 'lucide-react';

interface FloatingAddButtonProps {
  onClick: () => void;
  label: string;
}

/** Mobile compose button shared by Cosmos and Echoes, kept clear of the tab bar and safe area. */
export const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="sm:hidden fixed right-4 z-30 w-14 h-14 rounded-full bg-berry text-ink flex items-center justify-center shadow-xl shadow-black/40 active:scale-95 transition-transform cursor-pointer"
    style={{ bottom: 'calc(var(--tabbar-h) + 1rem)' }}
    aria-label={label}
  >
    <Plus className="w-6 h-6" strokeWidth={2.25} />
  </button>
);
