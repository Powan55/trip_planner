'use client';

import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, CalendarClock, Gauge } from 'lucide-react';
import { formatMoney, type CurrencyCode } from '@/core/budget/model';
import { burnRate, type BurnRate } from '@/core/budget/burn-rate';

/**
 * Burn-rate view. Renders how fast the trip is spending vs the plan:
 * a spent-vs-budget progress bar, days elapsed/remaining in the trip window, the daily average vs
 * the daily budget, the projected end-of-trip total at the current pace, and an under/on/over
 * indicator.
 *
 * ── Why it takes props, not its own hook (the seam discipline) ──────────────────────────────
 * This is a PRESENTATIONAL sub-component rendered by `components/budget-panel.tsx`, fed the panel's
 * ALREADY-LIVE home-currency totals (`budgetHome`/`spentHome` from its existing
 * `rollUp(model, expensesToSpent(expenses))`) plus the resolved clock instant (`now`) and the home
 * currency. It adds NO second budget/expense load — so it stays perfectly in lockstep with the panel
 * (a currency toggle or a logged expense re-renders the panel, which re-renders this with fresh
 * props). All the math is the pure `core/budget/burn-rate.ts` (`burnRate`); this file is
 * display only and TOTAL by construction (the core never returns `NaN`).
 *
 * ── a11y / house style ──────────────────────────────────────────────────────────────────────
 * Dark glassmorphism to match the panel. The progress bar is a real `role="progressbar"` with
 * `aria-valuenow/min/max` AND a visible "N% spent" text equivalent (never color-only). The pace
 * indicator carries both a color and a WORD ("Under / On / Over pace") + an icon, so it reads without
 * color perception. The figures sit in an `aria-live="polite"` region so a pace/projection change is
 * announced when a currency toggle or a new expense moves them. The bar's width transition is CSS and
 * disabled under `prefers-reduced-motion`. Every number routes through `formatMoney`, so nothing can
 * render `NaN`.
 */

const PACE_META: Record<
  BurnRate['pace'],
  { label: string; badge: string; bar: string; Icon: typeof TrendingUp; sr: string }
> = {
  under: {
    label: 'Under pace',
    badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
    bar: 'bg-emerald-400/80',
    Icon: TrendingDown,
    sr: 'You are spending slower than your daily budget — projected to finish under budget.',
  },
  on: {
    label: 'On pace',
    badge: 'border-gold-400/40 bg-gold-400/10 text-gold-300',
    bar: 'bg-gold-400/80',
    Icon: Minus,
    sr: 'You are spending right around your daily budget — projected to finish close to budget.',
  },
  over: {
    label: 'Over pace',
    badge: 'border-red-400/40 bg-red-400/10 text-red-300',
    bar: 'bg-red-400/80',
    Icon: TrendingUp,
    sr: 'You are spending faster than your daily budget — projected to finish over budget.',
  },
};

