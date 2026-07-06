/**
 * Trip burn-rate + per-day spend bucketing (the CORE).
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no storage. The impurity (reading the clock / resolving `?today=`) stays
 * in the caller (the budget panel via `getTodayInTrip()` / `getNow()`), which passes `now` and the
 * already-computed home totals IN. Every function is TOTAL (a bad / NaN / negative / missing input
 * degrades to a safe number, never a throw), so the burn-rate view can never render `NaN` and a
 * corrupt expense slot can never crash the overlay. `import type` from `./expenses` (the `Expense`
 * shape) drags no runtime in; the runtime `import` of `TRIP_DATES`/`TRIP_START`/`TRIP_END` from
 * `@/core/dates` is a core→core dependency (the SAME date backbone the itinerary + clock use), so
 * the trip window stays configured in ONE place rather than hard-coded here.
 *
 * ── What this consumes (the budget + expenses seams — no reshape) ───────────────────────────
 * The budget model's `rollUp(model, spent)` already returns `totalBudgetHome` / `totalSpentHome`
 * in the home currency; the budget panel computes it live off the reactive `model` + `useExpenses()`.
 * This module's `burnRate(budgetHome, spentHome, now)` takes those two home-currency figures + the
 * clock instant and derives the TIME dimension: how far into the trip we are, the daily average vs the
 * daily budget, the projected end-of-trip total at the current pace, and an under/on/over indicator.
 * `expensesByDate(expenses)` buckets the raw `Expense[]` into leg-local per-day sums for the
 * calendar cost overlay (undated expenses are excluded from the per-day map but still count in the
 * leg/total spend that `rollUp` reports — the two views agree on the total, differ only on "which
 * day").
 *
 * ── daysElapsed derivation (the judgment call) ──────────────────────────────────────────────
 * `daysElapsed` is an INCLUSIVE calendar-day count from the trip's first day up to and including the
 * day `now` falls on, clamped to `[0, daysTotal]`:
 *   - strictly before the trip (now < the first trip day)      → 0   (the trip hasn't started)
 *   - on trip day K (1-based, e.g. Dec 9 = day 1, Dec 12 = 4)  → K
 *   - on/after the last trip day                                → daysTotal (32; the trip is done)
 * Inclusive because on the morning of Day 1 you have already had one day of the trip to spend on, so
 * `dailyAvgSpent = spentHome / daysElapsed` is well-defined (÷1, not ÷0) and reads honestly from the
 * very first day. The diff is computed from LOCAL date parts (matching `core/dates`' local-noon
 * convention) so it never slips at a timezone edge. This is unit-tested at every boundary below.
 */

import type { Expense } from '@/core/budget/expenses';
import { TRIP_DATES, TRIP_START, TRIP_END } from '@/core/dates';
import { safeAmount } from '@/core/budget/model';

/** The trip length in inclusive days — derived from the single date backbone, currently 32. */
const DAYS_TOTAL = TRIP_DATES.length;

/** ±5% of the budget is treated as "on pace" — a small band so a near-exact projection reads "on", not a hair over/under. */
const ON_TRACK_BAND = 0.05;

/**
 * The pure burn-rate summary in the home/display currency (what `BurnRateView` renders). Every field
 * is a finite, non-negative-or-signed-as-documented number — never `NaN`/`Infinity`.
 */
export interface BurnRate {
  /** Trip length in inclusive days (32) — the fixed denominator for the daily budget. */
  daysTotal: number;
  /** Inclusive days elapsed, clamped `[0, daysTotal]` — 0 before the trip, `daysTotal` after. */
  daysElapsed: number;
  /** `daysTotal − daysElapsed` — days of the trip still ahead (0 once the trip is over). */
  daysRemaining: number;
  /** Fraction of the trip elapsed, `0..1` (`daysElapsed / daysTotal`). */
  percentElapsed: number;
  /** The home-currency budget (from `rollUp().totalBudgetHome`), sanitized. */
  budgetHome: number;
  /** The home-currency spend so far (from `rollUp().totalSpentHome`), sanitized. */
  spentHome: number;
  /** `budgetHome − spentHome` (signed — negative once over budget, matching `rollUp`'s remaining). */
  remainingHome: number;
  /** Fraction of the budget spent, `0..1+` for display (clamp the BAR at 1; the number can exceed it). */
  percentSpent: number;
  /** The even daily allowance: `budgetHome / daysTotal` (0 when no budget is set). */
  dailyBudget: number;
  /** The realised daily pace: `spentHome / daysElapsed` (0 before the trip, when nothing has elapsed). */
  dailyAvgSpent: number;
  /** The "at this pace" end-of-trip total: `dailyAvgSpent * daysTotal` (0 before the trip). */
  projectedTotalHome: number;
  /** Projected total vs budget, with the ±5% on-track band: 'under' | 'on' | 'over'. */
  pace: 'under' | 'on' | 'over';
}

/**
 * Local-date-parts diff → the INCLUSIVE trip-day count for `now`, clamped `[0, daysTotal]`.
 *
 * Uses LOCAL calendar parts (year/month/date) on both ends — matching `core/dates`' local-noon
 * anchoring — so a `?today=` override (resolved to local noon) and the trip bounds compare on the
 * same footing and never slip a day at a timezone edge. Not `Date`-subtraction of raw ms (that would
 * be sensitive to the time-of-day component); we snap both to midnight-of-the-local-day first.
 */
