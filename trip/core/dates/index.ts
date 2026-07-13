/**
 * `core/dates` barrel — the framework-free date backbone.
 * Re-exports the trip-date constants, `TRIP_DATES`, `TRIP_DATE_LABEL`, the TZ-safe
 * `getCountryForDate`, and `formatDate`/`formatDateLong`. `lib/trip-data.ts` re-exports
 * these so every existing `@/lib/trip-data` caller is untouched; new core-boundary code
 * imports from `@/core/dates` directly. One implementation, two import surfaces.
 */
export {
  TRIP_START,
  TRIP_END,
  NEPAL_START,
  NEPAL_END,
  JAPAN_START,
  JAPAN_END,
  TRIP_DATES,
  TRIP_DATE_LABEL,
  getCountryForDate,
  formatDate,
  formatDateLong,
} from './trip-dates';
export { TRIP_CITIES, getCityForDate, deriveTripCities } from './trip-cities';
export { dayInTripFor, type TripToday } from './day-in-trip';
export {
  NPT_OFFSET_MIN,
  JST_OFFSET_MIN,
  offsetForCountry,
  parseTimeString,
  effectiveStartMinutes,
  formatTimeAmPm,
  placeWallClockToUtcMs,
  isPastAtPlace,
} from './item-time';
