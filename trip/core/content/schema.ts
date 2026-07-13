// Strict AUTHORING-TIME content schemas. Framework-free: plain TS + zod
// (already a prod dep used by core/vault/schema.ts — NO new dependency).
//
// ── The strict / lenient split (LOAD-BEARING — do NOT merge the two families) ──────────────
// The Vault's READ schemas (core/vault/schema.ts) are deliberately LENIENT — `category`
// as z.string(), `.passthrough()` — because they parse USER DATA that must never be destroyed.
// The schemas HERE validate AUTHORED SOURCE CODE, where the failure mode is a typo
// that should be caught loudly before commit. So these are STRICT: z.enum on categories/
// countries/status, ISO-date & HH:MM regex, non-empty required strings, and `.strict()`
// objects (an unknown key = a typo = fail). Same shapes, opposite tolerance, opposite
// master. These schemas NEVER run on the app's runtime read path — validation is authoring/
// CI-time only, via `npm run validate:content` (lib/__tests__/content-validation.test.ts).
//
// ── Booking schemas ────────────────────────────────────────────────────────────────
// Booking schemas validate STRUCTURE ONLY. Time/duration/label fields stay plain strings — the
// schema checks presence/shape, NEVER arithmetic (`totalDuration: '1d 15m'` crosses the date
// line and is correct verbatim; recomputing it would be a bug). Bookings are never derived from
// or fused with the itinerary — a separate type/store by design.

import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM');

// ── Itinerary content (the content root: core/content/itinerary.ts) ────────────────────────

/** The 10 canonical itinerary categories (lib/trip-data.ts ItineraryCategory) — STRICT enum. */
export const itineraryCategories = [
  'sightseeing',
  'food',
  'photography',
  'shopping',
  'nature',
  'cultural',
  'transportation',
  'hotel',
  'free',
  'nightlife',
] as const;

// STRICTER than the runtime ItineraryItem type on purpose: seed content must NOT carry the
// user-data / sync lifecycle fields (sourceId/sourceType/createdBy/updatedBy/updatedAt/rev/
// hlc/deleted/done). Those belong to persisted user items, never to authored seed content;
// `.strict()` enforces that for free. (Verified: today's seed carries none of them.)
export const contentItineraryItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.enum(itineraryCategories),
    time: hhmm.optional(),
    duration: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
  })
  .strict();

export const contentDayPlanSchema = z
  .object({
    date: isoDate,
    city: z.string().min(1),
    country: z.enum(['nepal', 'japan']),
    items: z.array(contentItineraryItemSchema),
  })
  .strict();

export const contentItinerarySchema = z.array(contentDayPlanSchema);

// ── Guide content (lib/nepal-data.ts, lib/japan-data.ts — Recommendation) ──────────────────
// `category` is a free display string here (guide categories differ per country, e.g.
// 'Temple', 'Must-Visit', 'Ramen'); the cross-content invariant "category ∈ the country's
// *_CATEGORIES filter list" is checked in the validate:content suite, not the schema.
const imagePath = z.string().regex(/^\/images\//, 'must start with /images/');

export const recommendationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    description: z.string().min(1),
    bestTime: z.string().min(1),
    duration: z.string().min(1),
    photoRating: z.number().int().min(1).max(5),
    notes: z.string().min(1),
    location: z.string().min(1).optional(),
    image: imagePath.optional(),
    mustSee: z.boolean().optional(),
    longDescription: z.string().min(1).optional(),
    priceHint: z.string().min(1).optional(),
  })
  .strict();

// ── Nightlife (lib/nightlife-data.ts — NightlifeVenue) ─────────────────────────────────────
// Note: country here is CAPITALIZED ('Nepal' | 'Japan'), unlike DayPlan.country (lowercase).
// Mirror the shape verbatim — do not "normalize".
export const nightlifeVenueSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    location: z.string().min(1),
    vibe: z.string().min(1),
    musicType: z.string().min(1),
    priceRange: z.string().min(1),
    bestDays: z.string().min(1),
    description: z.string().min(1),
    mustSee: z.boolean().optional(),
    longDescription: z.string().min(1).optional(),
  })
  .strict();

