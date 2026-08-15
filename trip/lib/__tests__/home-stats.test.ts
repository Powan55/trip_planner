import { describe, it, expect } from 'vitest';

// Issue #26 — Home's stat row reads numbers the app already works out, and this is what
// pins that claim. The point is NOT that the counts are 32/2/8 (content changes, and a
// test that hard-codes content becomes a chore); it is that each count still comes from the
// SAME producer the rest of the app reads, so a second, drifting derivation cannot appear
// here without going red.
//
// The one hard number asserted is `days`, because `components/trip-dashboard.tsx` puts the
// exact same value on the exact same page as "Total Trip Duration". Two cards on one screen
// disagreeing about how long the trip is would be the visible failure.

import { tripShape } from '@/lib/home-stats';
import { TRIP_DATES, getCityForDate, getCountryForDate } from '@/core/dates';

describe('issue #26 — the Home stat row counts what the date backbone already answers', () => {
  it('days is TRIP_DATES.length, the same value the dashboard shows', () => {
    expect(tripShape().days).toBe(TRIP_DATES.length);
  });

  it('cities and countries are the DISTINCT per-day answers, not a second derivation', () => {
    const cities = new Set(TRIP_DATES.map(getCityForDate));
    const countries = new Set(TRIP_DATES.map(getCountryForDate));
    expect(tripShape().cities).toBe(cities.size);
    expect(tripShape().countries).toBe(countries.size);
  });

  it('every count is a positive integer, and cities never collapse below countries', () => {
    const { days, cities, countries } = tripShape();
    for (const [name, n] of [['days', days], ['cities', cities], ['countries', countries]] as const) {
      expect(Number.isInteger(n), `${name} is not an integer`).toBe(true);
      expect(n, `${name} is not positive`).toBeGreaterThan(0);
    }
    // A country the trip visits has at least one city in it, so this ordering holds for any
    // content pack. It is the cheap check that catches the two Sets being swapped — which is
    // otherwise invisible, because both are small numbers rendered in adjacent cells.
    expect(cities).toBeGreaterThanOrEqual(countries);
    // And you cannot visit more distinct cities than you have days.
    expect(cities).toBeLessThanOrEqual(days);
  });
});
