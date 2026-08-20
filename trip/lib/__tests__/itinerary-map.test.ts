import { describe, it, expect } from 'vitest';
import { buildItineraryStops, matchMarker, stopMarkerFor } from '@/lib/itinerary-map';
import { MAP_MARKERS } from '@/lib/map-data';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * S137 — manual pin-drop plot logic. Proves, at the pure-function level (no browser):
 *  1. a legacy item with no pin still resolves via the existing name/sourceId match
 *     (byte-identical pre-S137 behavior, S135/S136's `matchMarker` untouched);
 *  2. a pinned custom item (title matches NO curated marker) plots at its own coords;
 *  3. a pin BEATS a name match when an item happens to carry both;
 *  4. `buildItineraryStops` includes pinned custom items as real stops (not skipped),
 *     with the day/date bookkeeping intact.
 */

function day(date: string, country: 'nepal' | 'japan', items: ItineraryItem[]): DayPlan {
  return { date, city: country === 'nepal' ? 'Kathmandu' : 'Tokyo', country, items };
}

describe('S137 — stopMarkerFor: pin beats name match; legacy items unaffected', () => {
  it('a legacy item (no pin) with a matching title still resolves via matchMarker', () => {
    const item: ItineraryItem = { id: 'a', title: 'Sunrise at Boudhanath Stupa', category: 'photography' };
    const viaMatch = matchMarker(item);
    const viaStop = stopMarkerFor(item, 'Nepal');
    expect(viaStop).toEqual(viaMatch);
    expect(viaStop?.id).toBe('np-boudhanath');
  });

  it('a custom item with NO pin and NO matching title resolves to null (unmapped)', () => {
    const item: ItineraryItem = { id: 'b', title: 'Grab a taxi to the airport', category: 'transportation' };
    expect(stopMarkerFor(item, 'Nepal')).toBeNull();
  });

  it('a pinned custom item (no marker match) plots at its own coords', () => {
    const item: ItineraryItem = {
      id: 'c',
      title: 'Family friend’s house',
      category: 'sightseeing',
      lat: 27.71,
      lng: 85.32,
      location: 'Baneshwor',
    };
    const marker = stopMarkerFor(item, 'Nepal');
    expect(marker).not.toBeNull();
    expect(marker!.id).toBe('c');
    expect(marker!.lat).toBe(27.71);
    expect(marker!.lng).toBe(85.32);
    expect(marker!.country).toBe('Nepal');
    expect(marker!.area).toBe('Baneshwor');
  });

  it('a pin BEATS a name match — an item whose title matches a curated marker but also carries a pin plots at the PIN, not the curated coords', () => {
    const item: ItineraryItem = {
      id: 'd',
      title: 'Boudhanath Stupa', // would match np-boudhanath (27.7215, 85.3620)
      category: 'photography',
      lat: 1.23,
      lng: 4.56,
    };
    const marker = stopMarkerFor(item, 'Nepal');
    expect(marker!.id).toBe('d'); // synthesized, NOT 'np-boudhanath'
    expect(marker!.lat).toBe(1.23);
    expect(marker!.lng).toBe(4.56);
  });

  it('category maps to a sensible curated category, defaulting to Attraction for an unmapped one', () => {
    const foodItem: ItineraryItem = { id: 'e', title: 'Custom noodle stall', category: 'food', lat: 1, lng: 1 };
    expect(stopMarkerFor(foodItem, 'Japan')!.category).toBe('Restaurant');
    const transitItem: ItineraryItem = { id: 'f', title: 'Custom bus stop', category: 'transportation', lat: 1, lng: 1 };
    expect(stopMarkerFor(transitItem, 'Japan')!.category).toBe('Attraction');
  });
});

/**
 * S379 — the derived alias must stay DISCRIMINATING.
 *
 * `NAME_INDEX` strips place-type words ("castle", "taisha", …) off a marker's name
 * to build a short alias, so "Dawn at Fushimi Inari" resolves to "Fushimi Inari
 * Taisha". The mechanism is sound; it went wrong when the stripped alias collapsed
 * to the name of the CITY the marker sits in — "Osaka Castle" → "osaka" — after
 * which any item merely mentioning Osaka claimed the Osaka Castle pin. Measured on
 * the curated seed: 19 of 61 matched items were plotted at a place their title and
 * location never named, all 19 at Osaka Castle.
 *
 * A wrong pin looks exactly like a right pin, so these are the assertions that make
 * the defect visible. The generic-city case is driven off the REAL marker set, not
 * a hand-written list, so a future marker named "<City> <PlaceType>" is caught too.
 */
describe('S379 — a generic city word must not claim a specific landmark pin', () => {
  it('"Universal Studios Japan" does NOT plot at Osaka Castle', () => {
    const item: ItineraryItem = {
      id: 'usj',
      title: 'Universal Studios Japan — Super Nintendo World',
      category: 'sightseeing',
      location: 'Universal Studios Japan, Konohana, Osaka',
    };
    expect(matchMarker(item)?.id ?? null).not.toBe('jp-osaka-castle');
  });

  it('"Check out of Osaka hotel" does NOT plot at Osaka Castle', () => {
    const item: ItineraryItem = {
      id: 'ckout',
      title: 'Check out of Osaka hotel',
      category: 'hotel',
      location: 'Osaka',
    };
    expect(matchMarker(item)?.id ?? null).not.toBe('jp-osaka-castle');
  });

  it('"Osaka → Kyoto by JR train" does NOT plot at Osaka Castle', () => {
    const item: ItineraryItem = {
      id: 'jr',
      title: 'Osaka → Kyoto by JR train',
      category: 'transportation',
      location: 'Osaka → Kyoto',
    };
    expect(matchMarker(item)?.id ?? null).not.toBe('jp-osaka-castle');
  });

  // Driven off the real data: for every marker whose `area` names a containing city,
  // that bare city word alone must not resolve to the marker. Without this the fix
  // could be faked by special-casing one string.
  it('no marker is claimed by the bare name of the city that contains it', () => {
    const cities = new Set(
      MAP_MARKERS.map((mk) => (mk.area.includes(',') ? mk.area.split(',').pop()!.trim() : null)).filter(
        (c): c is string => !!c,
      ),
    );
    expect(cities.size).toBeGreaterThan(0); // the extraction actually found cities
    for (const city of cities) {
      const item: ItineraryItem = { id: `c-${city}`, title: `Free evening in ${city}`, category: 'free' };
      expect(matchMarker(item), `bare city "${city}" claimed a landmark pin`).toBeNull();
    }
  });

  // The anti-vacuous half: the alias mechanism itself must survive the fix.
  it('the alias mechanism still resolves a partial landmark name', () => {
    expect(matchMarker({ id: 'f', title: 'Dawn at Fushimi Inari', category: 'photography' })?.id).toBe('jp-fushimi');
    expect(matchMarker({ id: 'b', title: 'Sunset at Boudhanath', category: 'photography' })?.id).toBe('np-boudhanath');
  });

  it('a district-level alias still resolves (the fix must not over-correct)', () => {
    expect(
      matchMarker({ id: 't', title: "Sam's Bar social night", category: 'nightlife', location: 'Thamel, Kathmandu' })
        ?.id,
    ).toBe('np-thamel');
    expect(matchMarker({ id: 'n', title: 'Pre-dawn drive to Nagarkot', category: 'transportation' })?.id).toBe(
      'np-nagarkot',
    );
  });

  it('the landmark itself still resolves by its full name', () => {
    expect(matchMarker({ id: 'oc', title: 'Osaka Castle & grounds', category: 'sightseeing' })?.id).toBe(
      'jp-osaka-castle',
    );
  });
});

describe('S137 — buildItineraryStops includes pinned custom items as real stops', () => {
  it('a day with one legacy-matched item and one pinned custom item yields TWO stops', () => {
    const plans: DayPlan[] = [
      day('2026-12-12', 'nepal', [
        { id: 'legacy', title: 'Boudhanath Stupa', category: 'cultural' },
        { id: 'pinned', title: 'Rooftop breakfast spot', category: 'food', lat: 27.71, lng: 85.31 },
        { id: 'unmapped', title: 'Errand around town', category: 'free' }, // no pin, no match → skipped
      ]),
    ];
    const stops = buildItineraryStops(plans);
    expect(stops).toHaveLength(2);
    const ids = stops.map((s) => s.marker.id).sort();
    expect(ids).toEqual(['np-boudhanath', 'pinned']);
    const pinnedStop = stops.find((s) => s.marker.id === 'pinned')!;
    // ⚠️ This asserted `1` until issue #1. It was not a typo: `day` was the stop's INDEX in
    // the `DayPlan[]` handed in, and this call hands in one day — so every stop /plan and
    // /travel ever drew claimed to be Day 1. It is now the trip-day number of the DATE, and
    // 2026-12-12 is the trip's fourth day. See `tripDayNumber`.
    expect(pinnedStop.day).toBe(4);
    expect(pinnedStop.date).toBe('2026-12-12');
    expect(pinnedStop.title).toBe('Rooftop breakfast spot');
  });

  it('a legacy no-pin item still name-matches exactly as before (byte-identical marker)', () => {
    const plans: DayPlan[] = [day('2026-12-19', 'japan', [{ id: 'x', title: 'Fushimi Inari Taisha', category: 'cultural' }])];
    const stops = buildItineraryStops(plans);
    expect(stops).toHaveLength(1);
    expect(stops[0].marker.id).toBe('jp-fushimi');
    expect(stops[0].marker.lat).toBe(34.9671); // curated coords, untouched
  });
});
