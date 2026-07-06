// Core clock — pure, deterministically-testable countdown decomposition.
//
// Framework-free. `lib/countdown.ts` re-exports `computeCountdown` + `Countdown`
// from here byte-identically, so every caller (`components/hero-section.tsx`,
// `token-gate.tsx`, `trip-dashboard.tsx`) is untouched.
//
// computeCountdown is PURE: it never reads the clock. The caller passes both the
// target and the current `now`, so the same inputs always produce the same output
// — which is what makes the unit math provable with fixed dates. Reading the
// real clock / resolving the `?today=` override is the adapter's job (ClockPort, via
// `lib/trip-now.ts`), NEVER this module's.
//
// The decomposition is CALENDAR-ACCURATE (not the old floor(totalDays/30)
// approximation): months are real calendar months via date-fns, and the residue
// after walking forward by those months is split into weeks/days/hours/min/sec.

import {
  differenceInMonths,
  differenceInDays,
  addMonths,
  addDays,
} from 'date-fns';

export interface Countdown {
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalDays: number;
  isPast: boolean;
}

const ZERO_PAST: Countdown = {
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  totalDays: 0,
  isPast: true,
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Decompose the time between `now` and `target` into calendar-accurate
 * months / weeks / days / hours / minutes / seconds, plus the flat `totalDays`.
 *
 * At or after the target, every numeric field is 0 and `isPast` is true.
 * All numeric fields are non-negative integers.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  if (now.getTime() >= target.getTime()) {
    return { ...ZERO_PAST };
  }

  // Whole calendar months remaining (date-fns counts complete months).
  const months = differenceInMonths(target, now);
  // Walk forward by those months; the gap that remains is < 1 month.
  const cursor = addMonths(now, months);

  // Whole days remaining after the month cursor.
  const dayRem = differenceInDays(target, cursor);
  const weeks = Math.floor(dayRem / 7);
  const days = dayRem % 7;

  // Sub-day remainder: everything left after stepping forward by dayRem days.
  const subDayStart = addDays(cursor, dayRem);
  const remMs = target.getTime() - subDayStart.getTime();

  const hours = Math.floor(remMs / MS_PER_HOUR);
  const minutes = Math.floor((remMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((remMs % MS_PER_MINUTE) / MS_PER_SECOND);

  // Flat total of whole days from now to target (independent of the breakdown).
  const totalDays = differenceInDays(target, now);

  return {
    months,
    weeks,
    days,
    hours,
    minutes,
    seconds,
    totalDays,
    isPast: false,
  };
}
