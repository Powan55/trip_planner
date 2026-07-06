// The "what's-next rail" pure helper.
//
// ── Purity ────────────────────────────────────────────────────────────────────────────────
// `nextUp` is PURE — no clock read, no fetch, no storage. It takes the day's items AND the
// resolved "now" time-of-day ("HH:MM", zero-padded 24h) and returns the next upcoming item.
// The IMPURE "now" (from `getNow()`, incl. the `?today=` override — local noon under a
// `?today=DATE` clock) is supplied by the caller (`components/today-panel.tsx`), never read
// here. That keeps this trivially unit-testable in isolation (no time mocking needed).

import type { ItineraryItem } from '@/lib/trip-data';

/** A zero-padded 24h clock time, e.g. "06:00", "12:00", "18:30". */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Whether `time` is a valid zero-padded 24h "HH:MM". Items with a missing / blank /
 * unparseable time have no scheduled slot, so they are never "next".
 */
function hasValidTime(time: string | undefined): time is string {
  return typeof time === 'string' && TIME_RE.test(time);
}

/**
 * The next relevant agenda item, or `null` when nothing is upcoming.
 *
 * "Upcoming" = the earliest item that is NOT done and whose `time` is `>= nowHHMM`. Because
 * the times are zero-padded 24h "HH:MM", a plain lexicographic string compare IS a correct
 * chronological compare — no Date parsing (and no tz risk) needed. The scan is a single pass;
 * ties (two items at the same time) resolve to the FIRST in array order (stable, matches the
 * agenda's own top-to-bottom order).
 *
 * Excluded from "next":
 *   - done items (`item.done === true`),
 *   - items with a missing / blank / unparseable `time` (no scheduled slot),
 *   - items whose `time` is strictly before `nowHHMM` (already passed).
 *
 * Returns `null` when every timed, not-done item is in the past, or there are no timed items.
 * Total — it never throws; a malformed `nowHHMM` simply means everything with a valid time
 * lexicographically `>=` it is considered (still deterministic).
 */
export function nextUp(items: ItineraryItem[], nowHHMM: string): ItineraryItem | null {
  let best: ItineraryItem | null = null;
  for (const item of items) {
    if (item.done === true) continue;
    if (!hasValidTime(item.time)) continue;
    if (item.time < nowHHMM) continue; // already passed
    if (best === null || item.time < (best.time as string)) {
      best = item;
    }
  }
  return best;
}
