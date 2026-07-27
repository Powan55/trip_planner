// Flight-card timing seam — the ONE place that derives a journey's phase
// strip + proximity countdown. It reads the app's existing trip-clock (`getNow()`, honoring
// the `?today=` override,) and the PURE `computeCountdown`, targeting the
// AUTHORED, date-only `Journey.departDate` — NEVER a booking time label.
//
// /: this module touches `departDate` only; it never reads `departLabel`,
// `arriveLabel`, `duration`, or `totalDuration`. The `new Date(departDate + 'T00:00:00')`
// below is the sanctioned countdown TARGET construction (parity with the hero's
// `TRIP_START = new Date(activeTrip.start + 'T00:00:00')`,) — it is a bare authored
// date, not the trans-Pacific time arithmetic protects. Keeping this out of the card
// component leaves the card's label path provably Date-/parse-free.

import { computeCountdown, type Countdown } from '@/lib/countdown';
import { getNow } from '@/lib/trip-now';
import type { Journey } from '@/lib/booking-data';

export type FlightPhase = 'upcoming' | 'departing' | 'completed';

export interface FlightTiming {
  phase: FlightPhase;
  countdown: Countdown;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Day-granularity phase + proximity countdown for a journey.
 *
 * Phase compares the clock's calendar day (local parts of `now` — device-local, or the
 * `?today=` override day; same rule as `dayInTripFor`'s null-offset path,) against the
 * authored `departDate`, LEXICOGRAPHICALLY on the 'YYYY-MM-DD' strings (TZ-independent):
 * before → `upcoming`, same day → `departing`, after → `completed`.
 * The countdown zeroes at LOCAL MIDNIGHT of `departDate` ( accepted residual: coarser
 * than gate time, consistent with the hero). `now` is injectable for pure unit tests.
 */
export function getFlightTiming(journey: Journey, now: Date = getNow()): FlightTiming {
  const target = new Date(journey.departDate + 'T00:00:00');
  const nowDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const phase: FlightPhase =
    nowDay < journey.departDate ? 'upcoming' : nowDay === journey.departDate ? 'departing' : 'completed';
  return { phase, countdown: computeCountdown(target, now) };
}
