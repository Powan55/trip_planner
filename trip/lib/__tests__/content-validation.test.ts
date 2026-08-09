import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// S122 `npm run validate:content` (D-135 LOCKED). This suite is the content
// layer's validator: it parses EVERY content domain against its STRICT authoring schema
// (core/content/schema.ts) and checks the cross-content invariants that keep a "green
// schemas" edit from still breaking the app (exact 32-date coverage, country-vs-date
// agreement, unique ids, weather-known cities, guide category ∈ filter list). It lives in
// lib/__tests__/ — the established home for cross-boundary tests that may import both `core/`
// and `lib/` surfaces. Aliased by `validate:content`; also runs as part of `npm test`/CI.
//
// The final describe block is the DELIBERATELY-BROKEN fixture: it proves the validator
// REJECTS each canonical breakage (red-proof), while the suite itself stays GREEN.

import {
  contentItinerarySchema,
  contentItineraryItemSchema,
  contentDayPlanSchema,
  recommendationSchema,
  nightlifeVenueSchema,
  photoSpotSchema,
  featuredDestinationSchema,
  foodItemSchema,
  etiquetteTipSchema,
  journeySchema,
  staySchema,
  toBookPlaceholderSchema,
} from '@/core/content/schema';
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD, NEPAL_CATEGORIES } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD, JAPAN_CATEGORIES } from '@/lib/japan-data';
import { NIGHTLIFE_VENUES } from '@/lib/nightlife-data';
import { PHOTO_SPOTS, PHOTO_CATEGORIES } from '@/lib/photography-data';
import { FEATURED_DESTINATIONS, LOCAL_FOODS, ETIQUETTE_TIPS } from '@/lib/travel-tips-data';
import { JOURNEYS, BOOKED_STAYS, JAPAN_TODO } from '@/lib/booking-data';
import { TRIP_DATES, getCountryForDate } from '@/core/dates';
import { isKnownWeatherCity } from '@/lib/weather';
import * as broken from './__fixtures__/broken-content';

// ── helpers ────────────────────────────────────────────────────────────────────────────────

