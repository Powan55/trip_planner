import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';

/**
 * — the two passive, non-destructive time VIEWS (; follow-on
 * to). Pure, view-level only: NEVER writes the store, NEVER reorders the
 * calendar's manually-dragged persisted order. Reuses `effectiveStartMinutes`
 * as the ONE sort key / clash gate — no new parsing/offset math here.
 */

/**
 * A stable chronological projection of `items`, by `effectiveStartMinutes`. Items with a
 * defined value ascend by it; untimed items (`undefined`) sink to the end, PRESERVING
 * their original relative order (native `Array.prototype.sort` is stable in every engine
 * this app targets — a comparator that treats `undefined` as +Infinity is sufficient).
 * Returns a NEW array; the input is never mutated.
 */
export function sortItemsByTime(items: ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => {
    const aStart = effectiveStartMinutes(a) ?? Infinity;
    const bStart = effectiveStartMinutes(b) ?? Infinity;
    return aStart - bStart;
  });
}

/**
 * The set of item ids that overlap at least one other item's timed span, per
 * half-open rule: only items with a defined `effectiveStartMinutes` AND a positive
 * `durationMinutes` are considered; two such items clash iff
 * `a.start < b.start + b.dur && b.start < a.start + a.dur` — touching edges (one item's
 * end exactly equals another's start) never clash. Raw minutes, no midnight wrap. Pure,
 * order-independent — never writes.
 *
 * — MULTI-DAY SPANS ARE EXCLUDED (clash v1): an item carrying an `endDate` is a
 * multi-day span (the field is only ever written strictly after the item's start day, so
 * its presence means "genuine span"). Its clock-time overlap with a same-day timed item
 * is not a meaningful conflict (a hotel stay "overlapping" a dinner is expected), so spans
 * are simply dropped before the pairwise check — no cross-day clash math in v1.
 */
export function clashingItemIds(items: ItineraryItem[]): Set<string> {
  const timed = items
    .map((item) => {
      if (item.endDate) return null; // spans are excluded from clash v1
      const start = effectiveStartMinutes(item);
      const dur = item.durationMinutes;
      return typeof start === 'number' && typeof dur === 'number' && dur > 0
        ? { id: item.id, start, end: start + dur }
        : null;
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
