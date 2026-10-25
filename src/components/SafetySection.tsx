import React from 'react';
import { EyeOff, UserX, Flag, ShieldCheck, ChevronRight } from 'lucide-react';

interface SafetySectionProps {
  onOpenGuidelinesModal: () => void;
}

const POINTS = [
  { icon: EyeOff, title: 'Anonymous by default', text: 'No phone, email or real name needed.' },
  { icon: UserX, title: 'Leave or block anytime', text: 'Blocked people are never matched with you again.' },
  { icon: Flag, title: 'Report in one tap', text: 'Zero tolerance for harassment or impostors.' },
  { icon: ShieldCheck, title: '18+ sapphic space', text: 'For women and non-binary sapphic folks.' },
];

export const SafetySection: React.FC<SafetySectionProps> = ({ onOpenGuidelinesModal }) => (
  <section className="max-w-2xl desk:max-w-6xl mx-auto w-full px-4 sm:px-6 pb-12 sm:pb-16">
    <div className="flex items-end justify-between gap-4 mb-4">
      <h2 className="text-lg font-semibold text-fg">Safety first</h2>
      <button
        onClick={onOpenGuidelinesModal}
        className="inline-flex items-center gap-0.5 text-[13px] font-medium text-berry hover:text-berry-hover cursor-pointer py-2"
      >
        Guidelines
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
    <ul className="card divide-y divide-line sm:divide-y-0 sm:grid sm:grid-cols-2 desk:grid-cols-4">
      {POINTS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex gap-3 p-4 sm:p-5">
          <Icon className="w-5 h-5 text-lavender shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-fg">{title}</p>
            <p className="text-[13px] text-muted mt-0.5 leading-snug">{text}</p>
          </div>
        </li>
      ))}
    </ul>
  </section>
);
