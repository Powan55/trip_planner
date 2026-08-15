// Visit auto-counting — the itinerary counts a city when its day arrives, and a one-shot
// location check on day change either confirms that or says nothing (issue #30, D-320).
//
// DELIBERATELY A HYBRID. The planned half credits a city you never actually reached; the GPS half
// is what would catch that, and it only ever ADDS. Nothing here removes a visit, because a check
// that did not fire, was refused, or matched nothing is indistinguishable from one that was never
// asked — and "you were not in Kyoto" is not a claim a single missed fix can support.
//
// ── The four hard rules, and where each one is enforced ───────────────────────────────────────
// 1. **No raw coordinates are ever persisted.** `matchPlace` takes a latitude and a longitude and
//    returns a city NAME. That is the only function in the app that sees a device fix, it is pure,
//    and its result is the only thing that reaches storage (`core/places/visited.ts`, key 33, whose
//    shape has nowhere to put a coordinate). The `GeolocationPosition` is never stored, never
//    logged, never sent anywhere, and is unreachable the moment the callback returns.
// 2. **One shot, on day change only.** `getCurrentPosition`, never `watchPosition`, never a timer.
//    The trip-clock day is written to `checkedOn` BEFORE the request, so the second page load of
//    the same day asks nothing.
// 3. **Every failure is a non-event.** Denied, unavailable, timed out, no `navigator.geolocation`
//    at all, storage disabled: each returns quietly and leaves the planned count standing. There is
//    no error state, no toast and no retry. Someone who never grants location gets the whole
//    feature minus the confirmation stamp.
// 4. **Offline, and free.** The match is arithmetic against `lib/city-coords.ts`, the coordinate
//    table this app already ships. No reverse geocoder, no tile lookup, no network call, nothing
//    billable — the D-088 free-tier floor, and the same "in-bundle data or nothing" rule map search
//    already runs on.
//
// Lives in `lib/` rather than `core/` because it needs two `lib` modules (`city-coords`,
// `day-anchor`'s haversine) plus `navigator`, and the core→lib arrow is one-way.

import { TRIP_DATES, getCityForDate } from '@/core/dates';
import { addVisit, confirmVisit, getVisitConfirmations, markVisitCheck } from '@/core/places/visited';
import { cityCoord } from '@/lib/city-coords';
import { haversineKm } from '@/lib/day-anchor';
import { countryLabelForDate } from '@/lib/leg-label';
import { getActiveTraveler } from '@/lib/token-auth';
import { getNowAtTrip, getTodayInTrip } from '@/lib/trip-now';

/** A place the visit record can hold: a display city name and its day's country LABEL. */
export interface VisitPlace {
  city: string;
  /**
   * From `countryLabelForDate`, never `legForDate(...).countryLabel` — the Dec-9 departure day is
   * a 'nepal'-LEG day spent at JFK, so the raw leg label would write "New York / Nepal" into a
   * permanent record. May be `''` on a custom trip, where the leg label says nothing; `addVisit`
   * drops a blank half, so that records the city alone.
   */
  country: string;
}

/**
 * How close the device has to be to a trip city's coordinate for that city to be the answer.
 *
 * Nearest-wins does the real work — the trip's own cities sit far closer to each other than this
 * (Kathmandu/Lalitpur ~6 km, Nagarkot/Bhaktapur ~9 km, the widest pair Osaka/Kyoto ~43 km), so the
 * radius is not a tie-breaker. It is the "are we plausibly in a trip city at all" gate, and
 * it is generous on purpose: a metro area is tens of kilometres wide, the fix is deliberately
 * low-accuracy, and the cost of being slightly too generous is crediting a city the itinerary
 * already planned to credit anyway. Being too tight is the expensive error — it silently withholds
 * confirmation from someone standing in the right city.
 */
export const CITY_MATCH_KM = 75;

/**
 * PURE. Every distinct place the itinerary names on a day up to and including `throughISO`, in
 * first-appearance order. Dates are compared LEXICOGRAPHICALLY and never `new Date`-parsed — the
 * B-01 rule that `getCountryForDate` and `legForDate` both already follow, and the reason a
 * date-only string cannot slip a day at a negative UTC offset.
 *
 * "A day has arrived" is exactly `date <= throughISO` against the trip-clock day, which makes the
 * count a BACKFILL rather than an event: someone who does not open the app between Dec 12 and
 * Dec 15 still gets all four days credited on the next load. That is why there is no "which days
 * have I already counted" bookkeeping anywhere — `addVisit` is idempotent, so re-counting the whole
 * arrived prefix on every boot is both the simplest implementation and the self-healing one.
 */
