import { describe, it, expect } from 'vitest';

// S122 (D-136 AMENDS D-109) — the per-day trip-city suite. As of S122 `TRIP_CITIES` is
// DERIVED from the content root `core/content/itinerary.ts` (via `deriveTripCities`), not a
// hand-authored literal. So the old S100 "anti-drift map ≡ sample" test is now a
// DERIVATION-IDENTITY test: its headline guards against a future slice re-hand-authoring the
// map or decoupling the `SAMPLE_ITINERARY` delegate. The S82-frozen boundary dates, 32-date
// coverage, day-trip/transfer cities, totality, and weather-coverage assertions are RETAINED
// verbatim — their duty shifts from policing map↔sample drift (now impossible) to policing
// the CONTENT itself: an edit to a frozen boundary city goes loudly red and requires the
// deliberate S112/D-124-style lockstep with the frozen E2E specs (a known, deliberate coupling).

import {
  getCityForDate,
  TRIP_CITIES,
  TRIP_DATES,
  getCountryForDate,
  deriveTripCities,
} from '@/core/dates';
import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';
import { isKnownWeatherCity } from '@/lib/weather';

describe('S122 TRIP_CITIES — derivation identity (the map IS deriveTripCities(SAMPLE_ITINERARY))', () => {
  it('equals deriveTripCities(SAMPLE_ITINERARY) — no re-hand-authoring, no delegate decoupling', () => {
    // The new load-bearing invariant. With today's wiring this is true BY CONSTRUCTION
    // (TRIP_CITIES = deriveTripCities(TRIP_ITINERARY), and SAMPLE_ITINERARY IS TRIP_ITINERARY).
    // The test exists so it STAYS true by construction: any future slice that re-introduces a
    // hand-authored map, or breaks the delegate so SAMPLE_ITINERARY ≠ the content root, goes red.
    expect(TRIP_CITIES).toEqual(deriveTripCities(SAMPLE_ITINERARY));
  });

  it('every TRIP_DATES entry maps to exactly the sample itinerary city for that date', () => {
    // The derived map and the sample can never silently diverge — they are one value.
    for (const date of TRIP_DATES) {
      const sampleDay = SAMPLE_ITINERARY.find((d) => d.date === date);
      expect(sampleDay, `sample itinerary is missing a day for ${date}`).toBeDefined();
      expect(getCityForDate(date), `city mismatch on ${date}`).toBe(sampleDay!.city);
    }
  });

  it('covers all 32 trip dates (TRIP_CITIES has an entry for each; no extras that miss the sample)', () => {
    expect(TRIP_DATES).toHaveLength(32);
    // Every mapped date is a real trip date whose sample city equals the map.
    for (const [date, city] of Object.entries(TRIP_CITIES)) {
      expect(TRIP_DATES).toContain(date);
      const sampleDay = SAMPLE_ITINERARY.find((d) => d.date === date);
      expect(sampleDay!.city).toBe(city);
    }
    // Every trip date is in the map (total coverage — no in-trip date falls to the default).
    for (const date of TRIP_DATES) {
      expect(Object.prototype.hasOwnProperty.call(TRIP_CITIES, date)).toBe(true);
    }
  });
});

describe('S100 getCityForDate — the 5 S82-frozen boundary dates keep their base city', () => {
  // These are the exact dates the frozen S82 e2e/countdown.spec.ts asserts. The
  // generalization must NOT change them, or the S82 net breaks. (They are also the sample
  // cities on those dates, so this agrees with the derivation-identity test above.)
  it('Dec-9 -> New York (departure day), Dec-12 / Dec-18 -> Kathmandu (Nepal base)', () => {
    // D-315 (owner-ruled 2026-08-14, amending D-285): Dec 9 is spent in Syracuse, JFK and the air
    // and is NAMED New York — the traveller does not land in Kathmandu until Dec 10. The
    // day's `country` is still 'nepal' (leg id, drives currency + day offset), which is why this
    // date stays in the Nepal-base group. Changed in the deliberate S112/D-124-style lockstep
    // with the frozen E2E boundary specs.
    expect(getCityForDate('2026-12-09')).toBe('New York');
    expect(getCityForDate('2026-12-12')).toBe('Kathmandu');
    expect(getCityForDate('2026-12-18')).toBe('Kathmandu');
  });

  it('Dec-19 (Japan start / B-01 guard) -> Osaka (S112 reroute), Jan-9 (trip end) -> Tokyo', () => {
    // S112 (D-124): the Japan leg is now Osaka -> Kyoto -> Tokyo, so Dec-19 (the Japan-start /
    // B-01 boundary date) is Osaka, not Tokyo. The invariant the guard actually protects
    // ("Japan window, NOT Kathmandu") is unchanged; only the specific base-city string is.
    expect(getCityForDate('2026-12-19')).toBe('Osaka');
    expect(getCityForDate('2027-01-09')).toBe('Tokyo');
  });
});

