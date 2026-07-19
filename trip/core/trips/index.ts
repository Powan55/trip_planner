/**
 * `core/trips` barrel — the pack registry + active-trip resolution. The
 * date backbone imports `getActiveTrip` / `legForDate` from here; nothing here imports
 * `core/dates` or `core/content` (one-way arrow, no cycles).
 *
 * ── resolves through the gateway pointer ──────────────────────────────
 * `getActiveTrip()` reads `getActiveTripId()` from the gateway.
 * Unset pointer ⇒ `DEFAULT_TRIP_ID` ⇒ the default pack, byte-identical to the pre- hardcode.
 * Resolved once per module load — a pack switch requires a full reload, so module-load
 * resolution is correct by design. `DEFAULT_TRIP_ID` now lives in the gateway (the same id its
 * `keyFor` grandfather test uses) and is re-exported here for existing consumers.
 */
import type { TripConfig } from './model';
import { NEPAL_JAPAN_2026 } from './packs/nepal-japan-2026';
import { getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';

export type { TripConfig, TripLeg } from './model';
export { legForDate } from './model';

/** Default pack id === lib/firebase-config.ts's NEXT_PUBLIC_TRIP_ID default.
 * Single source of truth is the gateway; re-exported here for existing importers. */
export { DEFAULT_TRIP_ID };

/** Static registry — one pack today; a second pack is a future concern, not now. */
export const TRIP_PACKS: Record<string, TripConfig> = {
  [DEFAULT_TRIP_ID]: NEPAL_JAPAN_2026,
};

/** TOTAL — an unknown id falls back to the default pack, never throws. */
export function getTripConfig(id: string): TripConfig {
  return TRIP_PACKS[id] ?? NEPAL_JAPAN_2026;
}

/** The active trip — resolved through the gateway pointer. Unknown/unset ⇒ default pack. */
export function getActiveTrip(): TripConfig {
  return getTripConfig(getActiveTripId());
}
