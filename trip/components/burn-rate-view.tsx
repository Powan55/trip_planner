'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, CalendarClock } from 'lucide-react';
import { formatMoney, type CurrencyCode } from '@/core/budget/model';
import { burnRate, type BurnRate } from '@/core/budget/burn-rate';

/**
 * Burn-rate view. Renders how fast the trip is spending vs the plan:
 * a spent-vs-budget track, days elapsed/remaining in the trip window, the daily average vs
 * the daily budget, the projected end-of-trip total, and an under/on/over indicator.
 *
 * ── Why it takes props, not its own hook (the seam discipline) ──────────────────────────────
 * This is a PRESENTATIONAL sub-component rendered by `components/budget-panel.tsx`, fed the panel's
 * ALREADY-LIVE home-currency totals (`budgetHome`/`spentHome` from its existing
 * `rollUp(model, expensesToSpent(expenses))`) plus the resolved clock instant (`now`) and the home
 * currency. It adds NO second budget/expense load — so it stays perfectly in lockstep with the panel
 * (a currency toggle or a logged expense re-renders the panel, which re-renders this with fresh
 * props). All the math is the pure `core/budget/burn-rate.ts`; this file is
 * display only and TOTAL by construction (the core never returns `NaN`).
 *
 * ── The marks ───────────────────────────────────────────────────────────────────────────────
 * FILLED means committed, UNFILLED means not yet. With no budget set the whole reading is
 * unfilled, so it draws HOLLOW at full size rather than disappearing behind a sentence —
 * the track, the four cells and the condition in words are all still there, which is what tells
 * you what setting a budget would buy you.
 *
 * ── a11y / house style ──────────────────────────────────────────────────────────────────────
 * The track is a real `role="progressbar"` with `aria-valuenow/min/max` AND a visible "N% spent"
 * text equivalent (never colour-only). The pace indicator carries both a colour and a WORD
 * ("Under / On / Over pace") + an icon, so it reads without colour perception. The pace sits in an
 * `aria-live="polite"` region so a change is announced when a currency toggle or a new expense
 * moves it. There is no width transition to fork: the track is drawn, not animated. Every number
 * routes through `formatMoney`, so nothing can render `NaN`.
 */

const PACE_META: Record<
  BurnRate['pace'],
  { label: string; badge: string; Icon: typeof TrendingUp; sr: string }
