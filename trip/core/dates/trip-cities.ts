/**
 * Core date backbone — the AUTHORITATIVE per-day trip-city map. Framework-free:
 * plain TS only, NO React / Next / `window`, and — critically — NO `lib/` import.
 * `core/` must not depend on `lib/`, so the map's DATA is defined independently
 * HERE. The anti-drift proof that this map equals `lib/sample-itinerary.ts`'s
 * per-day `city` values for every trip date lives in `lib/__tests__/` (which is
 * allowed to import both surfaces).
 *
 * Why this exists: previously, both `dayInTripFor` (`day-in-trip.ts`) and
 * `synthesizeDay` (`core/itinerary/crud.ts`) collapsed the trip-day city to
 * `Kathmandu` (any Nepal day) / `Tokyo` (any Japan day). That hid the day-trip
 * cities (Nagarkot, Bhaktapur, Kyoto, Osaka, …) from the hero travel-mode panel,
 * the Today header, and the weather card. This map restores the REAL per-day
 * city; both sites now call `getCityForDate` so they share one source of truth.
 *
 * ── The base cities are FROZEN by the boundary matrix ────────────────────────
 * Dec-9/12/18 → Kathmandu (unchanged). Jan-9 → Tokyo (unchanged, trip end). Dec-19
 * (Japan start / the regression guard) was `Tokyo` and is now `Osaka` — the Japan
 * leg was rerouted to an Osaka -> Kyoto -> Tokyo route; the frozen E2E boundary
 * specs (`e2e/countdown.spec.ts`) were updated in lockstep, so the guard's actual
 * invariant ("Japan window, NOT Kathmandu") stays green even though the specific
 * city string changed.
 *
 * ── Osaka -> Kyoto -> Tokyo route ─────────────────────────────────────────────
 * Osaka 5 nights (Dec 19–24) → Kyoto 4 nights (Dec 24–28) → Tokyo 12 nights (Dec 28–Jan 9).
 * Transfer days use the ARRIVAL city (Dec 24 → Kyoto, Dec 28 → Tokyo). No more
 * Hakone/Kawaguchiko/Yuzawa/Nikko/Yokohama day trips — this is a straight 3-city itinerary.
 */

/**
 * ISO date ('YYYY-MM-DD') → the real city for that trip day. Copied from
 * `lib/sample-itinerary.ts`'s per-day `city` and pinned by the anti-drift unit test — the
 * two can never silently diverge. Exact city-name strings match the sample verbatim
 * (`Lalitpur`; `Nagarkot`; `Bhaktapur`).
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
  // Japan (Dec 19 – Jan 9) — Osaka -> Kyoto -> Tokyo route.
  // Osaka 5 nights (Dec 19-24), Kyoto 4 nights (Dec 24-28), Tokyo 12 nights (Dec 28-Jan 9).
  // Transfer days use the ARRIVAL city: Dec 24 -> Kyoto, Dec 28 -> Tokyo.
  '2026-12-19': 'Osaka',
  '2026-12-20': 'Osaka',
  '2026-12-21': 'Osaka',
  '2026-12-22': 'Osaka',
  '2026-12-23': 'Osaka',
  '2026-12-24': 'Kyoto',
  '2026-12-25': 'Kyoto',
  '2026-12-26': 'Kyoto',
  '2026-12-27': 'Kyoto',
  '2026-12-28': 'Tokyo',
  '2026-12-29': 'Tokyo',
  '2026-12-30': 'Tokyo',
  '2026-12-31': 'Tokyo',
  '2027-01-01': 'Tokyo',
  '2027-01-02': 'Tokyo',
  '2027-01-03': 'Tokyo',
  '2027-01-04': 'Tokyo',
  '2027-01-05': 'Tokyo',
  '2027-01-06': 'Tokyo',
  '2027-01-07': 'Tokyo',
  '2027-01-08': 'Tokyo',
  '2027-01-09': 'Tokyo',
};

import { getCountryForDate } from './trip-dates';

/**
 * The city for a trip date (PURE, TOTAL). For any date IN the map returns its authoritative
 * city; for any UNMAPPED date (defensive — should never happen for an in-trip date) falls
 * back to the default: `getCountryForDate(date) === 'nepal' ? 'Kathmandu' : 'Tokyo'`.
 * That keeps the function total and preserves the exact old behavior for anything off the map.
 */
export function getCityForDate(dateStr: string): string {
  const mapped = TRIP_CITIES[dateStr];
  if (mapped !== undefined) return mapped;
  return getCountryForDate(dateStr) === 'nepal' ? 'Kathmandu' : 'Tokyo';
}
