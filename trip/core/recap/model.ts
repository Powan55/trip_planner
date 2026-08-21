/**
 * Recap domain — the pure, framework-free plan-vs-actual day-recap core ( —
 * the second and final change of proposal #11's in-trip core).
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no storage. Every function is TOTAL (a bad / missing / corrupt input
 * degrades to a safe value, never a throw), so the recap island can never crash on a corrupt
 * plan/entry and can never render `undefined`. This mirrors the established core pattern
 * (`core/budget/*`, `core/journal/model.ts`).
 *
 * The recap has NO persisted domain of its own — it is a read-only DERIVATION over two
 * EXISTING localStorage domains.
 * Nothing here writes; nothing here reads a clock or storage. The clock read (resolving "now")
 * and the per-day plan/entry reads stay in the React component (the I/O boundary); these pure
 * functions take the already-resolved values as inputs.
 */

// type-only import — no runtime coupling to `lib/` (the crud.ts / expenses.ts precedent that
// keeps `core/` from depending on `lib/`, layering).
import type { ItineraryItem } from '@/lib/trip-data';
// core→core runtime import of the one trip-window source. `TRIP_DATES` is a static
// chronological `YYYY-MM-DD[]`, framework-free.
import { TRIP_DATES } from '@/core/dates';
// type-only import — the recap↔budget composition reads the `Expense` shape but never
// writes it (READ-ONLY over the budget/expense domain, same layering as the two imports above).
import type { Expense } from '@/core/budget/expenses';
// runtime core→core: the same active-pack leg guard `expensesToSpent`/`expensesByDate` use, so
// all three aggregates agree on which rows count.
import { isLeg } from '@/core/budget/model';

/**
 * The plan-vs-actual completion summary for a single day: how many activities were PLANNED and
 * how many are marked DONE.
 */
export interface PlanSummary {
  planned: number;
  done: number;
}

/**
 * Count a day's planned items + the subset marked done. TOTAL: a non-array / null / undefined
 * input yields `{ planned: 0, done: 0 }`; a bad entry (non-object / missing fields) counts as a
 * planned-but-not-done item is NOT assumed — only items that are objects count toward `planned`,
 * and `done` counts ONLY `item.done === true`. Never throws.
 */
export function summarizePlan(items: readonly ItineraryItem[] | null | undefined): PlanSummary {
  if (!Array.isArray(items)) return { planned: 0, done: 0 };
  let planned = 0;
  let done = 0;
  for (const item of items) {
    // Only real objects are countable activities; a corrupt (null / primitive) slot is skipped
    // entirely so the summary can never over-count or throw on a bad entry.
    if (item === null || typeof item !== 'object') continue;
    planned += 1;
    if ((item as ItineraryItem).done === true) done += 1;
  }
  return { planned, done };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The trip days that have already HAPPENED as of `nowDateStr` ('YYYY-MM-DD'): every date in
 * `TRIP_DATES` that is `<= nowDateStr`. For the fixed `YYYY-MM-DD` format a lexicographic string
 * compare IS chronological order (the same TZ-safe invariant `getCountryForDate` relies on), so
 * this needs no `Date` parsing.
 *
 * TOTAL:
 * - A non-string / malformed `nowDateStr` → `[]` (no day has "happened" under an unusable clock).
 * - Pre-trip (`nowDateStr` < the first trip date) → `[]` (nothing elapsed → the island renders null).
 * - Post-trip (`nowDateStr` >= the last trip date) → all 32 trip dates.
 *
 * The result preserves `TRIP_DATES`' chronological order (oldest-first); the component reverses it
 * for the most-recent-first display, keeping the ordering policy in the (impure) view, not here.
 */
export function elapsedTripDates(nowDateStr: string): string[] {
  if (typeof nowDateStr !== 'string' || !DATE_RE.test(nowDateStr)) return [];
  return TRIP_DATES.filter((date) => date <= nowDateStr);
}

/**
 * — has the WHOLE trip finished as of `nowDateStr`? True iff `nowDateStr` is a valid
 * 'YYYY-MM-DD' AND strictly AFTER the last `TRIP_DATES` entry (lexicographic ISO compare, same
 * TZ-safe invariant as `elapsedTripDates`). The last trip date itself is still an IN-TRIP day
 * (the trip isn't "over" until it's behind you), so the boundary is exclusive:
 * `isPostTrip('2027-01-09') === false` (trip end, still in-trip), `isPostTrip('2027-01-10') === true`.
 *
 * TOTAL: a non-string / malformed `nowDateStr` → `false` (an unusable clock is never "post-trip").
 */
export function isPostTrip(nowDateStr: string): boolean {
  if (typeof nowDateStr !== 'string' || !DATE_RE.test(nowDateStr)) return false;
  return nowDateStr > TRIP_DATES[TRIP_DATES.length - 1];
}

/**
 * — the recap's per-day spend line: sum of every logged expense whose `date` matches the
 * given trip day AND whose own `leg` matches `leg`, in that leg's currency. READ-ONLY derivation
 * over the expense domain — no write path reachable from here.
 *
 * `leg` IS THE FIX, not a convenience. A day belongs to one leg but an expense does not: the log
 * dialog lets you tap the other leg's chip while `date` stays pinned to the day you opened it on
 * ("paid for Japan while still in Nepal"), so `e.leg` and the day's leg are independent inputs.
 * Summing by date alone handed a ¥50,000 row to a Nepal day, where every caller formats the bucket
 * with the DAY's `legCurrency` and rendered it as "Rs 50,000" — and with rows from both legs on one
 * date it added NPR to JPY. Callers pass the leg they are about to format with, so the number and
 * the currency symbol can no longer disagree. Omitting `leg` sums every KNOWN-leg row for the date
 * (the pre-existing shape, still cross-currency — pass a leg unless you have no currency to print).
 *
 * A row whose leg the ACTIVE pack does not recognise contributes nothing, matching `expensesToSpent`
 * and `expensesByDate` — `sanitizeExpense` retains such a row verbatim, so every aggregate has to
 * exclude it or the recap and the budget disagree about which rows count.
 *
 * TOTAL: a non-array `expenses`, a corrupt entry (non-object), or a non-matching/undated expense
 * contributes 0; a bad/negative/non-finite `amount` also contributes 0. Never throws.
 */
export function sumExpensesForDate(
  expenses: readonly Expense[] | null | undefined,
  date: string,
  leg?: string,
): number {
  if (!Array.isArray(expenses)) return 0;
  let total = 0;
  for (const e of expenses) {
    if (e === null || typeof e !== 'object') continue;
    if (e.date !== date) continue;
    if (!isLeg(e.leg)) continue;
    if (leg !== undefined && e.leg !== leg) continue;
    const amt = e.amount;
    if (typeof amt === 'number' && Number.isFinite(amt) && amt > 0) total += amt;
  }
  return total;
}