> = {
  under: {
    label: 'Under pace',
    badge: 'text-emerald-300 border-emerald-400/60',
    Icon: TrendingDown,
    sr: 'You are spending slower than your daily budget — projected to finish under budget.',
  },
  on: {
    label: 'On pace',
    badge: 'chip--struck',
    Icon: Minus,
    sr: 'You are spending right around your daily budget — projected to finish close to budget.',
  },
  over: {
    label: 'Over pace',
    badge: 'text-[color:hsl(var(--destructive))] border-[color:hsl(var(--destructive))]',
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
  // Recompute only when an input actually changes. `now` is a fresh Date each render under a live
  // clock, so key the memo off its day-stamp (the only part the math uses) to avoid needless churn.
  const dayStamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const b = useMemo(
    () => burnRate(budgetHome, spentHome, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetHome, spentHome, dayStamp],
  );

  const unset = b.budgetHome <= 0;
  const notStarted = b.daysElapsed === 0;
  const pace = PACE_META[b.pace];
  // Clamp the track to [0,100] (the underlying number can exceed 100% when over budget — the
  // mark/copy carries that; a track cannot render past full). Round for the text equivalent.
  const barPct = unset ? 0 : Math.min(100, Math.max(0, Math.round(b.percentSpent * 100)));
  const spentPctText = unset ? 0 : Math.round(b.percentSpent * 100);

  return (
    <div
      data-testid="burn-rate"
      className="mt-6 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[color:hsl(var(--border))] px-gut py-2">
        <h3 className="pr pr--l text-ink-hi">Spending pace</h3>
        <span
          data-testid="burn-rate-pace"
          data-pace={b.pace}
          aria-live="polite"
          className={unset ? 'hollow-tag' : `chip ${pace.badge}`}
        >
          {!unset && <pace.Icon className="h-3 w-3" aria-hidden="true" />}
          {unset ? 'No budget set' : notStarted ? 'Not started' : pace.label}
        </span>
      </div>

      <div className="px-gut py-3">
        {/* Spent-vs-budget track with a text equivalent. Capped at 260px by `.fill`, so the
            UNFILLED remainder is always visible — a bar with no visible remainder stops being a
            reading and becomes an underline. */}
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 font-machine text-t-sm">
          <span className="text-ink-mid">
            Spent{' '}
            <span className="num text-ink-hi" data-testid="burn-rate-spent">
              {formatMoney(b.spentHome, home)}
            </span>{' '}
            of {formatMoney(b.budgetHome, home)}
          </span>
          <span className="num text-ink-mid" data-testid="burn-rate-percent">
            {spentPctText}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={barPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Budget spent: ${spentPctText}% of ${formatMoney(b.budgetHome, home)}`}
          className="fill"
        >
          <i
            style={
              unset
                ? {
                    width: '100%',
                    // hollow: hatched to the full width, so the shape of the reading is there
                    // at the size it will be while nothing about it is yet committed.
                    background:
                      'repeating-linear-gradient(90deg, var(--text-lo) 0 3px, transparent 3px 6px)',
                  }
                : { width: `${barPct}%` }
            }
          />
        </div>

        {/* The figures. The whole grid is NOT an aria-live region (announcing 4 numbers on every
            currency toggle / expense was spam). The single meaningful summary — the worded pace
            mark above — carries aria-live instead. */}
        <dl className="cells cells--4 mt-4">
          <Figure
            testId="burn-rate-days"
            icon={<CalendarClock className="h-3 w-3" aria-hidden="true" />}
            label="Trip progress"
            value={`Day ${b.daysElapsed} / ${b.daysTotal}`}
            sub={`${b.daysRemaining} ${b.daysRemaining === 1 ? 'day' : 'days'} left`}
          />
          <Figure
            testId="burn-rate-daily-avg"
            label="Daily average"
            value={formatMoney(b.dailyAvgSpent, home)}
            sub={`Budget ${formatMoney(b.dailyBudget, home)}/day`}
            hollow={unset}
          />
          <Figure
            testId="burn-rate-projected"
            label="Projected total"
            value={formatMoney(b.projectedTotalHome, home)}
            sub="at this pace"
            hollow={unset}
          />
          <Figure
            testId="burn-rate-remaining"
            label={b.remainingHome < 0 ? 'Over budget by' : 'Left to spend'}
            value={formatMoney(Math.abs(b.remainingHome), home)}
            sub={b.remainingHome < 0 ? 'above budget' : `of ${formatMoney(b.budgetHome, home)}`}
            hollow={unset}
          />
        </dl>

        {/* The condition, always stated in words — the mark is never the sole cue. */}
        {unset ? (
          <p className="empty mt-4" data-testid="burn-rate-unset">
            No budget is set for either leg, so there is no pace to read yet. Set one on the Budget
            tab and this fills in against it.
          </p>
        ) : notStarted ? (
          <p className="empty mt-4" data-testid="burn-rate-not-started">
            The trip has not started. Once you are travelling this reads your daily spending against
            the {formatMoney(b.dailyBudget, home)}/day budget and projects the end-of-trip total.
          </p>
        ) : (
          /* Screen-reader-only plain-language pace summary (the visible mark is the sighted cue). */
          <p className="sr-only" data-testid="burn-rate-pace-sr">
            {pace.sr}
          </p>
        )}
      </div>
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
  hollow = false,
}: {
  testId: string;
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  hollow?: boolean;
}) {
  // Wrapped in a <div> group inside the parent <dl> (an allowed dl grouping element). The <div>
  // may ONLY contain <dt>/<dd> — so the supplementary `sub` is a SECOND <dd> (multiple descriptions
  // for one term are valid), NOT a <p> (axe `definition-list`: a <p> directly inside the group is a
  // serious violation). Hollow drops the TIER and keeps opacity 1 — dimming a figure hides it.
  return (
    <div className={hollow ? 'cell is-hollow' : 'cell'}>
      <dt className="l !flex items-center gap-1.5">
        {icon}
        {label}
      </dt>
      <dd data-testid={testId} className="v">
        {value}
      </dd>
      {sub && <dd className="f">{sub}</dd>}
    </div>
  );
}
