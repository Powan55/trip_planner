// Core clock — pure, deterministically-testable countdown decomposition.
//
// Framework-free. `lib/countdown.ts` re-exports `computeCountdown` + `Countdown` from here,
// so every caller reaches one implementation.
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
//   now + months (calendar) + (weeks*7 + days) days + hours:minutes:seconds === target
//
// exactly, to the second -- with ONE documented exception, the carry in step 3 (below).
//
// IT DOES NOT SUBSUME MONOTONICITY, and the older text here that said it did was wrong.
// Months are anchored on `now`, and a month block's length depends on where it starts:
// `addMonths` spans 92 days from Aug 20 but 89 from Jan 31. When the block changes length the
// day remainder absorbs the difference, so the days cell can tick UP by one at a month boundary.
// That is arithmetic, not a defect. The only way to remove it is to anchor months on the TARGET,
// which changes "Aug 20 -> Dec 9" from 3 months 2 weeks 5 days to 3 months 2 weeks 6 days -- and the
// first reading is the one this app is specified to produce. Measured both ways before choosing.
// Do not "fix" it; see issue #142, where this was reported and then retracted.
//
// ONE WALK, and that structure is the fix rather than a patch on top of one.
// Months, then whole days measured FROM WHERE THE MONTH WALK LANDED, then the residue measured
// from where the day walk landed. Every step takes as much as it can without passing `target`,
// so the parts partition the interval by construction: they cannot double-count it and cannot
// leave a gap. The previous code derived the day part and the residue from two INDEPENDENT
// walks -- `differenceInDays` counting back from `target`, `addDays` measuring forward from
// `now` -- held in step by a hand-rolled borrow. Across a UTC-offset change those two walks are
// not inverses and the borrow failed in both directions:
//
//   spring-forward  now 2026-03-07 02:53 -> target 2026-03-08 03:00
//                   read `0m 0w 1d -1h -53m` -- negative fields, sum-back broken outright
//   fall-back       now 2026-11-01 00:29 -> target 2026-11-02 00:00
//                   read `0m 0w 0d 24h 31m` -- a literal 24 in the HOURS cell
//
// A first fix removed the negatives and left `0m 0w 1d 23h 7m` for a true 23h07m span: a clean
// double-count, because the day part and the residue still came from different walks. Deriving
// each step from where the last one landed is what removes the class instead of the instance.
//
// D-313's OVERSHOOT GUARD IS SUBSUMED, NOT DELETED. D-313 says its `while` loop must never be
// removed, and the loop it names is gone -- so read this before concluding the clause was
// violated. That loop existed because `differenceInMonths` and `addMonths` are not exact
// inverses at a month-end day clamp (`now` on the 29th-31st, walking into a shorter month), and
// it corrected the estimate downward. The two loops in step 1 below define `months` as the
// maximal `m` with `addMonths(now, m) <= target`, correcting from BOTH sides rather than one, so
// the overshoot is unreachable rather than repaired. `afterMonths <= target` then forces every
// later step non-negative by construction. That is strictly stronger than the guard it replaces,
// and it is verified, not asserted: the D-313 leap sweep passes (2,184 cases, 0 failures) and a
// 40,000-probe check finds 0 instants where `months` is not maximal in either direction.

import { addDays, addMonths, differenceInDays, differenceInMonths } from 'date-fns';

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

// A sub-month remainder of 28-30 days is arithmetically real, but "4 weeks" must never be
// rendered: at >= 28 days the remainder reads as months + days ("3 months 29 days"). This
// must stay at 28, not be removed or raised -- it is independent of the fixed-28-day scheme
// D-306 introduced and this file reverts; it dates back to D-016 and stops a real calendar
// month's residue (which can run up to 30 days) from ever spelling itself as "4 weeks".
const WEEKS_SUPPRESSED_AT = 28;

/**
 * Decompose the time between `now` and `target` into calendar-accurate
 * months / weeks / days / hours / minutes / seconds, plus the flat `totalDays`.
 *
 * At or after the target, every numeric field is 0 and `isPast` is true.
 * All numeric fields are non-negative integers.
 *
 * ONE WALK. Months first, then whole days measured FROM WHERE THE MONTH WALK LANDED, then the
 * residue measured from where the day walk landed. Each step takes as much as it can without
 * passing `target`. Because every step starts where the previous one stopped, the parts
 * partition the interval by construction -- they cannot double-count it and they cannot leave a
 * gap. The previous code derived the day part and the residue from two independent walks and
 * relied on a hand-rolled borrow to keep them aligned; across a UTC-offset change the two walks
 * are not inverses and the alignment failed in both directions (see the header).
 *
 * Invariants (swept in `lib/__tests__/countdown-sum-back.test.ts`):
 * - SUM-BACK: `now + months (calendar) + (weeks*7 + days) days + h:m:s === target`, to the
 *   second, with EXACTLY ONE documented exception -- the carry in step 3. It fires when the
 *   final day-leg of the walk spans a fall-back day, which is 25 hours long, so the honest
 *   residue reaches 24h; moving that day into the day count is what a calendar reconstruction
 *   cannot undo. Cost: one hour of `now` values on each day preceding a fall-back within the
 *   horizon -- 23,942 of 576,000 one-minute instants over 400 days against a target one day
 *   after a fall-back, and ZERO against the shipped 2026-12-09 target, which never reaches it.
 * - `hours < 24` -- by the carry, unconditionally.
 * - every field non-negative -- by construction, since each walk stops short of `target`.
 * - `weeks` is never 4 (`WEEKS_SUPPRESSED_AT`).
 * - `totalDays` is a separate flat day count and does NOT reconcile with the breakdown.
 */
