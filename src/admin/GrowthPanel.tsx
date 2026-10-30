import React, { useEffect, useState } from 'react';
import { BarChart } from './BarChart.tsx';
import { Delta, SectionHeading, Stat } from './Kpi.tsx';
import {
  ActivityStats,
  AuthGrowth,
  CohortRow,
  RETENTION_DAYS,
  loadActivityStats,
  loadAuthGrowth,
  loadRetention,
  sumLast,
} from '../services/adminGrowthService.ts';
import { dayNumberToLocalMs } from '../utils/acquisition.ts';

const REG_RANGES = [7, 14, 30, 90] as const;
const SOURCE_LABELS: Record<string, string> = {
  tiktok: 'TikTok', facebook: 'Facebook', reddit: 'Reddit', direct: 'Direct', referral: 'Referral', other: 'Other', unknown: 'Unknown',
};

const dayLabel = (dayNumber: number) =>
  new Date(dayNumberToLocalMs(dayNumber)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const isPermissionError = (err: unknown) => /permission|insufficient/i.test(String((err as { code?: string; message?: string })?.code ?? err));

const SkeletonGrid: React.FC<{ n?: number }> = ({ n = 4 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="card h-[92px] animate-pulse" />
    ))}
  </div>
);

const Notice: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="card p-4 text-[length:calc(13px_*_var(--fs,1))] text-muted">
    <p className="text-fg font-medium">{title}</p>
    <p className="mt-1">{children}</p>
  </div>
);

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    load()
      .then((v) => live && setValue(v))
      .catch((err) => {
        console.warn('[Admin] Growth load failed:', err);
        if (live) setError(err);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { value, error, loading };
}

/** Accounts, registrations, daily/weekly/monthly active members and where they came from. */
export const GrowthView: React.FC<{ range: number; members: number; reload: number }> = ({ range, members, reload }) => {
  const [regRange, setRegRange] = useState<(typeof REG_RANGES)[number]>(30);
  const force = reload > 0;
  const auth = useLoad<AuthGrowth>(() => loadAuthGrowth(force), [reload]);
  const activity = useLoad<ActivityStats>(() => loadActivityStats(range, force), [range, reload]);
  const a = activity.value;
  const g = auth.value;

  return (
    <div className="space-y-6">
      <section className="space-y-2.5">
        <SectionHeading hint="Firebase Authentication">Accounts</SectionHeading>
        {auth.loading && !g ? (
          <SkeletonGrid />
        ) : g ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat hero label="Accounts" value={g.total} note="includes visitors who never set up a profile" />
            <Stat hero label="Profiles completed" value={members} note="members" />
            <Stat label="Accounts today" value={sumLast(g.days, 1)} note={<Delta current={sumLast(g.days, 1)} previous={g.days[g.days.length - 2]?.count ?? 0} versus="yesterday" />} />
            <Stat label="This week" value={sumLast(g.days, 7)} note={<>this month {sumLast(g.days, 30)}</>} />
          </div>
        ) : (
          <Notice title="Account dates unavailable">
            {auth.error ? 'The growth service did not answer. Check that the server has its Firebase service account, then refresh.' : 'Loading…'}
          </Notice>
        )}
      </section>

      {g && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <SectionHeading hint="Real account creation dates">Registrations</SectionHeading>
            <div className="flex gap-1.5" role="group" aria-label="Registration range">
              {REG_RANGES.map((r) => (
                <button key={r} onClick={() => setRegRange(r)} aria-pressed={regRange === r} className="chip">
                  {r}d
                </button>
              ))}
            </div>
          </div>
          <BarChart title="New accounts" data={g.days.slice(-regRange)} />
          <p className="text-[length:calc(11px_*_var(--fs,1))] text-subtle">
            Accounts start when someone first opens the app. “Profiles completed” counts only people who finished setting up, so it is always lower.
          </p>
        </section>
      )}

      <section className="space-y-2.5">
        <SectionHeading hint={a?.trackingSince ? `Counted since ${dayLabel(a.trackingSince)}` : 'Members who open the app'}>Activity</SectionHeading>
        {activity.loading && !a ? (
          <SkeletonGrid n={4} />
        ) : a ? (
          a.tracked === 0 ? (
            <Notice title="No activity recorded yet">
              Counting begins when members next open the app. It only covers days from the first record onward, so there is no history to show yet.
            </Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat hero label="Daily active" value={a.dau} note={<Delta current={a.dau} previous={a.dauYesterday} versus="yesterday" />} />
                <Stat hero label="Weekly active" value={a.wau} note="last 7 days" />
                <Stat hero label="Monthly active" value={a.mau} note="last 30 days" />
                <Stat hero label="Returning" value={a.returningWeek} note={`this week · ${a.returningMonth} this month`} />
              </div>
              <BarChart title="Daily active members" data={a.dauDays} />
            </>
          )
        ) : (
          <Notice title="Activity unavailable">
            {isPermissionError(activity.error)
              ? 'Firestore is not allowing this read yet. Publish the member_activity rules, then refresh.'
              : 'Couldn’t load activity. Try refreshing.'}
          </Notice>
        )}
      </section>

      {a && a.tracked > 0 && (
        <section className="space-y-2.5">
          <SectionHeading hint="New members since tracking began">Where members come from</SectionHeading>
          <ul className="card divide-y divide-line">
            {a.sources
              .filter((s) => s.count > 0)
              .sort((x, y) => y.count - x.count)
              .map((s) => {
                const pct = Math.round((s.count / a.tracked) * 100);
                return (
                  <li key={s.source} className="px-4 py-2.5 text-[length:calc(13px_*_var(--fs,1))]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-fg">{SOURCE_LABELS[s.source]}</span>
                      <span className="tabular-nums text-muted">{s.count} · {pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-raised overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded-full bg-berry" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </li>
                );
              })}
          </ul>
          <p className="text-[length:calc(11px_*_var(--fs,1))] text-subtle">
            Taken from the link someone first arrived by (?ref=tiktok, facebook, reddit, community…). Members who joined before this tracking
            show as Unknown; nothing is guessed for them.
          </p>
        </section>
      )}
    </div>
  );
};

