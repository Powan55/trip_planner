/**
 * Trip Vault — Zod schemas for the itinerary payload + envelope.
 *
 * Zod is already a dependency — this adds NO new dep.
 *
 * VALIDATION-TOLERANCE RULE:
 * on READ these schemas are deliberately *lenient* —
 * - `category` is validated as `z.string()` (NOT `z.enum`), because real deployed
 * data may contain a category a future/older build didn't know about;
 * - objects `.passthrough()` unknown keys, so unknown future fields survive a read.
 * The app already produces well-typed `ItineraryItem`s on WRITE (strict via TypeScript),
 * so the write path is naturally strict. A read that fails even this lenient schema is
 * genuinely corrupt → quarantine (see `./load-save.ts`). This mirrors the existing
 * defensive tolerance of `docToDayPlan` in `lib/itinerary-remote.ts`.
 */
import { z } from 'zod';
import type { DayPlan } from '@/lib/trip-data';
// Cycle by design: that module wraps `itineraryItemSchema` below so the per-item drop rule has
// ONE definition. Safe because neither side reads the other at module-init time (#123).
import { sanitizeItineraryItems } from '@/core/itinerary/model';

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
    sourceType: z.enum(['recommendation', 'photo', 'map', 'featured']).optional(),
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
    // these on read; declaring them makes the accepted surface explicit + typed. Deliberately
    // plain `z.number().optional()` (no `.min()/.max()` range clamp) — the lat/lng range check
    // lives once, in the ItemEditor UI, matching the startMinutes precedent above.
    lat: z.number().optional(),
    lng: z.number().optional(),
    // Multi-day span ( — additive OPTIONAL, per lenient-read rule, mirrors the
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
    // Leg id (: widened from `z.enum(['nepal','japan'])` to a generic non-empty string — a
    // custom trip's single leg persists `country: 'main'`). Backward compatible: every existing
    // nepal/japan value still validates. Lenient-read discipline is preserved.
    country: z.string().min(1),
    // — optional DISPLAY label (see `DayPlan.countryLabel`, lib/trip-data.ts). ADDITIVE and
    // OPTIONAL, so every pre- vault still parses; no version bump (`.passthrough()` already
    // tolerated it on read — declaring it makes the accepted surface explicit + typed).
    countryLabel: z.string().optional(),
    items: z.array(itineraryItemSchema),
  })
  .passthrough();

/**
 * The v3 itinerary payload: a bare `DayPlan[]`. Retained for provenance; the CURRENT
 * validated payload is v4 (below). v3 and v4 share the SAME structural shape — v4 only
 * adds three OPTIONAL per-item fields (`rev`/`hlc`/`deleted`) to `itineraryItemSchema`,
 * so v3 data validates cleanly against v4 (the fields simply default absent). The pair is
 * kept explicit so the version progression reads honestly.
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
 * Validate an already-migrated payload against the CURRENT (v5) lenient itinerary schema,
 * DEGRADING PER DAY AND PER ITEM.
 *
 * Returns `null` ONLY when the payload is not an array at all — that is the genuinely-corrupt
 * case, and it is still what triggers the callers' quarantine branch (`./load-save.ts`,
 * `./export-import.ts`). Otherwise it always returns an array: a day that fails
 * `dayPlanSchema` is dropped, an item that fails `itineraryItemSchema` is dropped from its
 * day, and everything else is returned verbatim.
 *
 * WAS ALL-OR-NOTHING over the whole array (a bare `itineraryPayloadV5.safeParse`), which is
 * the second half of #123: one malformed item failed the entire parse, the caller quarantined
 * the payload, and 31 good days were replaced by the sample/empty shells over a single bad row.
 * Per-row degradation at a lenient trust boundary is the policy the sibling importers already
 * use (`sanitizeExpenses`, `sanitizePlaces`, `sanitizeItems`).
 *
 * The per-item rule is NOT restated here — `sanitizeItineraryItems` wraps `itineraryItemSchema`
 * above, so the on-disk boundary and the remote-snapshot boundary (`docToDayPlan`) drop exactly
 * the same rows. A day whose `items` is absent or not an array is still DROPPED whole rather
 * than emptied: substituting `[]` there would be defaulting, which this read path does not do.
 *
 * `.passthrough()` keeps unknown keys, so the returned objects retain any forward fields; the
 * `DayPlan[]` cast is safe because the schema is a superset-tolerant mirror of the type.
 *
 * DO NOT point the import/restore path at this function — use `parseItineraryPayloadStrict`
 * below. The two boundaries differ for a concrete reason; see its note.
 */
export function parseItineraryPayload(payload: unknown): DayPlan[] | null {
  if (!Array.isArray(payload)) return null;
  const days: DayPlan[] = [];
  let dropped = 0;
  for (const raw of payload) {
    // Optional-chained so a null/primitive element cannot throw on the property read; such an
    // element takes the `raw` branch and is dropped by `dayPlanSchema` a line later.
    const items = (raw as { items?: unknown } | null | undefined)?.items;
    let candidate: unknown = raw;
    if (Array.isArray(items)) {
      const sane = sanitizeItineraryItems(items);
      dropped += items.length - sane.length;
      candidate = { ...(raw as Record<string, unknown>), items: sane };
    }
    const parsed = dayPlanSchema.safeParse(candidate);
    if (parsed.success) days.push(parsed.data as DayPlan);
    else dropped++;
  }
  // A degraded read is SILENT otherwise, and the next `savePlans` rewrites the vault without the
  // dropped rows — so this warn is the only trace that data went missing, and the only way to tell
  // "the trip really is this short" from "the read ate rows". Gated on `dropped > 0` so a clean
  // vault (the overwhelmingly common case) logs nothing.
  if (dropped > 0) console.warn(`[vault] itinerary read dropped ${dropped} malformed row(s)`);
  return days;
}

/**
 * STRICT: the import/restore trust boundary (D-098). All-or-nothing, by design.
 *
 * WHY THIS IS NOT `parseItineraryPayload`: the two callers have opposite failure economics.
 * - ON DISK there is no second copy. A vault with one bad row is all the user has, so dropping
 * the row and keeping 31 good days beats quarantining the lot — partial beats nothing (#123).
 * - ON IMPORT the user holds BOTH the file and their live trip. Accepting a partial parse
 * silently overwrites the live trip with a truncated version of itself, and reports success:
 * an array of pure garbage validates as `[]` and `savePlans([])` wipes the trip. Under sync it
 * is worse — `restorePlans` tombstones every live item and re-adds nothing, and fresh-id-beats-
 * tombstone propagates that whole-trip deletion to every device. Rejecting costs the user one
 * failed import (the blob is quarantined, the live trip untouched); accepting costs them the
 * trip. D-098 is LOCKED on exactly this: a bad or hostile import never destroys current data.
 *
 * So: do NOT merge these two back into one function, and do NOT soften this to "reject only when
 * the result is empty" — that still lets two-days-becomes-one through silently.
 */
export function parseItineraryPayloadStrict(payload: unknown): DayPlan[] | null {
  const r = itineraryPayloadV5.safeParse(payload);
  return r.success ? (r.data as DayPlan[]) : null;
}