export function tripPlacesThrough(throughISO: string): VisitPlace[] {
  const seen = new Set<string>();
  const places: VisitPlace[] = [];
  for (const date of TRIP_DATES) {
    if (date > throughISO) break; // TRIP_DATES is ascending, so the rest are all in the future
    const city = getCityForDate(date).trim();
    const key = city.toLowerCase();
    if (!city || seen.has(key)) continue;
    seen.add(key);
    places.push({ city, country: countryLabelForDate(date) });
  }
  return places;
}

/** PURE. Every distinct place the whole trip names — the candidate set the GPS fix matches against. */
export function allTripPlaces(): VisitPlace[] {
  return tripPlacesThrough(TRIP_DATES[TRIP_DATES.length - 1]);
}

/**
 * PURE, OFFLINE. The trip city nearest to a device fix, or `null` when none is within
 * `CITY_MATCH_KM`. This is the whole matcher: no service, no network, no cache.
 *
 * The candidate set is the WHOLE trip's cities rather than only the arrived ones, on purpose — a
 * traveller who reaches Kyoto two days early should be credited with Kyoto, not with the city the
 * plan says they are in. A candidate the coordinate table does not know is skipped rather than
 * guessed at (a custom trip may name any city; `cityCoord` is honestly partial).
 *
 * `candidates` is a parameter with a default so this can be exercised against a fixed table
 * instead of the active trip pack.
 */
export function matchPlace(
  latitude: number,
  longitude: number,
  candidates: readonly VisitPlace[] = allTripPlaces(),
): VisitPlace | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  let best: VisitPlace | null = null;
  let bestKm = Infinity;
  for (const place of candidates) {
    const coord = cityCoord(place.city);
    if (!coord) continue;
    const km = haversineKm(
      { lat: latitude, lng: longitude },
      { lat: coord.latitude, lng: coord.longitude },
    );
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return bestKm <= CITY_MATCH_KM ? best : null;
}

/**
 * Position options, and each one is a decision.
 *
 * `enableHighAccuracy: false` asks for the COARSE fix — the question is "which city", answered by a
 * network-derived position to within a kilometre or two, and a GPS-grade fix would cost battery and
 * a longer wait to buy precision this feature deliberately throws away. `timeout` bounds the whole
 * thing so an indoor device that never resolves lands in the error path (a non-event) instead of
 * leaving a callback pending forever. `maximumAge` accepts a fix up to a minute old: you were in
 * the same city a minute ago, and reusing a cached one avoids waking the radio at all.
 */
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};

/**
 * The boot entry point. Counts every arrived day, then — at most once per trip-clock day, and only
 * while the trip is actually running — asks for one position and confirms a city with it.
 *
 * TOTAL: it cannot throw at its caller. It is invoked from a null-render island on mount, where a
 * throw would take the provider tree down with it.
 */
export function runVisitAutocount(): void {
  try {
    // Behind the front door. A visitor sitting at the sign-in wall sees no app content, so they
    // must not accrue visits and — much more importantly — must not be shown a location prompt.
    if (getActiveTraveler() === null) return;

    // The trip-clock day: destination-local, `?today=`-aware, and it answers before, during and
    // after the trip window (`getTodayInTrip()` deliberately does not). Before the trip this is
    // earlier than every trip date, so the loop below counts nothing.
    const today = getNowAtTrip().date;
    for (const place of tripPlacesThrough(today)) addVisit(place);

    // ── The one-shot confirmation ────────────────────────────────────────────────────────────
    // Off-trip is a hard stop, and it is what keeps this feature invisible to anyone who never
    // travels: no trip day, no prompt, ever. Someone who reads the app at home in August is never
    // asked for their location by this code.
    if (getTodayInTrip() === null) return;
    if (getVisitConfirmations().checkedOn === today) return; // already asked today — one shot means one

    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== 'function') return; // unsupported: a non-event, and NOT marked

    // Marked BEFORE the request, so a refusal, a crash in the callback, or a tab closed over the
    // permission dialog all still cost exactly one prompt for this day.
    markVisitCheck(today);
    geo.getCurrentPosition(
      (position) => {
        // The only two numbers taken off the fix, used once, stored never.
        const place = matchPlace(position.coords.latitude, position.coords.longitude);
        if (place) confirmVisit(place, new Date().toISOString());
        // No match — outside every trip city — records nothing. The planned count stands.
      },
      () => {
        // PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT. All three are the same non-event:
        // say nothing, surface nothing, keep the planned count. Do not add a toast here.
      },
      POSITION_OPTIONS,
    );
  } catch {
    // Disabled storage, a hostile `navigator` shim, anything else: the feature is optional by
    // construction and must never be the reason a page fails to boot.
  }
}
