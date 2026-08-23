// The shape of the whole journey, for Home's journey bar (issue #92) — the active trip's
// LEGS laid out on the trip's own date rail, each with the cities it actually covers.
//
// NOTHING IS RE-DERIVED HERE. It walks `getActiveTrip().legs` and counts them over
// `TRIP_DATES` through `getCityForDate` — the same existing per-day answers
// `lib/home-stats.ts` counts, and the same ones the Today header and the weather card
// render. Iterating the pack's LEGS rather than the NEPAL_*/JAPAN_* date constants is what
// makes this correct for a custom trip pack at no extra cost: a single-leg custom trip gets
// one segment named for its own `countryLabel`, not a Nepal/Japan split it does not have.
//
// Dates are compared LEXICOGRAPHICALLY and never `new Date(dateStr)`-parsed — the same
// timezone rule `getCountryForDate` and `legForDate` are frozen on (a date-only string
// parses as UTC midnight, which slips a day at a negative UTC offset).
//
// PURE and clock-free. `deriveJourneyLegs` takes all three inputs so the derivation is
// testable against a pack that is not the active one; `journeyLegs()` is the app's binding
// of it. Cheap (one pass over ~32 dates per leg) but not free — callers memoise, the same
// way `components/home-stat-row.tsx` memoises `tripShape`.

import { TRIP_DATES, getCityForDate } from '@/core/dates';
import { getActiveTrip } from '@/core/trips';

export interface JourneyLeg {
  /** The pack's leg id ('nepal' / 'japan' on the default pack). */
  id: string;
  /** The pack's human country label — never the raw id. */
  label: string;
  /** First / last trip date that falls INSIDE the leg (not the leg's declared span). */
  start: string;
  end: string;
  /** Inclusive day count — the segment's weight on the rail. */
  days: number;
  /** Distinct cities across those days, in date order, deduplicated. */
  cities: string[];
}

/** PURE: pack legs + the trip's date list + the per-day city answer → the rail's segments. */
export function deriveJourneyLegs(
  legs: readonly { id: string; countryLabel: string; start: string; end: string }[],
  dates: readonly string[],
  cityFor: (dateStr: string) => string,
): JourneyLeg[] {
  const out: JourneyLeg[] = [];
  for (const leg of legs) {
    const own = dates.filter((d) => d >= leg.start && d <= leg.end);
    // A leg the trip's date list never reaches has no segment to draw, and a zero-weight
    // segment on a flex rail is an invisible element with a visible gap either side.
    if (own.length === 0) continue;
    const cities: string[] = [];
    for (const d of own) {
      const city = cityFor(d);
      if (city && !cities.includes(city)) cities.push(city);
    }
    out.push({
      id: leg.id,
      label: leg.countryLabel,
      start: own[0],
      end: own[own.length - 1],
      days: own.length,
      cities,
    });
  }
  return out;
}

/** The active trip's segments. */
export function journeyLegs(): JourneyLeg[] {
  return deriveJourneyLegs(getActiveTrip().legs, TRIP_DATES, getCityForDate);
}
