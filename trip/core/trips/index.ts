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
import { getKnownTrip } from './registry';
import { customTripConfig } from './custom';

export type { TripConfig, TripLeg } from './model';
export { legForDate } from './model';
export { buildDayShells } from './custom';

/** Default pack id — LOCAL-ONLY since #10 (no remote path; lib/firebase-config's getTripId()
 * returns '' for it). Single source of truth is the gateway; re-exported for existing importers. */
export { DEFAULT_TRIP_ID };

/** Static registry — one pack today; a second pack is a future concern, not now. */
export const TRIP_PACKS: Record<string, TripConfig> = {
  [DEFAULT_TRIP_ID]: NEPAL_JAPAN_2026,
};

/**
 * TOTAL — resolve a trip's config. Precedence: a registered static PACK, else a
 * CUSTOM trip's synthesized single-leg config (from its TripMeta config block, or a placeholder
 * when that block is absent — `customTripConfig`), else the default pack. The default pack
 * short-circuits on the first lookup, so its path is unchanged (no registry read, no side effect)
 * and byte-identical to pre-. Never throws.
 *
 * A-4 (SB-6, D-307): `TRIP_PACKS` is a plain object literal, so a bare `TRIP_PACKS[id]` returns a
 * non-nullish value for a prototype key name — `TRIP_PACKS['constructor']` is the `Object`
 * function, `TRIP_PACKS['toString']` a function, `TRIP_PACKS['__proto__']` is `Object.prototype`
 * — and `??` never fires. `id` is `getActiveTripId()`, a raw unvalidated localStorage string a
 * user can set to any of those via "Add a trip by Trip Token" or `?trip=`, so this returned a
 * FUNCTION where every caller expects a `TripConfig`. `core/dates/trip-dates.ts` then reads
 * `activeTrip.legs.find(...)` at MODULE LOAD and throws — pulled in by `lib/trip-data.ts`, which
 * `components/command-palette.tsx` imports and root `app/layout.tsx` mounts statically, so EVERY
 * route fails to evaluate with no in-app recovery. Read through the own-key idiom already
 * established at the 4 sibling sites for this exact defect class (`core/budget/model.ts:165`,
 * `core/dates/trip-cities.ts:88`, `lib/city-coords.ts:63`, `lib/leg-label.ts:63`) instead of the
 * bare index.
 */
export function getTripConfig(id: string): TripConfig {
  const pack = Object.prototype.hasOwnProperty.call(TRIP_PACKS, id) ? TRIP_PACKS[id] : undefined;
  return pack ?? customTripConfig(getKnownTrip(id)) ?? NEPAL_JAPAN_2026;
}

/** The active trip — resolved through the gateway pointer. Unknown/unset ⇒ default pack. */
export function getActiveTrip(): TripConfig {
  return getTripConfig(getActiveTripId());
}

/** True when the active trip is the default pack — gates the SAMPLE_ITINERARY seed. */
export function isDefaultTrip(): boolean {
  return getActiveTripId() === DEFAULT_TRIP_ID;
}
