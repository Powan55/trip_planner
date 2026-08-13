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
// `lib/trip-now.ts`), NEVER this module's.
//
// THE UNITS CARRY MAXIMALLY (issue #11): 7 days become 1 week, 4 weeks become 1 month. No
// unit is ever big enough to be said in a larger one, so no unit has to be pinned to zero to
// dodge a label nobody wants. A month is therefore a FIXED 28 days and does NOT track
// calendar month lengths. That reverses the earlier calendar-accurate decomposition
// deliberately: the owner ruled on it in issue #11 and the reversal is recorded in
// DECISIONS.md D-306, which supersedes D-016's calendar-accuracy clause.
//
// What that buys: the parts reconcile with the whole. `months*28 + weeks*7 + days` IS
// `totalDays`, so the unit grid and the "days to go" headline can never contradict
// each other on screen.
//
// Zero units are REPORTED here, never hidden. "1 month 0 weeks 1 day" is the true reading of
// 29 days; leaving the zero off the screen is the renderer's job, and each surface does it
// (`hero-section.tsx`, `token-gate.tsx`, `flight-journey-card.tsx`).
//
// THE governing invariant, swept in `lib/__tests__/countdown-sum-back.test.ts`:
//
// now + (months*28 + weeks*7 + days) days + hours:minutes:seconds === target
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

import { addDays, differenceInDays } from 'date-fns';

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

// The carry ladder. A month is four weeks exactly (issue #11). See the header for why that
// is preferred over a calendar month here, and what it costs.
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 4 * DAYS_PER_WEEK;

/**
 * Decompose the time between `now` and `target` into maximally-carried
 * months / weeks / days / hours / minutes / seconds, plus the flat `totalDays`.
 *
 * At or after the target, every numeric field is 0 and `isPast` is true.
 * All numeric fields are non-negative integers.
 *
 * Invariants (swept in `lib/__tests__/countdown-sum-back.test.ts`):
 * - SUM-BACK: `now + (months*28 + weeks*7 + days) days + h:m:s === target`, to the second.
 * - The carry is MAXIMAL: `days < 7` and `weeks < 4`, so "4 weeks" can never be reported.
 * - `hours < 24` — guaranteed by the borrow, not by clamping.
 * - `totalDays === months*28 + weeks*7 + days`, the breakdown's own whole-day count.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  if (now.getTime() >= target.getTime()) {
    return { ...ZERO_PAST };
  }

  // Whole days left, with the partly-spent current day borrowed (see the header).
  const totalDays = differenceInDays(target, now);

  // Carry upward as far as each unit goes, so nothing that could be said in a bigger unit
  // is left in a smaller one, and nothing is suppressed to keep a bucket out of view.
  const months = Math.floor(totalDays / DAYS_PER_MONTH);
  const weeks = Math.floor((totalDays % DAYS_PER_MONTH) / DAYS_PER_WEEK);
  const days = totalDays % DAYS_PER_WEEK;

  // Whatever the day walk did not cover, measured from `now` itself, which is what makes
  // the fields sum back to the exact target instant. The borrow above is what keeps this in
  // [0, one day), and therefore `hours` under 24.
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
