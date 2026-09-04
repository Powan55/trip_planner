/**
 * Trip Vault — the lenient READ contract for one `ItineraryItem`.
 *
 * A LEAF module: it imports zod and nothing else in `core/`. `./schema.ts` (which needs it for
 * `dayPlanSchema`) and `core/itinerary/model.ts` (which wraps it for the remote boundary) both
 * import it, and neither imports the other — that is the whole reason it lives here rather than
 * in `./schema.ts`, where the two were a runtime import cycle held together only by nobody
 * dereferencing across it at module-eval time. `./schema.ts` re-exports the symbol, so
 * `@/core/vault/schema` stays a valid import path for it and D-363's ONE-definition invariant is
 * untouched: only the file changed.
 *
 * VALIDATION-TOLERANCE RULE:
 * on READ this schema is deliberately *lenient* —
 * - `category` and `sourceType` are validated as `z.string()` (NOT `z.enum`), because real
 * deployed data may contain a value a future/older build didn't know about;
 * - the object `.passthrough()`es unknown keys, so unknown future fields survive a read.
 * The app already produces well-typed `ItineraryItem`s on WRITE (strict via TypeScript), so the
 * write path is naturally strict. A read that fails even this lenient schema is genuinely
 * corrupt → quarantine (see `./load-save.ts`). This mirrors the existing defensive tolerance of
 * `docToDayPlan` in `lib/itinerary-remote.ts`.
 */
import { z } from 'zod';

/**
 * A numeric field that is only meaningful inside a physical range: out of range (or infinite)
 * degrades to ABSENT rather than failing the item, because dropping a whole plan over one bad
 * number is the worse bug (D-363). A wrong-TYPED value still fails the item, exactly as before.
 *
 * BOUNDS are shared with `sanitizeCityCoords` (core/trips/registry.ts) and must stay numerically
 * consistent — WGS84 does not have two answers. FAILURE BEHAVIOUR differs by design and must NOT
 * be unified: an `ItineraryItem` may legitimately be un-pinned, so a bad coordinate here degrades
 * the field; a `CityCoord` is `{latitude, longitude}` with no optional half and `lib/weather.ts`
 * reads both to build a request, so a bad coordinate there drops the whole city. Merging the two
 * ships a half-populated `CityCoord` into that fetch.
 */
const ranged = (min: number, max: number) =>
  z
    .number()
    .optional()
    .transform((v) => (v !== undefined && Number.isFinite(v) && v >= min && v <= max ? v : undefined));

// Mirrors lib/trip-data.ts `ItineraryItem`. `category` kept permissive (see note above).
export const itineraryItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(), // permissive on read — NOT z.enum
    time: z.string().optional(),
    duration: z.string().optional(),
    // Structured time model. Declared-surface style like
    // `done`. Deliberately PLAIN `z.number().optional()` — NO `.int().min().max()` on the read
    // path: an out-of-range value from a buggy client must degrade to "untimed" at
    // `effectiveStartMinutes` (the ONE runtime range check), never quarantine a whole vault.
    startMinutes: z.number().optional(),
    durationMinutes: z.number().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
    sourceId: z.string().optional(),
    // Permissive on read — NOT z.enum (#139). It was the one non-lenient field here, so a fifth
    // sourceType from a newer build dropped the whole row at both the on-disk and remote
    // boundaries. `isSourceType` (lib/itinerary-adapter.ts) is the runtime narrow to use if a
    // consumer ever needs the union; nothing in production reads this field as one today.
    sourceType: z.string().optional(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
    updatedAt: z.string().optional(),
    // Sync v2 per-item merge fields. All optional +
    // `.passthrough()` retained, so the lenient-read rule is preserved and every
    // pre-v4 item (fields absent) stays valid. A v4 blob read by an old build hits the
    // forward-version lenient branch and is never quarantined.
    rev: z.number().optional(),
    hlc: z.string().optional(),
    deleted: z.boolean().optional(),
    // done-tracking. NO
    // migration and NO version bump: an item with `done` absent is trivially "not done"
    // (falsy), so no on-disk backfill is required (unlike the Sync-v2 fields, which needed a
    // deterministic hlc backfill). CURRENT_ITINERARY_VERSION STAYS 4 — the `schemaVersion`
    // assertions remain `toBe(4)`. `.passthrough()` already tolerated it on read; declaring it
    // makes the accepted surface explicit + typed.
    done: z.boolean().optional(),
    // Completion attribution.
    // NO migration and NO version bump — CURRENT_ITINERARY_VERSION STAYS 5. Both absent = no
    // completion attribution (like `done` absent = not done). `.passthrough()` already tolerated
    // them on read; declaring them makes the surface explicit + typed.
    doneBy: z.string().optional(),
    doneAt: z.string().optional(),
    // Manual pin-drop ( — additive OPTIONAL, per lenient-read rule, mirrors the
    // `done` entry above). NO migration and NO version bump: an item with lat/lng absent is
    // trivially un-pinned, so no on-disk backfill is required. CURRENT_ITINERARY_VERSION STAYS
    // 5 — the `schemaVersion` assertions remain `toBe(5)`. `.passthrough()` already tolerated
    // these on read; declaring them makes the accepted surface explicit + typed. RANGE-GATED
    // (see `ranged` above): maplibre's `LngLat` throws outside WGS84, and every itinerary pin
    // reaches `fitBounds` unchecked, so an out-of-range value read off disk or off a peer's
    // snapshot kills the whole map pane.
    lat: ranged(-90, 90),
    lng: ranged(-180, 180),
    // Multi-day span ( — additive OPTIONAL, per lenient-read rule, mirrors the
    // lat/lng entry above). NO migration and NO version bump: an item with `endDate` absent is
    // trivially single-day, so no on-disk backfill is required. CURRENT_ITINERARY_VERSION STAYS
    // 5 — the `schemaVersion` assertions remain `toBe(5)`. `.passthrough()` already tolerated it
    // on read; declaring it makes the accepted surface explicit + typed. ISO date string; the
    // ">= startDay & in-trip-range" check lives once, in the ItemEditor UI (matching lat/lng).
    endDate: z.string().optional(),
    // Per-item place-offset override ( — additive OPTIONAL, per lenient-read rule, mirrors the
    // `lat`/`lng`/`endDate` entry above). NO migration and NO version bump: an item with `tzOffsetMin`
    // absent is trivially offset-by-day, so no on-disk backfill is required. CURRENT_ITINERARY_VERSION
    // STAYS 5 — the `schemaVersion` assertions remain `toBe(5)`. `.passthrough()` already tolerated it
    // on read; declaring it makes the accepted surface explicit + typed. Minutes east of UTC,
    // range-gated to the real offset envelope (UTC-12:00 … UTC+14:00) like `lat`/`lng` above.
    tzOffsetMin: ranged(-720, 840),
    // Day-order key, split off `hlc` (additive OPTIONAL, per lenient-read rule, mirrors the
    // `tzOffsetMin` entry above). NO migration and NO version bump: an item with `ord` absent
    // orders by its `hlc` exactly as before, so no on-disk backfill is required.
    // CURRENT_ITINERARY_VERSION STAYS 5 — the `schemaVersion` assertions remain `toBe(5)`.
    // `.passthrough()` already tolerated it on read; declaring it makes the surface explicit.
    // Serialized-HLC shape; plain `z.string().optional()` like `hlc` above.
    ord: z.string().optional(),
  })
  .passthrough(); // tolerate unknown future fields on read
