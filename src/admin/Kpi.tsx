import React from 'react';
import { pctChange } from '../services/adminService.ts';

/** "▲ 12% vs yesterday". Nothing is shown when the earlier period has no activity to compare with. */
export const Delta: React.FC<{ current: number; previous: number; versus: string }> = ({ current, previous, versus }) => {
  const change = pctChange(current, previous);
  if (change === null) return <span className="text-subtle">{previous === 0 && current > 0 ? `new vs ${versus}` : `no data vs ${versus}`}</span>;
  const tone = change > 0 ? 'text-emerald-400' : change < 0 ? 'text-danger' : 'text-subtle';
  return (
    <span className={tone}>
      {change > 0 ? '▲' : change < 0 ? '▼' : '•'} {Math.abs(change)}% <span className="text-subtle">vs {versus}</span>
    </span>
  );
};

export const Stat: React.FC<{ label: string; value: number | string; note?: React.ReactNode; hero?: boolean }> = ({ label, value, note, hero }) => (
  <div className="card p-4">
    <p className="text-[length:calc(12px_*_var(--fs,1))] text-muted">{label}</p>
    <p className={`${hero ? 'text-3xl' : 'text-2xl'} font-semibold tracking-tight mt-1 tabular-nums`}>{value}</p>
    {note && <p className="text-[length:calc(12px_*_var(--fs,1))] text-subtle mt-0.5">{note}</p>}
  </div>
);

export const SectionHeading: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div className="flex items-baseline justify-between gap-2">
    <h2 className="text-[length:calc(13px_*_var(--fs,1))] font-medium text-fg">{children}</h2>
    {hint && <span className="text-[length:calc(11px_*_var(--fs,1))] text-subtle">{hint}</span>}
  </div>
);
