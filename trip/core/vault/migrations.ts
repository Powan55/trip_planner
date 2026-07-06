/**
 * Trip Vault — the ordered migration runner.
 *
 * Migrations are an ordered chain of PURE `from → to` steps (no I/O, no storage, no
 * clock). The runner (`./load-save.ts`) walks this list, applying each step whose `from`
 * equals the running version, in ascending order, until it reaches
 * `CURRENT_ITINERARY_VERSION`.
 *
 * EXTEND by APPENDING a new step; NEVER reorder or renumber a shipped step.
 */

import type { DayPlan } from '@/lib/trip-data';
import { seedHlcFromLegacy } from '@/core/sync/hlc';

export interface Migration {
  /** schemaVersion this step consumes. */
  from: number;
  /** schemaVersion this step produces (always `from + 1`). */
  to: number;
  /** Pure transform of the payload. No I/O, no storage, no `Date.now`. */
  migrate(payload: unknown): unknown;
}

/**
 * Ordered itinerary migrations.
 *
 * Migration #1 (v2→v3) is a PAYLOAD IDENTITY. v2 = today's bare `DayPlan[]` on
 * `nepal_japan_itinerary` (no envelope, no version field). The v3 payload is the SAME
 * `DayPlan[]` — the shape did not change; v3 only adds the wrapper. So the step returns
 * the payload as-is and the runner wraps it (`schemaVersion` / `updatedAt`). Lossless by
 * construction: no field is added, dropped, renamed, or reinterpreted — the safest
 * possible first migration for real, live users' data.
 */
export const itineraryMigrations: Migration[] = [
  {
    from: 2,
    to: 3,
    migrate: (payload) => payload,
  },
  // #2 (v3→v4) — Sync v2 additive backfill. The payload stays
  // a `DayPlan[]`; each item gains the three defaulted merge fields. LOSSLESS by
  // construction: no field is renamed, dropped, or reinterpreted — three OPTIONAL fields
  // are added with deterministic defaults, so every legacy item reads as a valid, mergeable
  // v4 item. PURE — no clock: `hlc` is DERIVED from the item's existing `updatedAt`
  // via `seedHlcFromLegacy` (a pure function), never minted from `Date.now`. A pure
  // spread-and-default `map` cannot throw on well-formed input, so it never spuriously
  // quarantines; a genuinely malformed payload is caught later by the lenient Zod read.
  {
    from: 3,
    to: 4,
    migrate: (payload) => {
      const days = payload as DayPlan[];
      return days.map((d) => ({
        ...d,
        items: (d.items ?? []).map((it) => ({
          ...it,
          rev: it.rev ?? 1,
          hlc: it.hlc ?? seedHlcFromLegacy(it.updatedAt),
          deleted: it.deleted ?? false,
        })),
      }));
    },
  },
];

/** The current on-disk itinerary schema version (bumped 3→4 for the Sync v2 fields). */
export const CURRENT_ITINERARY_VERSION = 4;

/**
 * Run the ordered migration chain from `fromVersion` up to `CURRENT_ITINERARY_VERSION`.
 *
 * - Picks each step whose `from` equals the running version, applies it, advances.
 * - PURE: no I/O. A step MAY throw (a genuinely un-migratable payload) — the caller
 *   catches it and quarantines; this function does not swallow throws.
 * - If a required step is missing (a gap in the chain) it throws, so the caller
 *   quarantines rather than silently returning a half-migrated payload.
 *
 * Returns the migrated payload (still `unknown` — the caller validates it against the
 * current Zod schema before trusting it).
 */
export function runItineraryMigrations(
  payload: unknown,
  fromVersion: number,
  migrations: Migration[] = itineraryMigrations,
  targetVersion: number = CURRENT_ITINERARY_VERSION,
): unknown {
  let version = fromVersion;
  let current = payload;
  while (version < targetVersion) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new Error(
        `[trip-vault] no migration step from schemaVersion ${version} (target ${targetVersion})`,
      );
    }
    current = step.migrate(current);
    version = step.to;
  }
  return current;
}