describe('S100/S112 getCityForDate — transfer & day-trip dates are NOT collapsed to a single base city', () => {
  it('surfaces the REAL day-trip / transfer-day city (the whole point of the slice)', () => {
    // Nepal day trips (unchanged by S112 — Nepal is untouched).
    expect(getCityForDate('2026-12-13')).toBe('Lalitpur');
    expect(getCityForDate('2026-12-14')).toBe('Nagarkot'); // NOT Kathmandu
    expect(getCityForDate('2026-12-16')).toBe('Bhaktapur');
    // Japan transfer days (S112: Osaka -> Kyoto -> Tokyo boys-trip route). Per D-030 a
    // transfer day's city is the ARRIVAL city, not the origin.
    expect(getCityForDate('2026-12-24')).toBe('Kyoto'); // Osaka -> Kyoto transfer day
    expect(getCityForDate('2026-12-27')).toBe('Tokyo'); // Kyoto -> Tokyo transfer day
  });

  it('is pure — same date yields the same city, no clock/storage read', () => {
    expect(getCityForDate('2026-12-14')).toBe(getCityForDate('2026-12-14'));
  });
});

describe('S100 getCityForDate — total over unmapped dates (defensive country default)', () => {
  it('falls back to the pre-S100 country default for a date OFF the map', () => {
    // Not an in-trip date; should never hit this in practice, but the fn must stay total and
    // preserve the old behavior: nepal window -> Kathmandu, else Tokyo.
    const nepalDate = '2026-12-05'; // before the trip, lexicographically <= Nepal end
    const japanDate = '2027-02-01'; // after the trip
    expect(getCountryForDate(nepalDate)).toBe('nepal');
    expect(getCityForDate(nepalDate)).toBe('Kathmandu');
    expect(getCountryForDate(japanDate)).toBe('japan');
    expect(getCityForDate(japanDate)).toBe('Tokyo');
  });
});

describe('S100/S112 weather-coords coverage — every trip city is weather-queryable', () => {
  it('isKnownWeatherCity is true for all 8 canonical trip cities (no day loses weather)', () => {
    const uniqueCities = [...new Set(SAMPLE_ITINERARY.map((d) => d.city))].sort();
    // S112: the Japan leg is now a straight 3-city route (Osaka -> Kyoto -> Tokyo, no more
    // Hakone/Kawaguchiko/Yuzawa/Nikko/Yokohama day trips).
    // D-315: + New York, the Dec-9 departure day's city — so the trip names exactly these 8 cities
    // across the 32 days. Set EQUALITY, not `toContain`: an accidental 9th city goes red here.
    expect(uniqueCities).toEqual(
      ['Bhaktapur', 'Kathmandu', 'Kyoto', 'Lalitpur', 'Nagarkot', 'New York', 'Osaka', 'Tokyo'].sort(),
    );
    for (const city of uniqueCities) {
      expect(isKnownWeatherCity(city), `${city} has no weather coordinates`).toBe(true);
    }
  });

  it('every date resolves to a weather-known city (the map + coords line up end-to-end)', () => {
    for (const date of TRIP_DATES) {
      expect(isKnownWeatherCity(getCityForDate(date)), `${date} -> unknown weather city`).toBe(
        true,
      );
    }
  });
});
