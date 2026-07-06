/**
 * Recap domain — the pure, framework-free plan-vs-actual day-recap core.
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no storage. Every function is TOTAL (a bad / missing / corrupt input
 * degrades to a safe value, never a throw), so the recap island can never crash on a corrupt
 * plan/entry and can never render `undefined`. This mirrors the established core pattern
 * (`core/budget/*`, `core/journal/model.ts`).
 *
 * The recap has NO persisted domain of its own — it is a read-only DERIVATION over two
 * EXISTING localStorage domains (the itinerary Vault's `done` state; the journal).
 * Nothing here writes; nothing here reads a clock or storage. The clock read (resolving "now")
 * and the per-day plan/entry reads stay in the React component (the I/O boundary); these pure
 * functions take the already-resolved values as inputs.
 */

// type-only import — no runtime coupling to `lib/` (the crud.ts / expenses.ts precedent that
// keeps `core/` from depending on `lib/`).
import type { ItineraryItem } from '@/lib/trip-data';
// core→core runtime import of the one trip-window source. `TRIP_DATES` is a static
// chronological `YYYY-MM-DD[]`, framework-free.
import { TRIP_DATES } from '@/core/dates';

/**
 * The plan-vs-actual completion summary for a single day: how many activities were PLANNED and
 * how many are marked DONE (`item.done === true`).
 */
export interface PlanSummary {
  planned: number;
  done: number;
}

/**
 * Count a day's planned items + the subset marked done. TOTAL: a non-array / null / undefined
 * input yields `{ planned: 0, done: 0 }`; a bad entry (non-object / missing fields) counts as a
 * planned-but-not-done item is NOT assumed — only items that are objects count toward `planned`,
 * and `done` counts ONLY `item.done === true` (absent/falsy = not done). Never throws.
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
 *  - A non-string / malformed `nowDateStr` → `[]` (no day has "happened" under an unusable clock).
 *  - Pre-trip (`nowDateStr` < the first trip date) → `[]` (nothing elapsed → the island renders null).
 *  - Post-trip (`nowDateStr` >= the last trip date) → all 32 trip dates.
 *
 * The result preserves `TRIP_DATES`' chronological order (oldest-first); the component reverses it
 * for the most-recent-first display, keeping the ordering policy in the (impure) view, not here.
 */
export function elapsedTripDates(nowDateStr: string): string[] {
  if (typeof nowDateStr !== 'string' || !DATE_RE.test(nowDateStr)) return [];
  return TRIP_DATES.filter((date) => date <= nowDateStr);
}
