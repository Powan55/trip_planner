import type { ItineraryItem } from '@/lib/trip-data';
import {
  effectiveDurationMinutes,
  effectiveOffsetMin,
  effectiveStartMinutes,
  formatTimeAmPm,
  placeWallClockToUtcMs,
} from '@/core/dates';

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
 * effective duration are considered; two such items clash iff
 * `a.start < b.end && b.start < a.end` — touching edges (one item's end exactly equals
 * another's start) never clash. Pure, order-independent — never writes.
 *
 * The overlap is judged on the ABSOLUTE INSTANT, exactly like this file's
 * `sortItemsByTime` has been since. Two items on one day can sit in different zones
 *, and a raw wall-clock comparison then answers "when" in a
 * frame that does not exist: two 09:00 items 14 hours apart read as a clash, and the Jan-9
 * Tokyo flight that genuinely overlaps its Detroit layover reads as disjoint. `dayDate` +
 * `dayOffsetMin` resolve each item through the SAME `placeWallClockToUtcMs` every other
 * instant consumer uses — no second time-math path here. (No longer latent: D-316 derives
 * the span from the free-text `duration` too, and all 158 seed items carry one. The four
 * overlaps that surfaced when it went live are gone — issue #18/D-327 corrected all of them
 * in `core/content/itinerary.ts`, so the shipped seed is clean and the badge now only ever
 * reports a collision a user, a peer's sync or an import produced.)
 *
 * — MULTI-DAY SPANS ARE EXCLUDED (clash v1): an item carrying an `endDate` that still
 * covers the day being checked is a multi-day span. Its clock-time overlap with a same-day
 * timed item is not a meaningful conflict (a hotel stay "overlapping" a dinner is expected),
 * so a genuine span is simply dropped before the pairwise check — no cross-day clash math in
 * v1. A STALE `endDate` (left behind when a span is moved/copied past the day it names — see
 * `toInterval`, D-316 addendum) no longer earns the exemption: it falls back to a plain timed
 * interval and is checked like anything else.
 */
interface Interval {
  id: string;
  start: number;
  end: number;
}

/**
 * D-316 — THE interval construction, extracted so `clashingItemIds` (the badge) and
 * `firstClashWith` (the block) share one truth. Two predicates would eventually disagree,
 * and a badge that says "clash" over a save that was allowed (or the reverse) is worse than
 * either behaviour alone. `null` = this item has no span and therefore cannot participate:
 * it is a genuine (still-forward-reaching) multi-day span (clash v1 excludes those), it is
 * untimed, or it has no duration.
 *
 * D-316: the duration comes from `effectiveDurationMinutes`, so the free-text `duration`
 * the 158 seed items carry is now derived at read. Before that this returned `null` for
 * every seed item and the whole clash feature could not fire.
 *
 * D-316 addendum (A-14): `endDate` exempts an item only while it still covers `dayDate` —
 * `item.endDate > dayDate`. A span moved or copied past its own `endDate` (so the field no
 * longer reaches the day the item now sits on) is a STALE span, not a genuine one, and falls
 * through to a plain timed interval so it can clash like anything else. Matches the band
 * renderer's own "is this still a genuine forward span" reading (`item.endDate <= plan.date`,
 * `components/calendar-planner.tsx`), same comparison, opposite sense.
 */
function toInterval(
  item: ItineraryItem,
  dayDate: string,
  dayOffsetMin: number,
): Interval | null {
  if (item.endDate && item.endDate > dayDate) return null; // a genuine forward span is exempt
  const min = effectiveStartMinutes(item);
  const dur = effectiveDurationMinutes(item);
  if (typeof min !== 'number' || typeof dur !== 'number' || dur <= 0) return null;
  const start = placeWallClockToUtcMs(dayDate, min, effectiveOffsetMin(item, dayOffsetMin));
  return { id: item.id, start, end: start + dur * 60000 };
}

/**
 * D-316 — the first item on `dayItems` whose span overlaps `candidate`'s, or `undefined`
 * when the write is clear. The BLOCKING half of D-316, sharing `toInterval` (and therefore
 * the half-open absolute-instant rule D-142 locked) with the warn-only badge above.
 *
 * `undefined` whenever the candidate is untimed, has no duration, or is a multi-day span —
 * an item with no span can never be refused. That is the escape hatch the copy names:
 * clear the duration and the item stops participating.
 *
 * Skips the candidate itself (an edit-in-place must not clash with its own stored row) and
 * tombstones. Call it with the day's FULL stored items — an author filter hides rows from
 * the screen, never from the clock.
 */
export function firstClashWith(
  candidate: ItineraryItem,
  dayItems: ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
): ItineraryItem | undefined {
  const c = toInterval(candidate, dayDate, dayOffsetMin);
  if (!c) return undefined;
  return dayItems.find((other) => {
    if (other.id === candidate.id || other.deleted === true) return false;
    const o = toInterval(other, dayDate, dayOffsetMin);
    return o !== null && c.start < o.end && o.start < c.end;
  });
}

/**
 * D-316 — has this write moved the item's TIME FOOTPRINT (start, span length, day, or
 * whether it is a multi-day span at all)?
 *
 * This one boolean is the entire grandfathering mechanism. The guard runs only when it is
 * true, which lets an overlap already on disk survive and stay editable while making every
 * NEW collision impossible. A brand-new item has no `prev` and is therefore always guarded.
 *
 * The SEED is no longer one of those cases: issue #18 / D-327 corrected the three containments
 * this comment used to name (lunch inside the USJ day, lunch inside the Shinsekai flex block,
 * the countdown inside the NYE club block), and the shipped content now holds zero overlaps.
 * The escape stays because the seed was never the only source of a stored collision: a synced
 * peer's write, a vault import and a plan saved by an older build all reach `commit()` without
 * passing the intent-layer guard, and a row that arrives already overlapping must not become
 * uneditable.
 *
 * Compared on the EFFECTIVE values, not the raw fields: re-saving a legacy `time: '18:15'`
 * item through the picker dual-writes `startMinutes: 1095`, which is the same instant and
 * must not count as a change.
 *
 * `endDate` is part of the footprint because it decides whether the item participates in
 * the predicate AT ALL (`toInterval` returns `null` for a span). Turning a span OFF leaves
 * start, duration and day untouched while converting an exempt span into a plain interval
 * that can land on top of something — so it must be guarded. Turning one ON passes
 * trivially: `firstClashWith` returns `undefined` for a span candidate.
 */
export function timeFootprintChanged(
  prev: ItineraryItem,
  prevDate: string,
  next: ItineraryItem,
  nextDate: string,
): boolean {
  return (
    prevDate !== nextDate ||
    (prev.endDate ?? undefined) !== (next.endDate ?? undefined) ||
    effectiveStartMinutes(prev) !== effectiveStartMinutes(next) ||
    effectiveDurationMinutes(prev) !== effectiveDurationMinutes(next)
  );
}

/**
 * D-316 — the shared copy fragment naming a blocking item: `“Dinner”, 7:00 PM–8:30 PM`.
 * Declared once so the five guarded surfaces (editor, add dialog, duplicate, bulk move,
 * copy day) cannot drift. Times are the item's own wall clock, exactly as its row renders
 * it. Only ever called with an item `firstClashWith` returned, so both values are defined.
 */
export function describeClash(item: ItineraryItem): string {
  const start = effectiveStartMinutes(item) ?? 0;
  const end = start + (effectiveDurationMinutes(item) ?? 0);
  return `“${item.title}”, ${formatTimeAmPm(start)}–${formatTimeAmPm(end)}`;
}

export function clashingItemIds(
  items: ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
): Set<string> {
  const timed = items
    .map((item) => toInterval(item, dayDate, dayOffsetMin))
    .filter((x): x is Interval => x !== null);

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