function elapsedInclusiveDays(now: Date): number {
  // Guard a bad `now` (Invalid Date / non-Date) → treat as "before the trip" (0 elapsed).
  const t = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(t)) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  // Midnight of the local day for each end (drops the time-of-day so the diff is whole days).
  const startDay = Date.UTC(TRIP_START.getFullYear(), TRIP_START.getMonth(), TRIP_START.getDate());
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = Date.UTC(TRIP_END.getFullYear(), TRIP_END.getMonth(), TRIP_END.getDate());

  if (nowDay < startDay) return 0; // strictly before the trip
  if (nowDay >= endDay) return DAYS_TOTAL; // on/after the last trip day

  // Inclusive: day 1 (the start day) → 1, so (nowDay − startDay) whole days + 1.
  const diff = Math.floor((nowDay - startDay) / dayMs) + 1;
  // Clamp defensively (the branches above already bound it, but keep it total).
  return Math.min(DAYS_TOTAL, Math.max(0, diff));
}

/**
 * The burn-rate summary for a given budget, spend, and clock instant. PURE + TOTAL.
 *
 * @param budgetHome  home-currency total budget (`rollUp().totalBudgetHome`) — sanitized to ≥0.
 * @param spentHome   home-currency total spend  (`rollUp().totalSpentHome`)  — sanitized to ≥0.
 * @param now         the resolved clock instant (`getNow()`, incl. the `?today=` override).
 *
 * Budget-0 safety: with no budget set, `dailyBudget`/`percentSpent` are 0 and `pace` is 'on' when
 * nothing is spent, 'over' the instant any spend exists (you're over a zero budget) — never a divide
 * -by-zero. Pre-trip (`daysElapsed === 0`): `dailyAvgSpent`/`projectedTotalHome` are 0 and `pace` is
 * 'under' (no realised burn yet), so the view can show a calm "trip hasn't started" state.
 */
export function burnRate(budgetHome: unknown, spentHome: unknown, now: Date): BurnRate {
  const budget = safeAmount(budgetHome);
  const spent = safeAmount(spentHome);
  const daysElapsed = elapsedInclusiveDays(now);
  const daysRemaining = DAYS_TOTAL - daysElapsed;
  const percentElapsed = DAYS_TOTAL > 0 ? daysElapsed / DAYS_TOTAL : 0;

  const dailyBudget = DAYS_TOTAL > 0 ? budget / DAYS_TOTAL : 0;
  // Realised pace only once at least one day has elapsed (÷0 guarded → 0 pre-trip).
  const dailyAvgSpent = daysElapsed > 0 ? spent / daysElapsed : 0;
  const projectedTotalHome = dailyAvgSpent * DAYS_TOTAL;

  const percentSpent = budget > 0 ? spent / budget : 0;

  // Pace: compare the projected end-of-trip total to the budget with a small symmetric band.
  //  - no budget: 'on' while nothing is spent, 'over' once anything is (over a zero budget).
  //  - otherwise: within ±band of the budget → 'on'; below → 'under'; above → 'over'.
  let pace: BurnRate['pace'];
  if (budget <= 0) {
    pace = spent > 0 ? 'over' : 'on';
  } else {
    const upper = budget * (1 + ON_TRACK_BAND);
    const lower = budget * (1 - ON_TRACK_BAND);
    if (projectedTotalHome > upper) pace = 'over';
    else if (projectedTotalHome < lower) pace = 'under';
    else pace = 'on';
  }

  return {
    daysTotal: DAYS_TOTAL,
    daysElapsed,
    daysRemaining,
    percentElapsed,
    budgetHome: budget,
    spentHome: spent,
    remainingHome: budget - spent,
    percentSpent,
    dailyBudget,
    dailyAvgSpent,
    projectedTotalHome,
    pace,
  };
}

/**
 * Per-day spend buckets: sum each DATED expense's leg-local amount by its `'YYYY-MM-DD'` date.
 * PURE + TOTAL.
 *
 * Amounts are already leg-local and a single calendar day is one leg, so a day's bucket is a
 * plain sum in that day's currency — no conversion (the calendar overlay formats it with the day's
 * `legCurrency`). Undated expenses are EXCLUDED (they have no day to attribute to) — they still count
 * in the leg/total spend that `rollUp` reports, so the burn-rate total and the sum of the per-day
 * buckets can legitimately differ by the undated amount. A malformed / 0 / negative amount contributes
 * nothing; a bad date string is ignored. Returns a plain object keyed by the ISO date (empty when no
 * dated expense exists).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function expensesByDate(expenses: readonly Expense[] | null | undefined): Record<string, number> {
  const byDate: Record<string, number> = {};
  if (!Array.isArray(expenses) || expenses.length === 0) return byDate;

  for (const e of expenses) {
    // Defensive on a runtime-untyped list (a corrupt slot could smuggle a bad entry past the type).
    if (e === null || typeof e !== 'object') continue;
    const date = e.date;
    if (typeof date !== 'string' || !DATE_RE.test(date)) continue; // undated / bad date → excluded
    const amount = safeAmount(e.amount);
    if (amount <= 0) continue; // a 0/negative/bad amount contributes nothing
    byDate[date] = (byDate[date] ?? 0) + amount;
  }

  return byDate;
}
