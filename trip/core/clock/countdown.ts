// Core clock — pure, deterministically-testable countdown decomposition.
//
// Framework-free. `lib/countdown.ts` re-exports `computeCountdown` + `Countdown` from here,
// so every caller (`components/hero-section.tsx`, `token-gate.tsx`, `trip-dashboard.tsx`)
// reaches one implementation.
//
// computeCountdown is PURE: it never reads the clock. The caller passes both the
// target and the current `now`, so the same inputs always produce the same output,
// which is what makes the unit math provable with fixed dates. Reading the
// real clock / resolving the `?today=` override is the adapter's job (ClockPort, via
// `lib/trip-now.ts`), NEVER this module's. That purity is D-306's, and it is untouched
// by this revert, along with the D-006 target.
//
// THE UNITS ARE CALENDAR-ACCURATE (issue #60, D-313): months are real calendar months
// via date-fns, not the fixed-28-day scheme D-306 shipped. D-306 (issue #11) chose a
// fixed 28-day month specifically so months/weeks/days would reconcile exactly with
// `totalDays` — but that traded away calendar truth for it, and it produced visibly wrong
// answers ("4 months, 5 days" for a span a calendar reads as "3 months, 3 weeks, 5 days"
// whenever the remainder happens to land on exactly 0 weeks). The owner ruled on issue #60
// to reverse that trade back to D-016's calendar accuracy. `totalDays` and the breakdown no
// longer reconcile by construction — same as D-016 originally accepted, and D-016 was right
// that this is not a bug to "fix".
//
// What is STILL BINDING from D-306, unaffected by this revert: `computeCountdown` stays
// pure with no internal clock (the D-006 target), and zero units are still REPORTED here,
// never hidden -- "1 month 0 weeks 1 day" is the true reading of 29 days; dropping the zero
// from the screen is the renderer's job, done per-surface (`hero-section.tsx`,
// `token-gate.tsx`, `flight-journey-card.tsx`).
//
// THE governing invariant, swept in `lib/__tests__/countdown-sum-back.test.ts`:
//
// now + months (calendar) + (weeks*7 + days) days + hours:minutes:seconds === target
//
// exactly, to the second. It subsumes monotonicity (a decomposition of a shrinking
// interval cannot grow) and it is the check whose absence let the double-count ship.
//
// The day count is `differenceInDays`, which TRUNCATES, and that truncation is the BORROW
// of the partly-spent day. The day you are standing in only counts as a whole day while the
// target's time of day is still ahead of you; once now's clock passes it, that day belongs to
// `hours`, not to the day count. Counting calendar days without the borrow makes `days` and
// `hours` double-count it and the breakdown overstates by a full 24h on every day of the year
// ("1 week 1 day 15 hours" for a true 1 week 15 hours). date-fns does the walk in local
// calendar fields rather than epoch arithmetic, which is what carries it across DST.
//
// THE OVERSHOOT GUARD (D-313). `differenceInMonths` and `addMonths` are not exact inverses:
// walking `anchor` forward by `differenceInMonths(walkTarget, anchor)` months can overshoot
// `walkTarget` by a day when the anchor's day-of-month (29, 30, or 31) does not exist in the
// month landed on. Concretely: `now` on the 29th-31st of some month, `target` on Feb 28 of a
// leap year -- `addMonths` clamps the missing day-of-month down, and the clamp can land one day
// past `walkTarget`. Left unguarded that produces a negative `dayRem`, and from there negative
// weeks/days and an `hours` at or above 24. The `while` loop below re-derives `months` by
// walking back until `cursor` no longer exceeds `walkTarget`. It is a `while`, not a single
// `if`, because a lone correction was verified insufficient as defense-in-depth (this is not
// speculative hardening: a 152,000+ pair sweep for D-313 found the failure and this guard is
// what closes it). Do not delete this as "redundant" -- it is the only thing standing between
// this file and a repeat of the exact defect D-306 was ruled on to fix (a visibly wrong
// countdown), just from the opposite direction.

import {
  addDays,
  addMonths,
  differenceInDays,
  differenceInMonths,
  differenceInCalendarDays,
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

// A sub-month remainder of 28-30 days is arithmetically real, but "4 weeks" must never be
// rendered: at >= 28 days the remainder reads as months + days ("3 months 29 days"). This
// must stay at 28, not be removed or raised -- it is independent of the fixed-28-day scheme
// D-306 introduced and this file reverts; it dates back to D-016 and stops a real calendar
// month's residue (which can run up to 30 days) from ever spelling itself as "4 weeks".
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
 * - SUM-BACK: `now + months (calendar) + (weeks*7 + days) days + h:m:s === target`, to the second.
 * - `hours < 24` -- guaranteed by the borrow, not by clamping.
 * - `weeks` is never 4 (`WEEKS_SUPPRESSED_AT`).
 * - `totalDays` is a separate flat day count and does NOT reconcile with the breakdown --
 *   deliberately given up by this revert, same as D-016 originally accepted.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  if (now.getTime() >= target.getTime()) {
    return { ...ZERO_PAST };
  }

  // Whole days left, with the partly-spent current day borrowed (see the header). Untouched
  // by this revert -- totalDays is a flat count, independent of the calendar-month breakdown.
  const totalDays = differenceInDays(target, now);

  // Anchor the calendar walk on DATES, not instants: local midnight to local midnight, with
  // the same borrow of the partly-spent day applied to the walk's own target.
  const anchor = startOfDay(now);
  const borrow = timeOfDayMs(now) > timeOfDayMs(target) ? 1 : 0;
  const walkTarget = addDays(startOfDay(target), -borrow);

  let months = differenceInMonths(walkTarget, anchor);
  let cursor = addMonths(anchor, months);
  // GUARD, mandatory, not optional -- see the header (D-313). `differenceInMonths` and
  // `addMonths` are not exact inverses at month-end day clamps, and a single `if` was
  // verified insufficient as defense-in-depth, hence `while`.
  while (cursor.getTime() > walkTarget.getTime()) {
    months -= 1;
    cursor = addMonths(anchor, months);
  }
  const dayRem = differenceInCalendarDays(walkTarget, cursor);

  // >= 28 days reads as months + days, never "4 weeks". This is NOT the defect D-306 fixed --
  // that was the RENDERER showing a literal "0 weeks" on screen, which stays fixed
  // permanently and independently at the renderer layer (zero-suppression, unchanged by this
  // revert). Reinstating this threshold does not reopen the old bug.
  const suppressWeeks = dayRem >= WEEKS_SUPPRESSED_AT;
  const weeks = suppressWeeks ? 0 : Math.floor(dayRem / 7);
  const days = suppressWeeks ? dayRem : dayRem % 7;

  // Whatever the day walk did not cover, measured from `now` itself, which is what makes
  // the fields sum back to the exact target instant. The borrow above is what keeps this in
  // [0, one day), and therefore `hours` under 24. Deliberately derived from `totalDays`, the
  // flat day count, NOT from the months/weeks/days breakdown above -- untouched by this
  // revert (D-313 verified splicing calendar-month logic onto this half safe, given the
  // overshoot guard, via a 20,806-pair equivalence sweep plus a 132,000-pair boundary sweep).
  const remMs = target.getTime() - addDays(now, totalDays).getTime();

  const hours = Math.floor(remMs / MS_PER_HOUR);
  const minutes = Math.floor((remMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((remMs % MS_PER_MINUTE) / MS_PER_SECOND);

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
