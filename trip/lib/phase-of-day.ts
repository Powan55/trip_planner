import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';
import { sortItemsByTime } from '@/lib/sort-items-by-time';

/**
 * — phase-of-day grouping for the planner's day-detail list. Pure, presentation-only
 * — no clock read, no store write.
 *
 * ── ordering ─────────────────────────────────────────────────────────────
 * The day's rows are CHRONOLOGICAL (owner-instructed). Before classifying anything this
 * module runs the items through `sortItemsByTime`, the app's one chronological projection:
 * timed items ascend by their ABSOLUTE INSTANT (not raw wall clock — a day can hold items
 * in two zones, and 2027-01-09 crosses the date line), untimed items sink to a single
 * trailing run preserving their own relative order, and equal instants keep their stored
 * order (the sort is stable). That is why this module needs the day's date and place
 * offset: they are `sortItemsByTime`'s inputs, and there is deliberately no second
 * time-math path here.
 *
 * This replaces the earlier stored-order rule, under which a day holding a 3pm plan before
 * a 10am one printed an "Afternoon" header and then rendered the 10am plan beneath it —
 * the morning plan filed under the afternoon. Ordering stays VIEW-LEVEL: this function is
 * pure, returns a new array, and never writes the store, so the persisted manual order
 * remains the persisted truth. Drag-and-drop consequently governs only the untimed
 * ("Anytime") run; the calendar disables the grip on a timed row rather than letting a
 * drag snap back.
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

const PHASE_RANK: Record<DayPhase, number> = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };

export interface PhaseGroupedItem<T extends ItineraryItem = ItineraryItem> {
  item: T;
  phase: DayPhase;
  /** True when this item's phase rank is higher than the last-headed rank (or is first) —
   * the render layer shows a phase header exactly when this is true.
   *
   * 🔴 STILL LOAD-BEARING after the move to chronological order. The sort key is the
   * absolute INSTANT, so a day crossing time zones can be in perfect chronological order
   * while its WALL CLOCKS run backwards (the 2027-01-09 Tokyo→Detroit day reads 17:35 JST
   * then 15:35 EST). That item's phase rank drops, and a rank-blind rule would print
   * "Afternoon" a second time below "Evening". The monotonic guard is what keeps each
   * header appearing at most once, with every row's own time chip still correct. */
  isNewPhase: boolean;
}

/**
 * Groups `items` for display, in chronological order (see the module note): timed items
 * ascend by absolute instant, untimed items form one trailing "anytime" run preserving
 * their own relative order, and ties keep stored order. `isNewPhase` marks where a header
 * belongs. Pure — a new array, and the input is never mutated.
 *
 * `dayDate` is the day the items sit on (`DayPlan.date`) and `dayOffsetMin` its place
 * offset (`offsetForCountry(plan.country)`) — both required, because an instant-accurate
 * sort cannot be done without them and a wall-clock fallback would silently mis-order a
 * date-line day.
 */
export function groupItemsByPhase<T extends ItineraryItem>(
  items: T[],
  dayDate: string,
  dayOffsetMin: number,
): PhaseGroupedItem<T>[] {
  // `sortItemsByTime` is typed on the base `ItineraryItem`; it only ever reads fields and
  // returns members of the array it was given, so the element type survives the round trip.
  const ordered = sortItemsByTime(items, dayDate, dayOffsetMin) as T[];

  let lastHeadedRank = -1;
  return ordered.map((item) => {
    const phase = phaseOfItem(item);
    const rank = PHASE_RANK[phase];
    const isNewPhase = rank > lastHeadedRank;
    if (isNewPhase) lastHeadedRank = rank;
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
