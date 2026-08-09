// The "what's-next rail" pure helper ( 3; re-signatured for the place-clock
// time model, /).
//
// ── Purity ─────────────────────────────────────────────────────────────────
// `nextUp` is PURE — no clock read, no fetch, no storage. It takes the day's items AND a
// context carrying the day's date, the place's UTC offset, and the resolved "now" as a UTC
// epoch-ms instant. The IMPURE "now" (from `getNowUtcMsForPlace`, incl. the `?today=`
// override) is supplied by the caller (`components/today-panel.tsx`), never read here — so
// this stays trivially unit-testable in isolation (no time mocking).
//
// The comparison is place-accurate: BOTH "is it past" and "which comes first" are
// decided by the SAME absolute-instant key — `placeWallClockToUtcMs` over
// `effectiveStartMinutes` (the ONE shared fallback that parses legacy `time` for items that
// never got a structured `startMinutes`) resolved through `effectiveOffsetMin`. Before
// the past-gate was instant-based while the ranking was wall-clock-based; the two agree
// only while every item on a day shares one offset, which the Jan-9 date-line day does not.

import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveOffsetMin, effectiveStartMinutes, placeWallClockToUtcMs } from '@/core/dates';

/** The resolved-clock context for a single trip day (all injected — no clock read here). */
export interface NextUpContext {
  /** The day's ISO date `YYYY-MM-DD` (the place-anchor for the instant compare). */
  dayDate: string;
  /** The day's place UTC offset in minutes (NPT +345 / JST +540). */
  placeOffsetMin: number;
  /** "Now" as a UTC epoch-ms instant (from `getNowUtcMsForPlace`). */
  nowUtcMs: number;
}

/**
 * The next relevant agenda item, or `null` when nothing is upcoming.
 *
 * "Upcoming" = the earliest not-done item whose effective start INSTANT is NOT past at the
 * place (an item exactly at "now" IS upcoming — the `<` strictness carried over from the
 * pre- past-gate). "Earliest" is by that same instant, so an item logged in another
 * zone ranks where it actually falls in time, not where its clock face reads. Ties resolve to
 * the FIRST in array order (stable, matches the agenda's top-to-bottom order).
 *
 * Excluded from "next":
 * - done items (`item.done === true`),
 * - items with no effective start (missing / unparseable `time` and no valid `startMinutes`),
 * - items already past at the place.
 *
 * Total — never throws; returns `null` when every timed, not-done item is past or nothing is
 * timed. Returns the SAME item reference on the same inputs (no new object built).
 */
export function nextUp(items: ItineraryItem[], ctx: NextUpContext): ItineraryItem | null {
  let best: ItineraryItem | null = null;
  let bestMs = Infinity;
  for (const item of items) {
    if (item.done === true) continue;
    const min = effectiveStartMinutes(item);
    if (min === undefined) continue; // no scheduled slot
    // — ONE key for both the past-gate and the ranking. This used to reject past items by
    // absolute instant but rank the survivors by wall-clock minutes; the two disagree as soon as
    // a day holds items in different zones, which the Jan-9 date-line
    // crossing now does. `startMs < now` IS the whole past-gate, computed once (/TD-05
    // then deleted the `isPastAtPlace` helper this line had superseded).
    const startMs = placeWallClockToUtcMs(ctx.dayDate, min, effectiveOffsetMin(item, ctx.placeOffsetMin));
    if (startMs < ctx.nowUtcMs) continue; // passed (an item exactly AT now is still upcoming)
    if (startMs < bestMs) {
      best = item;
      bestMs = startMs;
    }
  }
  return best;
}
