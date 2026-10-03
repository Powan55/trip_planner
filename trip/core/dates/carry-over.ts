/**
 * Does a day's plan still have something running at `nowUtcMs`? (#754, D-679)
 *
 * The trip day flips at the destination's midnight. An overnight flight, or the 23:30 KTM
 * departure, is still in the air when that happens, and the day it belongs to is the one it
 * started on. `lib/trip-now.ts` asks this about the day before the destination day, and holds
 * that day while the answer is yes.
 *
 * Only an item with a real duration counts. The hero's open-ended "until the next item, max 2h"
 * block is a display guess, not a fact about when something ends, so it never holds a day.
 * Done items never hold one either. Instants only, through `placeWallClockToUtcMs`, so the
 * answer does not depend on the device's zone.
 */
import type { ItineraryItem } from '@/lib/trip-data';
import {
  effectiveDurationMinutes,
  effectiveOffsetMin,
  effectiveStartMinutes,
  placeWallClockToUtcMs,
} from './item-time';

export function hasItemInProgress(
  items: readonly ItineraryItem[],
  dayDate: string,
  dayOffsetMin: number,
  nowUtcMs: number,
): boolean {
  return items.some((item) => {
    if (item.done === true) return false;
    const startMin = effectiveStartMinutes(item);
    const dur = effectiveDurationMinutes(item);
    if (startMin === undefined || dur === undefined) return false;
    const startMs = placeWallClockToUtcMs(dayDate, startMin, effectiveOffsetMin(item, dayOffsetMin));
    return startMs <= nowUtcMs && nowUtcMs < startMs + dur * 60000;
  });
}
