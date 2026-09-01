import {
  effectiveStartMinutes,
  effectiveDurationMinutes,
  effectiveOffsetMin,
  placeWallClockToUtcMs,
} from '@/core/dates';
import { sortItemsByTime } from '@/lib/sort-items-by-time';
import type { ItineraryItem } from '@/lib/trip-data';

/**
 * The unplanned gap between two rows that are ADJACENT IN TIME, in minutes, or `null` when there
 * is no gap to state. This is what draws the `1 h 30 m unplanned` rules in a day list.
 *
 * It is a statement about the PAIR: "between these two rows, N minutes are unplanned". A pair that
 * runs backwards yields nothing — that is an overlap, and `clashingItemIds` already flags it.
 *
 * Measured on the ABSOLUTE INSTANT, through the same `placeWallClockToUtcMs` +
 * `effectiveOffsetMin` every other instant consumer uses — a day can hold rows in another zone
 * (the Jan-9 Detroit layover reads 15:35 beside a 17:35 JST flight), and a wall-clock subtraction
 * answers "how long is free" in a frame that does not exist.
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
  dayDate: string,
  dayOffsetMin: number,
): number | null {
  if (!prev || !next) return null;
  const prevStart = effectiveStartMinutes(prev);
  const nextStart = effectiveStartMinutes(next);
  const prevSpan = effectiveDurationMinutes(prev);
  if (prevStart === undefined || nextStart === undefined || prevSpan === undefined) return null;
  const startUtc = (it: ItineraryItem, min: number) =>
    placeWallClockToUtcMs(dayDate, min, effectiveOffsetMin(it, dayOffsetMin));
  const gap = (startUtc(next, nextStart) - (startUtc(prev, prevStart) + prevSpan * 60000)) / 60000;
  return gap >= UNPLANNED_FLOOR_MIN ? gap : null;
}

/**
 * The day's unplanned rules, keyed by the id of the row the rule is drawn ABOVE.
 *
 * Stored order is not chronological — `crud.ts` appends and the sync merge orders by HLC, so an
 * 11:00 row added to a day holding 09:00 and 14:00 lands last. Pairing RENDERED neighbours then
 * claims a four-hour hole the 11:00 row already fills. The gap is measured against
 * `sortItemsByTime`, the app's one chronological projection (pure, sinks untimed rows stably,
 * resolves each row's own offset) — the stored and rendered order are not touched.
 *
 * ACCEPTED CONSEQUENCE: when stored and chronological order disagree, the rule is drawn above the
 * row that chronologically FOLLOWS the gap, which may not be the row directly below it on screen.
 */
export function unplannedGapsByItemId(
  items: ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
): Map<string, number> {
  const sorted = sortItemsByTime(items, dayDate, dayOffsetMin);
  const gaps = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = unplannedGapMinutes(sorted[i - 1], sorted[i], dayDate, dayOffsetMin);
    if (gap !== null) gaps.set(sorted[i].id, gap);
  }
  return gaps;
}
