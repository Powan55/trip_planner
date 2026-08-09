import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveOffsetMin, effectiveStartMinutes, placeWallClockToUtcMs } from '@/core/dates';

/**
 * — the two passive, non-destructive time VIEWS (; follow-on
 * to). Pure, view-level only: NEVER writes the store, NEVER reorders the
 * calendar's manually-dragged persisted order. Reuses `effectiveStartMinutes`
 * as the ONE sort key / clash gate — no new parsing/offset math here.
 */

/**
 * A stable chronological projection of `items`, by ABSOLUTE INSTANT. Items with a
 * defined `effectiveStartMinutes` ascend by their UTC instant; untimed items (`undefined`)
 * sink to the end, PRESERVING their original relative order (native `Array.prototype.sort`
 * is stable in every engine this app targets — a comparator that treats `undefined` as
 * +Infinity is sufficient). Returns a NEW array; the input is never mutated.
 *
 * — the key is the INSTANT, not the wall clock. A day can contain items in different
 * zones, and on 2027-01-09 it contains a date-line crossing:
 * the Detroit layover reads 15:35 (EST) while the Tokyo flight that produces it reads 17:35
 * (JST), so a wall-clock key rendered the traveller arriving before they left. `dayDate` +
 * `dayOffsetMin` (the day's country offset, the fallback for items with no override) resolve
 * each item through the SAME `placeWallClockToUtcMs` used by every other instant consumer —
 * no second time-math path, and date rollover comes free from its `Date.UTC` field form.
 *
 * NOTE: the DISPLAYED times on such a day are then
 * correctly ordered but visually non-monotonic (17:35 → 15:35 → 21:35) with nothing on screen
 * explaining why. Accepted cost; a per-item zone affordance is an owner decision, not this fn's.
 */
export function sortItemsByTime(
  items: ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
): ItineraryItem[] {
  const key = (item: ItineraryItem): number => {
    const min = effectiveStartMinutes(item);
    if (min === undefined) return Infinity; // untimed → sinks, stably
    return placeWallClockToUtcMs(dayDate, min, effectiveOffsetMin(item, dayOffsetMin));
  };
  return [...items].sort((a, b) => key(a) - key(b));
}

/**
 * The set of item ids that overlap at least one other item's timed span, per
 * half-open rule: only items with a defined `effectiveStartMinutes` AND a positive
 * `durationMinutes` are considered; two such items clash iff
 * `a.start < b.end && b.start < a.end` — touching edges (one item's end exactly equals
 * another's start) never clash. Pure, order-independent — never writes.
 *
 * (TD-07) — the overlap is judged on the ABSOLUTE INSTANT, exactly like this file's
 * `sortItemsByTime` has been since. Two items on one day can sit in different zones
 *, and a raw wall-clock comparison then answers "when" in a
 * frame that does not exist: two 09:00 items 14 hours apart read as a clash, and the Jan-9
 * Tokyo flight that genuinely overlaps its Detroit layover reads as disjoint. `dayDate` +
 * `dayOffsetMin` resolve each item through the SAME `placeWallClockToUtcMs` every other
 * instant consumer uses — no second time-math path here. (Latent until items carry
 * `durationMinutes`: 0 of the 158 seed items do.)
 *
 * — MULTI-DAY SPANS ARE EXCLUDED (clash v1): an item carrying an `endDate` is a
 * multi-day span (the field is only ever written strictly after the item's start day, so
 * its presence means "genuine span"). Its clock-time overlap with a same-day timed item
 * is not a meaningful conflict (a hotel stay "overlapping" a dinner is expected), so spans
 * are simply dropped before the pairwise check — no cross-day clash math in v1.
 */
export function clashingItemIds(
  items: ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
): Set<string> {
  const timed = items
    .map((item) => {
      if (item.endDate) return null; // spans are excluded from clash v1
      const min = effectiveStartMinutes(item);
      const dur = item.durationMinutes;
      if (typeof min !== 'number' || typeof dur !== 'number' || dur <= 0) return null;
      const start = placeWallClockToUtcMs(dayDate, min, effectiveOffsetMin(item, dayOffsetMin));
      return { id: item.id, start, end: start + dur * 60000 };
    })
    .filter((x): x is { id: string; start: number; end: number } => x !== null);

  const clashing = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.start < b.end && b.start < a.end) {
        clashing.add(a.id);
        clashing.add(b.id);
      }
    }
  }
  return clashing;
}
