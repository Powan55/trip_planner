// The shape of the active trip, for Home's stat row (issue #26).
//
// NOTHING IS COMPUTED HERE THAT THE APP DID NOT ALREADY COMPUTE. Every number below is a
// count over an EXISTING date-backbone answer, not a second derivation of the itinerary:
//
//   days      = TRIP_DATES.length      — the same value `components/trip-dashboard.tsx`
//                                        already shows as "Total Trip Duration"
//   cities    = distinct getCityForDate(date) over those dates
//   countries = distinct getCountryForDate(date) over those dates
//
// `getCityForDate` and `getCountryForDate` are the app's own per-day answers and both are
// TRIP-SCOPED (they consult the active trip and fall through to the active leg for a
// non-default pack), which is why this counts THROUGH them rather than reading the
// default pack's `TRIP_CITIES` map directly — that map is authored for the default trip
// only, and a custom trip would have been given the wrong cities silently.
//
// PURE and clock-free on purpose. The live half of the stat row is the countdown, and
// that has one implementation (`computeCountdown`, D-313) which this module does not
// touch, wrap or re-derive. Keeping the shape pure is also what makes it testable with no
// DOM and no clock, and what lets the row render its static cells before mount.

import { TRIP_DATES, getCityForDate, getCountryForDate } from '@/core/dates';

export interface TripShape {
  /** Inclusive day count of the active trip. */
  days: number;
  /** Distinct cities across those days. */
  cities: number;
  /** Distinct countries (legs) across those days. */
  countries: number;
}

/**
 * Count the active trip's days, cities and countries.
 *
 * Computed once per module load would be wrong for a trip switch, and per render would be
 * 32 lookups a frame, so callers should memoise it — `components/home-stat-row.tsx` calls
 * it inside a `useMemo`. It is cheap (one pass over ~32 dates) but not free.
 */
export function tripShape(): TripShape {
  const cities = new Set<string>();
  const countries = new Set<string>();
  for (const date of TRIP_DATES) {
    cities.add(getCityForDate(date));
    countries.add(getCountryForDate(date));
  }
  return { days: TRIP_DATES.length, cities: cities.size, countries: countries.size };
}
