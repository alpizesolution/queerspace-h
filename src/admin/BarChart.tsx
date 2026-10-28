import React, { useState } from 'react';
import type { DayCount } from '../services/adminService.ts';

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Daily counts as a single-series bar chart, with a hover/tap readout and a screen-reader table. */
export const BarChart: React.FC<{ title: string; data: DayCount[] }> = ({ title, data }) => {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const shown = active === null ? null : data[active];

  return (
    <figure className="card p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[length:calc(13px_*_var(--fs,1))] font-medium text-fg">{title}</span>
        <span className="text-[length:calc(12px_*_var(--fs,1))] text-muted tabular-nums">
          {shown ? `${dayLabel(shown.day)} · ${shown.count}` : `${total} in ${data.length} days`}
        </span>
      </figcaption>
      <div className="relative mt-4 h-28 flex items-end gap-[2px] border-b border-line" onMouseLeave={() => setActive(null)} aria-hidden="true">
        {data.map((d, i) => (
          <button
            key={d.day}
            type="button"
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(active === i ? null : i)}
            className="flex-1 h-full flex items-end cursor-default"
          >
            <span
              className={`w-full rounded-t-[4px] transition-colors ${active === i ? 'bg-berry-hover' : 'bg-berry'}`}
              style={{ height: d.count ? `${Math.max(4, (d.count / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[length:calc(11px_*_var(--fs,1))] text-subtle" aria-hidden="true">
        <span>{data.length ? dayLabel(data[0].day) : ''}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>{title} per day</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayLabel(d.day)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
};
