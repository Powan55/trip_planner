/**
 * Core date backbone — the PURE "where in the trip is this instant" math.
 * Framework-free: takes a `now: Date` and returns the trip-day, or `null`
 * when outside the window. The `lib/trip-now.ts` adapter reads the clock (`getNow()`,
 * incl. the `?today=` override) and hands the resulting Date to this function. The
 * impurity (clock read) stays in the adapter; only this deterministic mapping lives in core.
 *
 * The E2E boundary matrix (Dec-9→Day1, Dec-18→Day10 Kathmandu,
 * Dec-19→Day11 Tokyo, Jan-9→Day32) pins this behavior.
 */
import { TRIP_DATES, getCountryForDate } from './trip-dates';
import { getCityForDate } from './trip-cities';

export interface TripToday {
  date: string;
  dayNumber: number;
  city: string;
  country: 'nepal' | 'japan';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The trip-day for the given `now`, or `null` when it falls outside the trip window.
 *
 * Formats `now` to a LOCAL calendar-day string from local parts (NOT `toISOString()`,
 * which is UTC and can slip a day at the edges), then looks it up in TRIP_DATES — the
 * single date source. Day N = index + 1. The `city` comes from `getCityForDate` —
 * the SAME per-day city source `synthesizeDay` (`core/itinerary/crud.ts`) uses —
 * so the hero travel-mode label, the Today header, and the stored day plans all agree,
 * showing the REAL day-trip city (Nagarkot, Kyoto, …), not just the base city.
 */
export function dayInTripFor(now: Date): TripToday | null {
  const s = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const i = TRIP_DATES.indexOf(s);
  if (i < 0) return null;
  const country = getCountryForDate(s);
  return {
    date: s,
    dayNumber: i + 1,
    country,
    city: getCityForDate(s),
  };
}
