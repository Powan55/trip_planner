// "Tonight" emphasis — the PURE item-selection logic for the Travel Mode night-out
// affordance.
//
// ── Purity ────────────────────────────────────────
// `selectTonightItem` is PURE — no clock read, no storage. It takes the day's items (from the
// SAME `getDayPlan` lookup the agenda already uses — no duplicated storage/lookup logic) and
// the place-local "now" as minutes-since-midnight, computed by the caller
// (`components/travel-tonight-card.tsx`) from the existing `getNowUtcMsForPlace` +
// `placeWallClockToUtcMs` seam.

import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';

/** 17:00 in minutes-from-midnight — the "evening" cutoff (audit: surface after ~17:00). */
export const EVENING_START_MIN = 17 * 60;

/**
 * The evening headline item for "tonight", or `null`.
 *
 * Returns `null` before {@link EVENING_START_MIN} (it isn't evening yet) or when today has no
 * not-done item with an effective start at/after that cutoff. Otherwise returns the
 * LATEST-starting qualifying item (order-independent, ties resolve to array order) — in
 * practice the day's headline nightlife item, since dinner/food items sit earlier than 17:00
 * on nearly every seeded day and the club/bar item is last.
 */
export function selectTonightItem(
  items: ItineraryItem[],
  nowLocalMinutes: number,
): ItineraryItem | null {
  if (nowLocalMinutes < EVENING_START_MIN) return null;

  let best: ItineraryItem | null = null;
  let bestStart = -Infinity;
  for (const item of items) {
    if (item.done === true) continue;
    const start = effectiveStartMinutes(item);
    if (start === undefined || start < EVENING_START_MIN) continue;
    if (start > bestStart) {
      best = item;
      bestStart = start;
    }
  }
  return best;
}
