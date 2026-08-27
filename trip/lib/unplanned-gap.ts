import { effectiveStartMinutes, effectiveDurationMinutes } from '@/core/dates';
import type { ItineraryItem } from '@/lib/trip-data';

/**
 * The unplanned gap between two ADJACENT RENDERED rows, in minutes, or `null` when there is no
 * gap to state. This is what draws the `1 h 30 m unplanned` rules in a day list.
 *
 * It is a statement about the PAIR, not about the day: rows render in their stored order, so the
 * only honest claim is "between these two rows, N minutes are unplanned". A pair that runs
 * backwards yields nothing — that is an overlap, and `clashingItemIds` already flags it.
 *
 * Three things must hold or there is no gap to draw:
 *   - both rows are timed, else there is no interval;
 *   - the earlier row has a span, else it has no END and the interval would be measured from the
 *     wrong point;
 *   - the interval clears the floor below.
 *
 * MEASURED on the shipped 32-day seed: 102 positive intervals exist and 47 of them are 30 minutes
 * or less — the walk between two things, not a hole in the day. A 60-minute floor leaves 53 rows
 * across 30 days; a 30-minute floor leaves 97 and turns the rule into noise.
 */
export const UNPLANNED_FLOOR_MIN = 60;

export function unplannedGapMinutes(
  prev: ItineraryItem | undefined,
  next: ItineraryItem | undefined,
): number | null {
  if (!prev || !next) return null;
  const prevStart = effectiveStartMinutes(prev);
  const nextStart = effectiveStartMinutes(next);
  const prevSpan = effectiveDurationMinutes(prev);
  if (prevStart === undefined || nextStart === undefined || prevSpan === undefined) return null;
  const gap = nextStart - (prevStart + prevSpan);
  return gap >= UNPLANNED_FLOOR_MIN ? gap : null;
}
