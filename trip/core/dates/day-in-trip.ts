/**
 * Core date backbone — the PURE "where in the trip is this instant" math (;
 *). Framework-free: takes a `now: Date` and returns the trip-day, or `null`
 * when outside the window. Extracted from `lib/trip-now.ts`'s `getTodayInTrip`; the
 * adapter there now reads the clock (`getNow()`, incl. the `?today=` override) and hands
 * the resulting Date to this function. The impurity (clock read) stays in the adapter;
 * only this deterministic mapping moves to core.
 *
 * Frozen by the E2E boundary matrix (Dec-9→Day1, Dec-18→Day10 Kathmandu,
 * Dec-19→Day11 Tokyo, Jan-9→Day32) — carried VERBATIM.
 */
import { TRIP_DATES, getCountryForDate } from './trip-dates';
import { getCityForDate } from './trip-cities';

export interface TripToday {
  date: string;
  dayNumber: number;
  city: string;
  // Leg id (: `string`, not the `'nepal' | 'japan'` union — a custom trip's single leg is
  // `'main'`). For the DEFAULT pack it is still exactly nepal/japan.
  country: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The trip-day for the given `now`, or `null` when it falls outside the trip window.
 *
 * `offsetMin` is INJECTED by the `lib/trip-now.ts` adapter — this function
 * stays pure/`page.clock`-testable, the impure clock/leg read stays in the adapter:
 * - `null`/omitted (default): the calendar day from `now`'s LOCAL parts (NOT
 * `toISOString()`, which is UTC and can slip a day at the edges) — byte-identical to
 * the pre- behavior. Used for the `?today=` override and custom
 * trips (no known geography).
 * - a number: the destination-leg wall-clock day via `utcDayAtOffset` — the real clock,
 * re-derived at the trip's own fixed offset so a home-time phone shows the right day.
 *
 * Either way the day string is looked up in TRIP_DATES — the single date source.
 * Day N = index + 1. The `city` comes from `getCityForDate` — the SAME per-day city
 * source `synthesizeDay` (`core/itinerary/crud.ts`) uses — so the hero travel-mode label,
 * the Today header, and the stored day plans all agree, now showing the REAL day-trip city
 * (Nagarkot, Kyoto, …), not just the base city.
 */
export function dayInTripFor(now: Date, offsetMin?: number | null): TripToday | null {
  const s =
    offsetMin == null
      ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` // device-local (unchanged)
      : utcDayAtOffset(now, offsetMin);
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

/**
 * Destination calendar day for a UTC instant read at a fixed wall-clock offset (
 *). B-01-safe: shift the epoch-ms, then UTC getters only (never `new Date(string)`,
 * never a local getter) — TZ-deterministic regardless of device TZ.
 */
export function utcDayAtOffset(now: Date, offsetMin: number): string {
  const t = new Date(now.getTime() + offsetMin * 60000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
