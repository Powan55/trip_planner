// Last-train chip text — the PURE lookup for the Travel Mode night-out affordance
// A small static lookup:
// no table beyond this, no API — last trains vary by line and city (earlier in Kyoto); Dec 31 is the
// one dated exception; extra service varies by line/operator and is unconfirmed, so no promise.
//
// Nepal (Thamel) has no rail system to catch/miss — walk or taxi — so the chip is Japan-phase
// only (`country === 'japan'`), matching per-day country resolution.

/** The single configurable NYE date (matches the itinerary's `j13-4` note). */
export const NYE_DATE = '2026-12-31';

/**
 * The last-train chip text for a trip day, or `null` when it shouldn't render (Nepal phase).
 * PURE — no clock read; `country` is the caller-resolved `getCountryForDate(date)`.
 */
export function lastTrainNotice(date: string, country: string): string | null {
  if (country !== 'japan') return null;
  if (date === NYE_DATE) return 'Dec 31: extra late trains vary by line and operator, and 2026/27 service is unconfirmed. Check your line on the JR East, Tokyo Metro and Toei sites. Fallback: taxi or stay out till first train.';
  return 'Last trains often run 23:00-00:30, earlier in Kyoto; check your line in Google Maps or the operator site. Fallback: taxi.';
}
