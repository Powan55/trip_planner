/**
 * Trip Vault — Zod schemas for the itinerary payload + envelope.
 *
 * Zod is already a dependency (`zod` 3.23.8) — this adds NO new dep.
 *
 * VALIDATION-TOLERANCE RULE (load-bearing for backward-compat):
 * on READ these schemas are deliberately *lenient* —
 *   - `category` is validated as `z.string()` (NOT `z.enum`), because real deployed
 *     data may contain a category a future/older build didn't know about;
 *   - objects `.passthrough()` unknown keys, so unknown future fields survive a read.
 * The app already produces well-typed `ItineraryItem`s on WRITE (strict via TypeScript),
 * so the write path is naturally strict. A read that fails even this lenient schema is
 * genuinely corrupt → quarantine (see `./load-save.ts`). This mirrors the existing
 * defensive tolerance of `docToDayPlan` in `lib/itinerary-remote.ts`.
 */
import { z } from 'zod';
import type { DayPlan } from '@/lib/trip-data';

// Mirrors lib/trip-data.ts `ItineraryItem`. `category` kept permissive (see note above).
export const itineraryItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(), // permissive on read — NOT z.enum
    time: z.string().optional(),
    duration: z.string().optional(),
    // Structured time model (v5, additive). Declared-surface style like
    // `done`. Deliberately PLAIN `z.number().optional()` — NO `.int().min().max()` on the read
    // path: an out-of-range value from a buggy client must degrade to "untimed" at
    // `effectiveStartMinutes` (the ONE runtime range check), never quarantine a whole vault.
    startMinutes: z.number().optional(),
    durationMinutes: z.number().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
    sourceId: z.string().optional(),
    sourceType: z.enum(['recommendation', 'photo', 'map', 'featured']).optional(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
    updatedAt: z.string().optional(),
    // Sync v2 per-item merge fields (v4, additive). All optional +
    // `.passthrough()` retained, so the lenient-read rule is preserved and every
    // pre-v4 item (fields absent) stays valid. A v4 blob read by an old build hits the
    // forward-version lenient branch and is never quarantined (rollback-safety).
    rev: z.number().optional(),
    hlc: z.string().optional(),
    deleted: z.boolean().optional(),
    // Trip OS done-tracking (additive OPTIONAL, per the lenient-read rule). NO
    // migration and NO version bump: an item with `done` absent is trivially "not done"
    // (falsy), so no on-disk backfill is required (unlike the Sync-v2 fields, which needed a
    // deterministic hlc backfill). CURRENT_ITINERARY_VERSION STAYS 4 — the `schemaVersion`
    // assertions remain `toBe(4)`. `.passthrough()` already tolerated it on read; declaring it
    // makes the accepted surface explicit + typed.
    done: z.boolean().optional(),
    // Manual pin-drop (additive OPTIONAL, per the lenient-read rule, mirrors the
    // `done` entry above). NO migration and NO version bump: an item with lat/lng absent is
    // trivially un-pinned, so no on-disk backfill is required. CURRENT_ITINERARY_VERSION STAYS
    // 5 — the `schemaVersion` assertions remain `toBe(5)`. `.passthrough()` already tolerated
    // these on read; declaring them makes the accepted surface explicit + typed. Deliberately
    // plain `z.number().optional()` (no `.min()/.max()` range clamp) — the lat/lng range check
    // lives once, in the ItemEditor UI, matching the startMinutes precedent above.
    lat: z.number().optional(),
    lng: z.number().optional(),
    // Multi-day span (additive OPTIONAL, per the lenient-read rule, mirrors the
    // lat/lng entry above). NO migration and NO version bump: an item with `endDate` absent is
    // trivially single-day, so no on-disk backfill is required. CURRENT_ITINERARY_VERSION STAYS
    // 5 — the `schemaVersion` assertions remain `toBe(5)`. `.passthrough()` already tolerated it
    // on read; declaring it makes the accepted surface explicit + typed. ISO date string; the
    // ">= startDay & in-trip-range" check lives once, in the ItemEditor UI (matching lat/lng).
    endDate: z.string().optional(),
  })
  .passthrough(); // tolerate unknown future fields on read

export const dayPlanSchema = z
  .object({
    date: z.string(),
    city: z.string(),
    country: z.enum(['nepal', 'japan']),
    items: z.array(itineraryItemSchema),
  })
  .passthrough();

/**
 * The v3 itinerary payload: a bare `DayPlan[]`. Retained for provenance; the CURRENT
 * validated payload is v4 (below). v3 and v4 share the SAME structural shape — v4 only
 * adds three OPTIONAL per-item fields (`rev`/`hlc`/`deleted`) to `itineraryItemSchema`,
 * so v3 data validates cleanly against v4 (the fields simply default absent). The pair is
 * kept explicit so the version progression reads honestly (mirrors the append-only migration style).
 */
export const itineraryPayloadV3 = z.array(dayPlanSchema);

/** The full v3 envelope: `{ schemaVersion: 3, updatedAt, payload: DayPlan[] }`. */
export const itineraryEnvelopeV3 = z.object({
  schemaVersion: z.literal(3),
  updatedAt: z.string(),
  payload: itineraryPayloadV3,
});

/**
 * The CURRENT itinerary payload (v4): a `DayPlan[]` whose items may carry the additive
 * Sync v2 fields. Same array-of-days shape as v3; the difference lives inside
 * `itineraryItemSchema` (the three new optional fields), so this mirrors the v3 pair.
 */
export const itineraryPayloadV4 = z.array(dayPlanSchema);

/** The full v4 envelope: `{ schemaVersion: 4, updatedAt, payload: DayPlan[] }`. */
export const itineraryEnvelopeV4 = z.object({
  schemaVersion: z.literal(4),
  updatedAt: z.string(),
  payload: itineraryPayloadV4,
});

/**
 * The CURRENT itinerary payload (v5): a `DayPlan[]` whose items may carry the additive
 * structured-time fields (`startMinutes`/`durationMinutes`). Same array-of-days shape as
 * v3/v4; the difference lives inside `itineraryItemSchema` (the two new optionals), so this
 * mirrors the v3/v4 pair. The lenient read means v3/v4 data validates cleanly here too (the
 * fields default absent).
 */
export const itineraryPayloadV5 = z.array(dayPlanSchema);

/** The full v5 envelope: `{ schemaVersion: 5, updatedAt, payload: DayPlan[] }`. */
export const itineraryEnvelopeV5 = z.object({
  schemaVersion: z.literal(5),
  updatedAt: z.string(),
  payload: itineraryPayloadV5,
});

/**
 * Validate an already-migrated payload against the CURRENT (v5) lenient itinerary schema.
 *
 * Returns the parsed `DayPlan[]` on success, or `null` on failure (the caller
 * quarantines + falls back — the schema never throws to the load path). `.passthrough()`
 * keeps unknown keys, so the returned objects retain any forward fields; the `DayPlan[]`
 * cast is safe because the schema is a superset-tolerant mirror of the type.
 */
export function parseItineraryPayload(payload: unknown): DayPlan[] | null {
  const result = itineraryPayloadV5.safeParse(payload);
  return result.success ? (result.data as DayPlan[]) : null;
}
