import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';

/**
 * — phase-of-day grouping for the planner's day-detail list. Pure, presentation-only
 * — no clock read, no store write.
 *
 * ── compatibility ────────────────────────────────────────────────────────
 * `sort-clash.spec.ts` asserts the CALENDAR view stays in STORED (manual/drag) order —
 * only the Home Timeline is chronologically sorted. So this
 * module does NOT re-sort timed items by start time; it only (a) classifies each item's
 * phase from its OWN time, so the render layer can insert a header wherever the phase
 * changes between two ADJACENT items in the existing stored order, and (b) moves untimed
 * ("anytime") items to a single TRAILING group, preserving their
 * relative order among themselves and never touching timed items' relative order. A day
 * of only-timed items (the sort-clash fixtures) is therefore returned byte-order-identical
 * to its input — the regression net stays green.
 */

export type DayPhase = 'morning' | 'afternoon' | 'evening' | 'anytime';

export const PHASE_LABELS: Record<DayPhase, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
};

/** Boundaries: Morning 05:00–11:59, Afternoon 12:00–16:59, Evening 17:00–04:59 (wraps
 * across midnight — late night reads as an evening continuation). Untimed => 'anytime'. */
export function phaseOfItem(item: ItineraryItem): DayPhase {
  const min = effectiveStartMinutes(item);
  if (min === undefined) return 'anytime';
  if (min >= 5 * 60 && min < 12 * 60) return 'morning';
  if (min >= 12 * 60 && min < 17 * 60) return 'afternoon';
  return 'evening';
}

export interface PhaseGroupedItem<T extends ItineraryItem = ItineraryItem> {
  item: T;
  phase: DayPhase;
  /** True when this item's phase differs from the previous rendered item's (or is first) —
   * the render layer shows a phase header exactly when this is true. */
  isNewPhase: boolean;
}

/**
 * Groups `items` for display: timed items keep their exact stored relative order (never
 * re-sorted —); untimed items are moved to one trailing "anytime" run, preserving
 * their own relative order. `isNewPhase` marks where a header belongs.
 */
export function groupItemsByPhase<T extends ItineraryItem>(items: T[]): PhaseGroupedItem<T>[] {
  const timed = items.filter((i) => phaseOfItem(i) !== 'anytime');
  const untimed = items.filter((i) => phaseOfItem(i) === 'anytime');
  const ordered = [...timed, ...untimed];

  let prevPhase: DayPhase | null = null;
  return ordered.map((item) => {
    const phase = phaseOfItem(item);
    const isNewPhase = phase !== prevPhase;
    prevPhase = phase;
    return { item, phase, isNewPhase };
  });
}

/** The earliest timed item in `items` by `effectiveStartMinutes`, or `null` if none is
 * timed. Used for the day-header glance pill's "first start" summary. Ties resolve to the
 * first in array order (stable). */
export function earliestTimedItem<T extends ItineraryItem>(items: T[]): T | null {
  let best: T | null = null;
  let bestMin = Infinity;
  for (const item of items) {
    const min = effectiveStartMinutes(item);
    if (min !== undefined && min < bestMin) {
      best = item;
      bestMin = min;
    }
  }
  return best;
}