export default function BurnRateView({
  budgetHome,
  spentHome,
  home,
  now,
}: {
  budgetHome: number;
  spentHome: number;
  home: CurrencyCode;
  /** The resolved clock instant (`getNow()`, incl. the `?today=` override) — passed IN so the math stays pure. */
  now: Date;
}) {
  const prefersReducedMotion = useReducedMotion();
  // Recompute only when an input actually changes. `now` is a fresh Date each render under a live
  // clock, so key the memo off its day-stamp (the only part the math uses) to avoid needless churn.
  const dayStamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const b = useMemo(
    () => burnRate(budgetHome, spentHome, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetHome, spentHome, dayStamp],
  );

  // Nothing meaningful to show until a budget is set — keep the panel calm (the SpentRemaining
  // rows + grand total already cover the "no budget" case). The burn-rate view is about pace vs a plan.
  if (b.budgetHome <= 0) return null;

  const notStarted = b.daysElapsed === 0;
  const pace = PACE_META[b.pace];
  // Clamp the BAR to [0,100] (the underlying number can exceed 100% when over budget — the badge/copy
  // carries that; a bar can't render past full). Round for the visible text equivalent.
  const barPct = Math.min(100, Math.max(0, Math.round(b.percentSpent * 100)));
  const spentPctText = Math.round(b.percentSpent * 100);

  return (
    <div
      data-testid="burn-rate"
      className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      {/* Header + pace badge */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-white sm:text-base">Spending pace</h3>
        </div>
        <span
          data-testid="burn-rate-pace"
          data-pace={b.pace}
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${pace.badge}`}
        >
          <pace.Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {notStarted ? 'Not started' : pace.label}
        </span>
      </div>

      {notStarted ? (
        <p data-testid="burn-rate-not-started" className="text-sm text-white/60">
          Your trip hasn’t started yet. Once you’re travelling, this shows how your daily spending
          compares to your{' '}
          <span className="font-semibold text-white/80">{formatMoney(b.dailyBudget, home)}</span>/day
          budget and projects your end-of-trip total.
        </p>
      ) : (
        <>
          {/* Spent-vs-budget progress bar with a text equivalent. */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-white/60">
                Spent{' '}
                <span className="font-semibold text-white/90" data-testid="burn-rate-spent">
                  {formatMoney(b.spentHome, home)}
                </span>{' '}
                of {formatMoney(b.budgetHome, home)}
              </span>
              <span className="font-semibold text-white/70" data-testid="burn-rate-percent">
                {spentPctText}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={barPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Budget spent: ${spentPctText}% of ${formatMoney(b.budgetHome, home)}`}
              className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
            >
              <div
                className={`h-full rounded-full ${pace.bar} ${prefersReducedMotion ? '' : 'transition-[width] duration-500 ease-out'}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
          </div>

          {/* The figures. F9: the whole 4-figure grid is NO LONGER an aria-live region (announcing
              4 numbers on every currency toggle / expense was spam). The single meaningful summary
              — the worded pace badge above — carries aria-live instead, so only "Under/On/Over pace"
              is announced on a change. */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure
              testId="burn-rate-days"
              icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
              label="Trip progress"
              value={`Day ${b.daysElapsed} / ${b.daysTotal}`}
              sub={`${b.daysRemaining} ${b.daysRemaining === 1 ? 'day' : 'days'} left`}
            />
            <Figure
              testId="burn-rate-daily-avg"
              label="Daily average"
              value={formatMoney(b.dailyAvgSpent, home)}
              sub={`Budget ${formatMoney(b.dailyBudget, home)}/day`}
            />
            <Figure
              testId="burn-rate-projected"
              label="Projected total"
              value={formatMoney(b.projectedTotalHome, home)}
              sub="at this pace"
            />
            <Figure
              testId="burn-rate-remaining"
              label={b.remainingHome < 0 ? 'Over budget by' : 'Left to spend'}
              value={formatMoney(Math.abs(b.remainingHome), home)}
              sub={b.remainingHome < 0 ? 'above budget' : `of ${formatMoney(b.budgetHome, home)}`}
              tone={b.remainingHome < 0 ? 'over' : 'default'}
            />
          </dl>

          {/* Screen-reader-only plain-language pace summary (the visible badge is the sighted cue). */}
          <p className="sr-only" data-testid="burn-rate-pace-sr">
            {pace.sr}
          </p>
        </>
      )}
    </div>
  );
}

/** One labelled figure in the burn-rate grid (a `<div>` term/description pair). */
function Figure({
  testId,
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  testId: string;
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'over';
}) {
  // Wrapped in a <div> group inside the parent <dl> (an allowed dl grouping element). The <div>
  // may ONLY contain <dt>/<dd> — so the supplementary `sub` is a SECOND <dd> (multiple descriptions
  // for one term are valid), NOT a <p> (axe `definition-list`: a <p> directly inside the group is a
  // serious violation — surfaced by the in-app axe scan).
  return (
    <div className="rounded-lg border border-white/10 bg-navy-900/40 p-3">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/55">
        {icon && <span className="text-white/40">{icon}</span>}
        {label}
      </dt>
      <dd
        data-testid={testId}
        className={`mt-1 text-base font-semibold ${tone === 'over' ? 'text-red-300' : 'text-white'}`}
      >
        {value}
      </dd>
      {sub && <dd className="mt-0.5 text-[11px] text-white/55">{sub}</dd>}
    </div>
  );
}