export function computeCountdown(target: Date, now: Date): Countdown {
  if (now.getTime() >= target.getTime()) {
    return { ...ZERO_PAST };
  }

  // STEP 1 -- months, anchored on `now`. The largest m with `addMonths(now, m) <= target`.
  //
  // Anchoring on `now` is what makes "Aug 20 -> Dec 9" read as 3 months, 2 weeks, 5 days, which
  // is the reading this app is specified to produce. It is also why the days cell can tick UP by
  // one at a month boundary: `addMonths` spans 92 days from Aug 20 but 89 from Jan 31, so when
  // the month block changes length the day remainder has to absorb the difference. That is
  // arithmetic, not a defect, and the only way to remove it is to anchor months on the TARGET
  // instead -- which changes the reading above to 3 months 2 weeks 6 days. Do not 'fix' it.
  //
  // The two corrective loops SUBSUME D-313's overshoot guard rather than deleting it.
  // `differenceInMonths` and `addMonths` are not exact inverses at a month-end day clamp, so the
  // estimate can sit either side of the truth; the loops define `months` as maximal instead of
  // trusting it. Removing them reopens the leap-day defect D-313 was written to close.
  let months = Math.max(0, differenceInMonths(target, now));
  while (months > 0 && addMonths(now, months).getTime() > target.getTime()) months -= 1;
  while (addMonths(now, months + 1).getTime() <= target.getTime()) months += 1;
  const afterMonths = addMonths(now, months);

  // STEP 2 -- whole days from where the month walk landed, again maximal.
  let dayRem = Math.max(0, differenceInDays(target, afterMonths));
  while (dayRem > 0 && addDays(afterMonths, dayRem).getTime() > target.getTime()) dayRem -= 1;
  while (addDays(afterMonths, dayRem + 1).getTime() <= target.getTime()) dayRem += 1;

  // STEP 3 -- the residue, from where the day walk landed. In [0, one CALENDAR day), which on a
  // fall-back day is 25 hours long -- the honest residue then reaches 24h and the grid rendered a
  // literal `24 HOURS`. Ruling: a countdown never displays 24 or more hours, so the whole day is
  // carried into the day count. This is the ONLY thing that breaks exact sum-back. It is not rare
  // and it is not confined to a fall-back day: it is one hour of `now` values on every day whose
  // final day-leg reaches across the transition -- 23,942 of 576,000 one-minute instants over a
  // 400-day horizon against a target the day after a fall-back. Against the shipped 2026-12-09
  // target it fires ZERO times, so the live countdown never takes this path.
  let remMs = target.getTime() - addDays(afterMonths, dayRem).getTime();
  while (remMs >= MS_PER_DAY) {
    remMs -= MS_PER_DAY;
    dayRem += 1;
  }

  // The flat whole-day count, derived the same maximal way so it can never disagree with the
  // walk about what a full day is. It does NOT reconcile with the breakdown above (D-313).
  let totalDays = Math.max(0, differenceInDays(target, now));
  while (totalDays > 0 && addDays(now, totalDays).getTime() > target.getTime()) totalDays -= 1;
  while (addDays(now, totalDays + 1).getTime() <= target.getTime()) totalDays += 1;

  // >= 28 days reads as months + days, never "4 weeks" -- a real calendar month's residue runs
  // up to 30 days and must not spell itself as a fourth week. Unchanged from D-313.
  const suppressWeeks = dayRem >= WEEKS_SUPPRESSED_AT;
  const weeks = suppressWeeks ? 0 : Math.floor(dayRem / 7);
  const days = suppressWeeks ? dayRem : dayRem % 7;

  return {
    months,
    weeks,
    days,
    hours: Math.floor(remMs / MS_PER_HOUR),
    minutes: Math.floor((remMs % MS_PER_HOUR) / MS_PER_MINUTE),
    seconds: Math.floor((remMs % MS_PER_MINUTE) / MS_PER_SECOND),
    totalDays,
    isPast: false,
  };
}
