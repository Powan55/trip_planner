/**
 * Core date backbone — the per-day trip-city map. This map is **DERIVED** from the
 * content root `core/content/itinerary.ts` — it is no longer a hand-authored
 * 32-entry literal. Framework-free: plain TS only, NO React / Next / `window`.
 *
 * ── Why derived ──────────────────────────────────────────────────────────────
 * The map's DATA used to be hand-authored HERE and duplicated the sample itinerary's
 * per-day `city`, kept honest by an anti-drift unit test — because the content source lived
 * in `lib/` and `core/` may not import `lib/` at runtime. The content source was later moved
 * INTO `core/content/`, so `TRIP_CITIES` now computes straight from it via a
 * core→core import. The drift class the anti-drift test policed is eliminated
 * by construction; `lib/__tests__/trip-cities.test.ts` becomes a derivation-identity test
 * that keeps the boundary / coverage / day-trip / weather assertions verbatim.
 *
 * ── Import-cycle guard (LOAD-BEARING) ────────────────────────────────────────────────────
 * The arrow is ONE-WAY: this module imports `core/content/itinerary.ts`; the content root
 * imports NOTHING from `core/dates`. Keep it that way. `DayPlan.country`-vs-date agreement
 * is a `validate:content` check, not a derivation, precisely to avoid the content root
 * having to import `core/dates`.
 *
 * ── Why the per-day cities exist ──────────────────────────────────────────────────
 * Previously, both `dayInTripFor` (`day-in-trip.ts`) and `synthesizeDay`
 * (`core/itinerary/crud.ts`) collapsed the trip-day city to `Kathmandu` (any Nepal day) /
 * `Tokyo` (any Japan day). That hid the day-trip cities (Nagarkot, Bhaktapur, Kyoto, Osaka,
 * …) from the hero travel-mode panel, the Today header, and the weather card. This map
 * restores the REAL per-day city; both sites call `getCityForDate` (one source of truth).
 *
 * ── The base cities are FROZEN by the boundary test matrix ────────────────────────────────
 * Dec-9/12/18 → Kathmandu. Jan-9 → Tokyo (trip end). Dec-19 (Japan start / the B-01
 * regression guard) is `Osaka` (the Japan leg was replaced with Osaka -> Kyoto ->
 * Tokyo; the frozen E2E boundary specs were updated in lockstep, so the guard's invariant
 * "Japan window, NOT Kathmandu" stays green). These cities are now authored in the content
 * root — an edit to a frozen boundary city goes loudly red and requires a deliberate
 * lockstep update to the frozen E2E specs (flag for review).
 *
 * ── Route ────────────────────────────────────────────────────────────────
 * Osaka 5 nights (Dec 19–24) → Kyoto 3 nights (Dec 24–27) → Tokyo 13 nights (Dec 27–Jan 9).
 * Transfer days use the ARRIVAL city (Dec 24 → Kyoto, Dec 27 → Tokyo). No more
 * Hakone/Kawaguchiko/Yuzawa/Nikko/Yokohama day trips — this is a straight 3-city itinerary.
 */

import { TRIP_ITINERARY } from '../content/itinerary';
import { getCountryForDate } from './trip-dates';

/**
 * PURE: `DayPlan[]` (only `date` + `city` are read) → the per-day ISO-date → city map.
 * Exported so the derivation-identity test can assert `TRIP_CITIES ≡ deriveTripCities(...)`
 * and no future slice can silently re-hand-author the map or decouple the delegate.
 */
export function deriveTripCities(
  days: readonly { date: string; city: string }[],
): Record<string, string> {
  return Object.fromEntries(days.map((d) => [d.date, d.city]));
}

/**
 * ISO date ('YYYY-MM-DD') → the real city for that trip day. DERIVED from the content root,
 * so the map can never silently diverge from the itinerary — the two are one value.
 */
export const TRIP_CITIES: Record<string, string> = deriveTripCities(TRIP_ITINERARY);

/**
 * The city for a trip date (PURE, TOTAL). For any date IN the map returns its authoritative
 * city; for any UNMAPPED date (defensive — should never happen for an in-trip date) falls
 * back to the original default: `getCountryForDate(date) === 'nepal' ? 'Kathmandu' : 'Tokyo'`.
 * That keeps the function total and preserves the exact old behavior for anything off the map.
 */
export function getCityForDate(dateStr: string): string {
  const mapped = TRIP_CITIES[dateStr];
  if (mapped !== undefined) return mapped;
  return getCountryForDate(dateStr) === 'nepal' ? 'Kathmandu' : 'Tokyo';
}
