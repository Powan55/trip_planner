/**
 * Core date backbone — the AUTHORITATIVE per-day trip-city map.
 * Framework-free: plain TS only, NO React / Next / `window`,
 * and — critically — NO `lib/` import. `core/` must not depend on `lib/`,
 * so the map's DATA is defined independently HERE. The anti-drift proof that this map
 * equals `lib/sample-itinerary.ts`'s per-day `city` values for every trip date lives in
 * `lib/__tests__/` (which is allowed to import both surfaces).
 *
 * Why this exists: previously, both `dayInTripFor` (`day-in-trip.ts`) and
 * `synthesizeDay` (`core/itinerary/crud.ts`) collapsed the trip-day city to `Kathmandu`
 * (any Nepal day) / `Tokyo` (any Japan day). That hid the day-trip cities (Nagarkot,
 * Bhaktapur, Kyoto, Osaka, …) from the hero travel-mode panel, the Today header, and the
 * weather card. This map restores the REAL per-day city; both sites call
 * `getCityForDate` so they share one source of truth.
 *
 * ── The two base cities are FROZEN by the boundary matrix ────────────────────────────────
 * Dec-9/12/18 → Kathmandu, Dec-19 & Jan-9 → Tokyo. Those five entries below MUST stay their
 * base-city values (they are the exact `SAMPLE_ITINERARY` cities on those dates too, so the
 * anti-drift test and the boundary net agree). The generalization only ADDS the day-trip cities
 * on the OTHER dates — it never changes a base-date city, so the frozen boundary net stays green.
 */

/**
 * ISO date ('YYYY-MM-DD') → the real city for that trip day. Copied from
 * `lib/sample-itinerary.ts`'s per-day `city` and pinned by the anti-drift unit test — the
 * two can never silently diverge. Exact city-name strings match the sample verbatim
 * (`Kawaguchiko`, not "Lake Kawaguchiko"; `Lalitpur`; `Yuzawa`).
 */
export const TRIP_CITIES: Record<string, string> = {
  // Nepal (Dec 9–18)
  '2026-12-09': 'Kathmandu',
  '2026-12-10': 'Kathmandu',
  '2026-12-11': 'Kathmandu',
  '2026-12-12': 'Kathmandu',
  '2026-12-13': 'Lalitpur',
  '2026-12-14': 'Nagarkot',
  '2026-12-15': 'Kathmandu',
  '2026-12-16': 'Bhaktapur',
  '2026-12-17': 'Kathmandu',
  '2026-12-18': 'Kathmandu',
  // Japan (Dec 19 – Jan 9)
  '2026-12-19': 'Tokyo',
  '2026-12-20': 'Tokyo',
  '2026-12-21': 'Tokyo',
  '2026-12-22': 'Tokyo',
  '2026-12-23': 'Tokyo',
  '2026-12-24': 'Tokyo',
  '2026-12-25': 'Tokyo',
  '2026-12-26': 'Hakone',
  '2026-12-27': 'Kyoto',
  '2026-12-28': 'Kyoto',
  '2026-12-29': 'Kyoto',
  '2026-12-30': 'Osaka',
  '2026-12-31': 'Tokyo',
  '2027-01-01': 'Tokyo',
  '2027-01-02': 'Kawaguchiko',
  '2027-01-03': 'Yuzawa',
  '2027-01-04': 'Nikko',
  '2027-01-05': 'Tokyo',
  '2027-01-06': 'Yokohama',
  '2027-01-07': 'Tokyo',
  '2027-01-08': 'Tokyo',
  '2027-01-09': 'Tokyo',
};

import { getCountryForDate } from './trip-dates';

/**
 * The city for a trip date (PURE, TOTAL). For any date IN the map returns its authoritative
 * city; for any UNMAPPED date (defensive — should never happen for an in-trip date) falls
 * back to the base-city default: `getCountryForDate(date) === 'nepal' ? 'Kathmandu' : 'Tokyo'`.
 * That keeps the function total and preserves a safe fallback for anything off the map.
 */
export function getCityForDate(dateStr: string): string {
  const mapped = TRIP_CITIES[dateStr];
  if (mapped !== undefined) return mapped;
  return getCountryForDate(dateStr) === 'nepal' ? 'Kathmandu' : 'Tokyo';
}