/** Parse `value`; on failure throw an editor-friendly report naming the exact Zod path(s). */
function expectValid(schema: z.ZodTypeAny, value: unknown, label: string): void {
  const r = schema.safeParse(value);
  if (!r.success) {
    const lines = r.error.issues.map(
      (i) => `    ${label} → ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`${label} failed strict content validation:\n${lines.join('\n')}`);
  }
  expect(r.success).toBe(true);
}

function eachValid(schema: z.ZodTypeAny, rows: readonly unknown[], label: string): void {
  rows.forEach((row, i) => {
    const id = (row as { id?: string }).id;
    expectValid(schema, row, `${label}[${i}]${id ? ` ${id}` : ''}`);
  });
}

/** Duplicate values in a list (each duplicate reported once). */
function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

/** The set of issue path-strings a failed safeParse produced. */
function issuePaths(r: z.SafeParseReturnType<unknown, unknown>): string[] {
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

/** Whether any issue references `field` (via path, an unrecognized-keys entry, or the message). */
function issueMentions(r: z.SafeParseReturnType<unknown, unknown>, field: string): boolean {
  if (r.success) return false;
  return r.error.issues.some(
    (i) =>
      i.path.includes(field) ||
      i.message.includes(field) ||
      (i.code === 'unrecognized_keys' && (i as z.ZodUnrecognizedKeysIssue).keys.includes(field)),
  );
}

// ── (1) Per-domain strict-schema pass on LIVE content ────────────────────────────────────────

describe('validate:content — every content domain parses its STRICT schema', () => {
  it('itinerary content root — TRIP_ITINERARY (32 days)', () => {
    expectValid(contentItinerarySchema, TRIP_ITINERARY, 'TRIP_ITINERARY');
  });

  it('Nepal guides — attractions + food', () => {
    eachValid(recommendationSchema, NEPAL_ATTRACTIONS, 'NEPAL_ATTRACTIONS');
    eachValid(recommendationSchema, NEPAL_FOOD, 'NEPAL_FOOD');
  });

  it('Japan guides — attractions + food', () => {
    eachValid(recommendationSchema, JAPAN_ATTRACTIONS, 'JAPAN_ATTRACTIONS');
    eachValid(recommendationSchema, JAPAN_FOOD, 'JAPAN_FOOD');
  });

  it('nightlife venues', () => {
    eachValid(nightlifeVenueSchema, NIGHTLIFE_VENUES, 'NIGHTLIFE_VENUES');
  });

  it('photography spots', () => {
    eachValid(photoSpotSchema, PHOTO_SPOTS, 'PHOTO_SPOTS');
  });

  it('travel tips — featured / foods / etiquette', () => {
    eachValid(featuredDestinationSchema, FEATURED_DESTINATIONS, 'FEATURED_DESTINATIONS');
    eachValid(foodItemSchema, LOCAL_FOODS, 'LOCAL_FOODS');
    eachValid(etiquetteTipSchema, ETIQUETTE_TIPS, 'ETIQUETTE_TIPS');
  });

  it('bookings — journeys / stays / to-book (D-034: structure only)', () => {
    eachValid(journeySchema, JOURNEYS, 'JOURNEYS');
    eachValid(staySchema, BOOKED_STAYS, 'BOOKED_STAYS');
    eachValid(toBookPlaceholderSchema, JAPAN_TODO, 'JAPAN_TODO');
  });
});

// ── (2) Cross-content invariants on LIVE content ─────────────────────────────────────────────

describe('validate:content — cross-content invariants', () => {
  it('itinerary covers EXACTLY the 32 TRIP_DATES, in order, no dupes/extras', () => {
    expect(TRIP_ITINERARY.map((d) => d.date)).toEqual(TRIP_DATES);
  });

  it('every DayPlan.country agrees with getCountryForDate(date)', () => {
    for (const d of TRIP_ITINERARY) {
      expect(d.country, `country mismatch on ${d.date}`).toBe(getCountryForDate(d.date));
    }
  });

  it('itinerary item ids are globally unique across all days', () => {
    const ids = TRIP_ITINERARY.flatMap((d) => d.items.map((i) => i.id));
    expect(findDuplicates(ids)).toEqual([]);
  });

  it('guide / nightlife / photo / booking ids are unique per collection', () => {
    expect(findDuplicates(NEPAL_ATTRACTIONS.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(NEPAL_FOOD.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(JAPAN_ATTRACTIONS.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(JAPAN_FOOD.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(NIGHTLIFE_VENUES.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(PHOTO_SPOTS.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(JOURNEYS.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(BOOKED_STAYS.map((r) => r.id))).toEqual([]);
    expect(findDuplicates(JAPAN_TODO.map((r) => r.id))).toEqual([]);
  });

  it('every itinerary city is weather-known (no day loses weather)', () => {
    for (const d of TRIP_ITINERARY) {
      expect(isKnownWeatherCity(d.city), `${d.date} → ${d.city} has no weather coords`).toBe(true);
    }
  });

  it('every guide/photo category appears in its filter list (no card silently vanishes)', () => {
    for (const r of [...NEPAL_ATTRACTIONS, ...NEPAL_FOOD]) {
      expect(NEPAL_CATEGORIES, `Nepal category "${r.category}" (${r.id}) not in filter list`).toContain(
        r.category,
      );
    }
    for (const r of [...JAPAN_ATTRACTIONS, ...JAPAN_FOOD]) {
      expect(JAPAN_CATEGORIES, `Japan category "${r.category}" (${r.id}) not in filter list`).toContain(
        r.category,
      );
    }
    for (const p of PHOTO_SPOTS) {
      expect(PHOTO_CATEGORIES, `Photo category "${p.category}" (${p.id}) not in filter list`).toContain(
        p.category,
      );
    }
  });
});

// ── (3) Red-proof: the validator REJECTS each canonical breakage (suite stays green) ─────────

describe('validate:content — the validator HAS TEETH (broken fixture is rejected)', () => {
  it('rejects a bad itinerary category — issue path names `category`', () => {
    const r = contentItineraryItemSchema.safeParse(broken.badCategoryItem);
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('category');
  });

  it('rejects a malformed date — issue path names `date`', () => {
    const r = contentDayPlanSchema.safeParse(broken.malformedDateDay);
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('date');
  });

  it('rejects an unknown key — the unrecognized-keys issue names `foo`', () => {
    const r = contentItineraryItemSchema.safeParse(broken.unknownKeyItem);
    expect(r.success).toBe(false);
    expect(issueMentions(r, 'foo')).toBe(true);
  });

  it('rejects a missing required field — issue path names `title`', () => {
    const r = contentItineraryItemSchema.safeParse(broken.missingTitleItem);
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('title');
  });

  it('flags a duplicate id via the global-uniqueness invariant', () => {
    expect(findDuplicates(broken.duplicateIdItems.map((i) => i.id))).toContain('dup-1');
  });

  it('flags a day OFF the 32 TRIP_DATES via the coverage invariant', () => {
    const dates = broken.dayOffTripDates.map((d) => d.date);
    expect(dates.every((d) => TRIP_DATES.includes(d))).toBe(false);
  });

  it('prints the red-proof (what a rejection looks like — visible in the run output)', () => {
    const cases: Array<[string, z.SafeParseReturnType<unknown, unknown>]> = [
      ['badCategoryItem', contentItineraryItemSchema.safeParse(broken.badCategoryItem)],
      ['malformedDateDay', contentDayPlanSchema.safeParse(broken.malformedDateDay)],
      ['unknownKeyItem', contentItineraryItemSchema.safeParse(broken.unknownKeyItem)],
      ['missingTitleItem', contentItineraryItemSchema.safeParse(broken.missingTitleItem)],
    ];
    const report = cases
      .map(([name, r]) => {
        expect(r.success).toBe(false);
        if (r.success) return `${name}: UNEXPECTEDLY VALID`;
        const first = r.error.issues[0];
        return `  ✗ ${name} → ${first.path.join('.') || '(root)'}: ${first.message}`;
      })
      .join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n[validate:content red-proof — broken fixture correctly rejected]\n${report}\n`);
  });
});
