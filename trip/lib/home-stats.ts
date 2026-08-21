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
// PURE on purpose, and `tripShape` is clock-free. The live half of the stat row is the
// countdown, and that has one implementation (`computeCountdown`, D-313) which this module
// does not touch, wrap or re-derive. Keeping the shape pure is also what makes it testable
// with no DOM and no clock, and what lets the row render its static cells before mount.
// `daysToGo` below takes its clock as an ARGUMENT for the same reason `computeCountdown`
// does — nothing here reads a clock of its own.

import { differenceInCalendarDays } from 'date-fns';
import { TRIP_DATES, TRIP_START, getCityForDate, getCountryForDate } from '@/core/dates';

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

/**
 * Calendar days from `now` until the trip's first day — "how many sleeps".
 *
 * THE ONE DERIVATION OF THIS NUMBER. Home renders it twice in a single frame (the hero
 * ring's "days to go" digit and its ring fraction, and the stat row's live cell) and
 * `/travel` renders it a third time as `daysUntilStart`. Each used to work it out for
 * itself, so the hero's ring and the stat row printed numbers one apart at every instant
 * except exactly local midnight: 2026-12-08T09:00 read 0 in the ring and 1 in the row.
 *
 * It is `differenceInCalendarDays`, NOT `computeCountdown(TRIP_START, now).totalDays`.
 * `totalDays` is a truncated 24-hour count that borrows the partly-spent day into the
 * hour/minute/second residue, so it reads 0 for the whole day before departure. It is
 * correct for what it claims and D-313 (LOCKED) governs it; it is simply not this
 * question. `computeCountdown` is untouched — the hero's month/week/day grid still reads
 * it, and the grid still disagrees with the ring exactly as D-313 accepted.
 *
 * Negative once the trip has started, which is why every caller guards the pre-trip case
 * before rendering it.
 */
export function daysToGo(now: Date): number {
  return differenceInCalendarDays(TRIP_START, now);
}