// ── Photography (lib/photography-data.ts — PhotoSpot) ──────────────────────────────────────
export const photoSpotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    city: z.string().min(1),
    bestTime: z.string().min(1),
    style: z.string().min(1),
    gear: z.string().min(1),
    tip: z.string().min(1),
    category: z.string().min(1),
    image: imagePath.optional(),
    mustSee: z.boolean().optional(),
    longDescription: z.string().min(1).optional(),
  })
  .strict();

// ── Travel tips (lib/travel-tips-data.ts) ──────────────────────────────────────────────────
export const featuredDestinationSchema = z
  .object({
    name: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    blurb: z.string().min(1),
    emoji: z.string().min(1),
    image: imagePath.optional(),
  })
  .strict();

export const foodItemSchema = z
  .object({
    name: z.string().min(1),
    country: z.enum(['Nepal', 'Japan']),
    description: z.string().min(1),
    emoji: z.string().min(1),
  })
  .strict();

export const etiquetteTipSchema = z
  .object({
    title: z.string().min(1),
    country: z.enum(['Nepal', 'Japan', 'Both']),
    description: z.string().min(1),
    icon: z.string().min(1),
  })
  .strict();

// ── Bookings (lib/booking-data.ts — STRUCTURE ONLY, never recompute times/durations) ─
const cabinClasses = ['Economy', 'Premium Economy', 'Business', 'First'] as const;
const bookingStatus = ['booked', 'to-book'] as const;

export const flightLegSchema = z
  .object({
    id: z.string().min(1),
    flightNumber: z.string().min(1),
    fromCode: z.string().min(1),
    fromName: z.string().min(1),
    fromTerminal: z.string().min(1).optional(),
    toCode: z.string().min(1),
    toName: z.string().min(1),
    toTerminal: z.string().min(1).optional(),
    departLabel: z.string().min(1), // verbatim human label — NEVER parsed
    arriveLabel: z.string().min(1), // verbatim human label — NEVER parsed
    duration: z.string().min(1), // verbatim — NEVER recomputed
    seats: z.array(z.string().min(1)).optional(),
    cabin: z.enum(cabinClasses),
    cabinCode: z.string().min(1).optional(),
  })
  .strict();

export const layoverSchema = z
  .object({
    airportCode: z.string().min(1),
    airportName: z.string().min(1).optional(),
    duration: z.string().min(1), // verbatim — NEVER recomputed
  })
  .strict();

export const journeySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(bookingStatus),
    fromSummary: z.string().min(1),
    toSummary: z.string().min(1),
    totalDuration: z.string().min(1), // verbatim — NEVER recomputed
    legs: z.array(flightLegSchema).min(1),
    layovers: z.array(layoverSchema),
  })
  .strict()
  // The documented positional contract (booking-data.ts): layovers sit BETWEEN legs, so there
  // is always exactly one fewer layover than legs. This is a STRUCTURAL invariant (counts),
  // not time arithmetic.
  .superRefine((j, ctx) => {
    if (j.layovers.length !== j.legs.length - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layovers'],
        message: `layovers.length (${j.layovers.length}) must equal legs.length - 1 (${j.legs.length - 1})`,
      });
    }
  });

export const staySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    stars: z.number().int().min(1).max(5).nullable(),
    address: z.string().min(1).optional(),
    area: z.string().min(1).optional(),
    city: z.string().min(1),
    country: z.enum(['nepal', 'japan']),
    status: z.enum(bookingStatus),
    checkIn: z.string().min(1).optional(),
    checkOut: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .strict();

export const toBookPlaceholderSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['stay', 'flight']),
    label: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();