/** Weekly cohorts: of the members who first showed up that week, how many came back on day 1, 7, 14, 30. */
export const RetentionView: React.FC<{ range: number; reload: number }> = ({ range, reload }) => {
  const force = reload > 0;
  const since = useLoad<number | null>(async () => (await loadActivityStats(range, force)).trackingSince, [reload]);
  const rows = useLoad<CohortRow[]>(
    async () => (since.value ? loadRetention(since.value, force) : []),
    [since.value, reload]
  );

  if (since.loading && since.value === null) return <SkeletonGrid n={2} />;
  if (since.error) {
    return (
      <Notice title="Retention unavailable">
        {isPermissionError(since.error) ? 'Firestore is not allowing this read yet. Publish the member_activity rules, then refresh.' : 'Couldn’t load retention. Try refreshing.'}
      </Notice>
    );
  }
  if (!since.value) {
    return <Notice title="No activity recorded yet">Retention is measured from the day counting starts, so the first numbers appear a day after members start opening the app.</Notice>;
  }

  return (
    <div className="space-y-3">
      <SectionHeading hint={`Counted since ${dayLabel(since.value)}`}>Retention by first week</SectionHeading>
      {rows.loading && !rows.value ? (
        <SkeletonGrid n={2} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[length:calc(13px_*_var(--fs,1))]">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th scope="col" className="px-4 py-2.5 font-medium">First seen</th>
                <th scope="col" className="px-2 py-2.5 font-medium text-right">Members</th>
                {RETENTION_DAYS.map((n) => (
                  <th key={n} scope="col" className="px-2 py-2.5 font-medium text-right">Day {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.value ?? []).map((row) => (
                <tr key={row.from} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal text-fg whitespace-nowrap">
                    {dayLabel(row.from)}–{dayLabel(row.to)}
                  </th>
                  <td className="px-2 py-2.5 text-right tabular-nums">{row.size}</td>
                  {RETENTION_DAYS.map((n) => (
                    <td key={n} className="px-2 py-2.5 text-right tabular-nums">
                      {row.rates[n] === null ? <span className="text-subtle" title="Not complete yet">—</span> : `${row.rates[n]}%`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[length:calc(11px_*_var(--fs,1))] text-subtle">
        A member counts as active on a day when they open the app signed in. “Day N” is the share of a week’s new members who were active again exactly N days after
        their first day. A dash means that window hasn’t finished yet, and a week only shows rates once all seven of its days have.
      </p>
    </div>
  );
};
