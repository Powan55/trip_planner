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
// The comparison is place-accurate: "upcoming" is decided by an INSTANT compare via
// `isPastAtPlace` (correct across a day boundary for a viewer far from the trip zone), and the
// ordering key is `effectiveStartMinutes` — the ONE shared fallback that parses legacy `time`
// for items that never got a structured `startMinutes` (sync-ingest / seed / pre-migration).

import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes, isPastAtPlace } from '@/core/dates';

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
 * "Upcoming" = the earliest not-done item whose effective start is NOT past at the place
 * (an item exactly at "now" IS upcoming — the old `>=` strictness, preserved via
 * `isPastAtPlace`'s `<`). The ordering key is `effectiveStartMinutes`: valid `startMinutes`
 * (0–1439) else the parsed legacy `time`. Ties resolve to the FIRST in array order (stable,
 * matches the agenda's top-to-bottom order).
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
  let bestMin = Infinity;
  for (const item of items) {
    if (item.done === true) continue;
    const min = effectiveStartMinutes(item);
    if (min === undefined) continue; // no scheduled slot
    if (isPastAtPlace(ctx.dayDate, min, ctx.placeOffsetMin, ctx.nowUtcMs)) continue; // passed
    if (min < bestMin) {
      best = item;
      bestMin = min;
    }
  }
  return best;
}
