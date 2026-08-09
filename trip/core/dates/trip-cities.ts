/**
 * Core date backbone — the per-day trip-city map (;;
 *). As of this map is **DERIVED** from the content root
 * `core/content/itinerary.ts` — it is no longer a hand-authored
 * 32-entry literal. Framework-free: plain TS only, NO React / Next / `window`.
 *
 * ── Why derived now ──────────────────────────────────────────────────────────────
 * Pre- the map's DATA was hand-authored HERE and duplicated the sample itinerary's
 * per-day `city`, kept honest by an anti-drift unit test — because the content source lived
 * in `lib/` and `core/` may not import `lib/` at runtime. moved that content
 * source INTO `core/content/`, so `TRIP_CITIES` now computes straight from it via a
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
 * Before both `dayInTripFor` (`day-in-trip.ts`) and `synthesizeDay`
 * (`core/itinerary/crud.ts`) collapsed the trip-day city to `Kathmandu` (any Nepal day) /
 * `Tokyo` (any Japan day). That hid the day-trip cities (Nagarkot, Bhaktapur, Kyoto, Osaka,
 * …) from the hero travel-mode panel, the Today header, and the weather card. This map
 * restores the REAL per-day city; both sites call `getCityForDate`.
 *
 * ── The base cities are FROZEN by the boundary matrix ────────────────────────────────
 * Dec-9/12/18 → Kathmandu. Jan-9 → Tokyo (trip end). Dec-19 (Japan start / the B-01
 * regression guard) is `Osaka` ( replaced the Japan leg with Osaka -> Kyoto ->
 * Tokyo; the frozen E2E boundary specs were updated in lockstep, so the guard's invariant
 * "Japan window, NOT Kathmandu" stays green). These cities are now authored in the content
 * root — an edit to a frozen boundary city goes loudly red and requires the deliberate
 *-style lockstep with the frozen E2E specs (a known, deliberate coupling).
 *
 * ── route ────────────────────────────────────────────────────
 * Osaka 5 nights (Dec 19–24) → Kyoto 3 nights (Dec 24–27) → Tokyo 13 nights (Dec 27–Jan 9).
 * Transfer days use the ARRIVAL city per (Dec 24 → Kyoto, Dec 27 → Tokyo). No more
 * Hakone/Kawaguchiko/Yuzawa/Nikko/Yokohama day trips — this is a straight 3-city itinerary.
 */

import { TRIP_ITINERARY } from '../content/itinerary';
import { getActiveTrip, isDefaultTrip, legForDate } from '@/core/trips';

// Both captured at MODULE LOAD — correct by design: a trip switch is a pointer write + full page
// reload, so a fresh module graph re-captures the new active trip. (Mirrors the
// core/budget/model.ts module-load pattern; the custom-trip unit test re-imports via vi.resetModules.)
const activeTrip = getActiveTrip();
const activeIsDefault = isDefaultTrip();

/**
 * PURE: `DayPlan[]` (only `date` + `city` are read) → the per-day ISO-date → city map.
 * Exported so the derivation-identity test can assert `TRIP_CITIES ≡ deriveTripCities(...)`
 * and no future change can silently re-hand-author the map or decouple the delegate.
 */
export function deriveTripCities(
  days: readonly { date: string; city: string }[],
): Record<string, string> {
  return Object.fromEntries(days.map((d) => [d.date, d.city]));
}

/**
 * ISO date ('YYYY-MM-DD') → the real city for that trip day. DERIVED from the content root
 *, so the map can never silently diverge from the itinerary — the two are one value.
 */
export const TRIP_CITIES: Record<string, string> = deriveTripCities(TRIP_ITINERARY);

/**
 * The city for a trip date (PURE, TOTAL). TRIP_SCOPED: the default-pack per-day
 * map (`TRIP_CITIES`) is authored for the DEFAULT trip only, so it is consulted ONLY when the
 * active trip is the default pack. For a non-default (custom) trip — which has no authored
 * per-day cities, just legs with `fallbackCity` — every date resolves via
 * `legForDate(activeTrip, date).fallbackCity` (its own leg city), so a custom trip overlapping
 * the default Dec 9 – Jan 9 window no longer wrongly shows Kathmandu/Osaka/Tokyo.
 *
 * DEFAULT path is byte-identical to pre-: map hit → authoritative city; UNMAPPED date
 * (defensive — never happens for an in-trip default date) → the active leg's `fallbackCity`
 *.
 */
export function getCityForDate(dateStr: string): string {
  if (activeIsDefault) {
    const mapped = TRIP_CITIES[dateStr];
    if (mapped !== undefined) return mapped;
  }
  return legForDate(activeTrip, dateStr).fallbackCity;
}
