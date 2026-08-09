// The ONE city → coordinate table.
//
// Extracted VERBATIM out of `lib/weather.ts` so that two very
// different consumers can share it without either dragging the other's code along:
// • `lib/weather.ts` — the Open-Meteo query coordinate (its original, only use).
// • `lib/itinerary-map.ts` — rung 5 of the placement ladder, so an item with no
// pin, no sourceId and no name match still gets an APPROXIMATE position from its day's
// city. /map must not pull the Open-Meteo fetch client into its bundle to do that.
//
// PURE data + one lookup: no fetch, no storage, no React. **A second copy of these
// coordinates is forbidden** — there is exactly one table, and it is this one.
//
// TOTALITY: `lib/__tests__/content-validation.test.ts`'s "every itinerary city is
// weather-known" case fails the content validator if any `DayPlan.city` in the default pack
// is missing here — which is what makes's coverage claim ("rung 5 alone places
// every item of the default pack") a build-time invariant rather than a hope. A CUSTOM trip
// may name any city, so `cityCoord` is honestly partial and rung 5 can return undefined there.

export interface CityCoord {
  latitude: number;
  longitude: number;
}

// All 13 trip cities. Every per-day city in `core/dates`' TRIP_CITIES / the sample
// itinerary has real coordinates, so day-trip days (Nagarkot, Kyoto, Osaka, …) get real
// weather instead of the graceful `unavailable` fallback. The original two (Kathmandu, Tokyo)
// are byte-identical to keep the weather net exact. A weather-coords coverage unit test
// asserts `isKnownWeatherCity` is true for all 8 canonical trip cities so no trip day loses weather
// (8 VISITED cities out of the 13 rows here — the extra rows are day-trip cities the reroute
// dropped, kept because a custom trip may still name them).
export const CITY_COORDS: Record<string, CityCoord> = {
  // Departure: Dec 9 is spent in Syracuse / JFK / the air, so the trip's first day names
  // Syracuse. Weather at the airport you are actually departing from is the useful reading, and a
  // coordinate here is REQUIRED — the content validator's "every itinerary city is weather-known"
  // case fails without it.
  Syracuse: { latitude: 43.0481, longitude: -76.1474 },
  // Nepal
  Kathmandu: { latitude: 27.7172, longitude: 85.324 },
  Lalitpur: { latitude: 27.6667, longitude: 85.324 },
  Nagarkot: { latitude: 27.7157, longitude: 85.5206 },
  Bhaktapur: { latitude: 27.671, longitude: 85.4298 },
  // Japan
  Tokyo: { latitude: 35.6762, longitude: 139.6503 },
  Hakone: { latitude: 35.2324, longitude: 139.1069 },
  Kyoto: { latitude: 35.0116, longitude: 135.7681 },
  Osaka: { latitude: 34.6937, longitude: 135.5023 },
  Kawaguchiko: { latitude: 35.517, longitude: 138.754 },
  Yuzawa: { latitude: 36.937, longitude: 138.808 },
  Nikko: { latitude: 36.7198, longitude: 139.6982 },
  Yokohama: { latitude: 35.4437, longitude: 139.638 },
};

/** The coordinate for a city name, or `undefined` when it isn't a known trip city. */
export function cityCoord(city: string): CityCoord | undefined {
  return Object.prototype.hasOwnProperty.call(CITY_COORDS, city)
    ? CITY_COORDS[city]
    : undefined;
}
