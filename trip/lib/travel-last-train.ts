// Last-train chip text — the PURE lookup for the Travel Mode night-out affordance
// A small static lookup:
// no table beyond this, no API — Tokyo/Osaka/Kyoto last trains run ~00:00, first ~05:00; Dec 31 is the
// one dated exception (major JR/metro run all night for New Year's Eve).
//
// Nepal (Thamel) has no rail system to catch/miss — walk or taxi — so the chip is Japan-phase
// only (`country === 'japan'`), matching per-day country resolution.

/** The single configurable NYE date (matches the itinerary's `j13-4` note). */
export const NYE_DATE = '2026-12-31';

/**
 * The last-train chip text for a trip day, or `null` when it shouldn't render (Nepal phase).
 * PURE — no clock read; `country` is the caller-resolved `getCountryForDate(date)`.
 */
export function lastTrainNotice(date: string, country: 'nepal' | 'japan'): string | null {
  if (country !== 'japan') return null;
  if (date === NYE_DATE) return "Dec 31: trains run all night — no last-train cutoff tonight.";
  return 'Last trains ~00:00 · first ~05:00';
}
