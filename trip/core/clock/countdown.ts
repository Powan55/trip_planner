// Core clock — pure, deterministically-testable countdown decomposition.
//
// Framework-free. Extracted VERBATIM from
// `lib/countdown.ts`; that module now re-exports `computeCountdown` + `Countdown`
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
//
// — the walk is anchored on CALENDAR DATES (local midnight of `now`'s date) and
// BORROWS the partly-spent day. The day you are standing in only counts as a whole day
// while the target's time of day is still ahead of you; once now's clock passes it, that
// day belongs to `hours`, not to the day count. Anchoring without the borrow makes
// `days` and `hours` double-count it and the breakdown overstates by a full 24h on every
// day of the year ("1 week 1 day 15 hours" for a true 1 week 15 hours).
//
// THE governing invariant, swept in `lib/__tests__/countdown-sum-back.test.ts`:
//
// now + months + (weeks*7 + days) days + hours:minutes:seconds === target
//
// exactly, to the second. It subsumes monotonicity (a decomposition of a shrinking
// interval cannot grow) and it is the check whose absence let the double-count ship.

import {
  differenceInMonths,
  differenceInCalendarDays,
  differenceInDays,
  addDays,
  addMonths,
  startOfDay,
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
const MS_PER_DAY = 24 * MS_PER_HOUR;

// A sub-month remainder of 28-30 days is arithmetically real, but "4 weeks" must never
// be rendered: at >= 28 days the remainder reads as months + days
// ("3 months 29 days"). Rounding up to the next month is explicitly rejected — it would
// overstate the date by up to 3 days. This lives in the producer, not in the five
// consumers, so no surface can render a 4-week bucket.
const WEEKS_SUPPRESSED_AT = 28;

/** Local wall-clock time of day in ms (DST-safe: field math, never epoch arithmetic). */
function timeOfDayMs(d: Date): number {
  return (
    d.getHours() * MS_PER_HOUR +
    d.getMinutes() * MS_PER_MINUTE +
    d.getSeconds() * MS_PER_SECOND +
    d.getMilliseconds()
  );
}

/**
 * Decompose the time between `now` and `target` into calendar-accurate
 * months / weeks / days / hours / minutes / seconds, plus the flat `totalDays`.
 *
 * At or after the target, every numeric field is 0 and `isPast` is true.
 * All numeric fields are non-negative integers.
 *
 * Invariants (swept in `lib/__tests__/countdown-sum-back.test.ts`):
 * - SUM-BACK: `now + months + (weeks*7 + days) days + h:m:s === target`, to the second.
 * - `hours < 24` — guaranteed by the borrow, not by clamping.
 * - `weeks` is never 4.
 * - `totalDays` equals the breakdown's own whole-day count.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  if (now.getTime() >= target.getTime()) {
    return { ...ZERO_PAST };
  }

  // Anchor the calendar walk on DATES, not instants: local midnight to local midnight.
  const anchor = startOfDay(now);
  // ..and BORROW the day we are standing in if its share is already spent. Without this
  // the day count and `hours` both charge for the same partial day.
  const borrow = timeOfDayMs(now) > timeOfDayMs(target) ? 1 : 0;
  const walkTarget = addDays(startOfDay(target), -borrow);

  // Whole calendar months between the two dates (date-fns counts complete months).
  const months = differenceInMonths(walkTarget, anchor);
  // Walk forward by those months; the gap that remains is < 1 month, in whole days.
  const cursor = addMonths(anchor, months);
  const dayRem = differenceInCalendarDays(walkTarget, cursor);

  // >= 28 days reads as months + days, never "4 weeks" (see WEEKS_SUPPRESSED_AT).
  const suppressWeeks = dayRem >= WEEKS_SUPPRESSED_AT;
  const weeks = suppressWeeks ? 0 : Math.floor(dayRem / 7);
  const days = suppressWeeks ? dayRem : dayRem % 7;

  // Whatever the calendar walk did not cover, measured from `now` itself — which is what
  // makes the fields sum back to the exact target instant. The borrow above is what keeps
  // this in [0, one day), and therefore `hours` under 24.
  const remMs = target.getTime() - addDays(addMonths(now, months), weeks * 7 + days).getTime();

  const hours = Math.floor(remMs / MS_PER_HOUR);
  const minutes = Math.floor((remMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((remMs % MS_PER_MINUTE) / MS_PER_SECOND);

  // Flat whole-day total from now to target, computed independently of the breakdown.
  // With the breakdown exact again, this equals the breakdown's own day count.
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
