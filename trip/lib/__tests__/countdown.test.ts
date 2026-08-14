import { describe, it, expect } from 'vitest';
import { computeCountdown } from '../countdown';

// computeCountdown is PURE (D-016): it never reads the clock, so every case here
// passes fixed `target`/`now` Date fixtures. Months are CALENDAR-ACCURATE again (issue #60,
// D-313), superseding issue #11 / D-306's fixed 28-day month. `totalDays` (a flat day count)
// and the months/weeks/days breakdown do NOT arithmetically reconcile by multiplication —
// that reconciliation was D-306's trade and this revert deliberately gives it up, same as
// D-016 originally accepted. What still holds: the breakdown sums back to the exact target
// instant (h:m:s included), and `weeks` never reaches 4 (a sub-month remainder of >= 28 days
// reads as unsplit days instead). The sum-back and the carry are swept over a year in
// `countdown-sum-back.test.ts`, plus a dedicated leap-day boundary sweep for the D-313
// overshoot guard; the cases here stay hand-verified fixtures.

describe('computeCountdown', () => {
  it('returns all-zero / isPast=true when now === target', () => {
    const target = new Date('2026-12-09T00:00:00');
    const now = new Date('2026-12-09T00:00:00');
    expect(computeCountdown(target, now)).toEqual({
      months: 0,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalDays: 0,
      isPast: true,
    });
  });

  it('returns all-zero / isPast=true when now is after target', () => {
    const target = new Date('2026-12-09T00:00:00');
    const now = new Date('2027-01-09T23:59:59');
    expect(computeCountdown(target, now)).toEqual({
      months: 0,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalDays: 0,
      isPast: true,
    });
  });

  it('computes an exact hand-verified interval: 2 calendar months, residue weeks/days/hours/min/sec', () => {
    // target: 2027-03-15T10:30:45, now: 2027-01-10T08:15:20
    // No borrow: target's time-of-day (10:30:45) is later than now's (08:15:20).
    // months = differenceInMonths(Mar15, Jan10) = 2 (Jan10->Feb10->Mar10 complete;
    //   Mar10->Mar15 is not a full third month)
    // cursor = addMonths(Jan10, 2) = Mar10; dayRem = Mar15 - Mar10 = 5 days
    // weeks  = floor(5/7) = 0, days = 5
    // totalDays = differenceInDays(target, now) = 64 whole days (independent flat count,
    //   untouched by the calendar-month revert)
    // remMs  = target - addDays(now, 64) = target - 2027-03-15T08:15:20 = 2h15m25s
    const target = new Date('2027-03-15T10:30:45');
    const now = new Date('2027-01-10T08:15:20');
    const result = computeCountdown(target, now);
    expect(result).toEqual({
      months: 2,
      weeks: 0,
      days: 5,
      hours: 2,
      minutes: 15,
      seconds: 25,
      totalDays: 64,
      isPast: false,
    });
  });

  it('computes a sub-day interval: months/weeks/days all 0, only hours/min/sec', () => {
    const target = new Date('2026-12-09T12:00:00');
    const now = new Date('2026-12-09T05:30:15');
    const result = computeCountdown(target, now);
    expect(result.months).toBe(0);
    expect(result.weeks).toBe(0);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(6);
    expect(result.minutes).toBe(29);
    expect(result.seconds).toBe(45);
    expect(result.totalDays).toBe(0); // less than a full day apart
    expect(result.isPast).toBe(false);
  });

  it('rolls a whole-week boundary into weeks (14 days -> weeks:2, days:0)', () => {
    const target = new Date('2026-12-23T00:00:00');
    const now = new Date('2026-12-09T00:00:00');
    const result = computeCountdown(target, now);
    expect(result.months).toBe(0);
    expect(result.weeks).toBe(2);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.totalDays).toBe(14);
    expect(result.isPast).toBe(false);
  });

  it('produces non-negative integers for every numeric field on a normal future interval', () => {
    const target = new Date('2026-12-09T00:00:00');
    const now = new Date('2026-07-04T09:23:47');
    const result = computeCountdown(target, now);
    const numericFields: (keyof typeof result)[] = [
      'months',
      'weeks',
      'days',
      'hours',
      'minutes',
      'seconds',
      'totalDays',
    ];
    for (const field of numericFields) {
      const value = result[field] as number;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(result.isPast).toBe(false);
  });

  it('is anchored correctly at the real D-006 trip target (2026-12-09T00:00:00) from a fixed now', () => {
    const target = new Date('2026-12-09T00:00:00');
    const now = new Date('2026-11-09T00:00:00'); // one CALENDAR month before: 30 days
    const result = computeCountdown(target, now);
    // Calendar-accurate again (D-313): Nov 9 -> Dec 9 IS one exact calendar month, so this
    // now reads a clean 1 month 0 weeks 0 days, even though the flat day count (Nov has 30
    // days) is 30, not 28 -- the two deliberately do not reconcile by multiplication.
    expect(result.months).toBe(1);
    expect(result.weeks).toBe(0);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.totalDays).toBe(30); // Nov (30 days) -> Dec 9, flat day count
    expect(result.isPast).toBe(false);
  });

  it("the owner's Aug 13 -> Dec 9 example (issue #60): calendar-accurate months, verified by running the code", () => {
    // Owner's ruling on issue #60 described the desired reading approximately as "3 months,
    // 3 weeks, 5 days". The exact figure (run, not hand-copied) is 4 days, not 5: `now` is
    // noon, and the target (TRIP_START, 2026-12-09T00:00:00) is midnight, so the borrow
    // consumes the partly-spent day, landing the walk one day short of the approximate
    // wording. The point the ruling cares about -- real calendar months, not fixed 28-day
    // ones -- holds either way.
    const target = new Date('2026-12-09T00:00:00'); // TRIP_START
    const now = new Date('2026-08-13T12:00:00');
    const result = computeCountdown(target, now);
    expect(result).toEqual({
      months: 3,
      weeks: 3,
      days: 4,
      hours: 12,
      minutes: 0,
      seconds: 0,
      totalDays: 117,
      isPast: false,
    });
  });
});

/**
 * Issue #60 / D-313 acceptance criteria: months are real calendar months again, not the
 * fixed 28-day carry issue #11 / D-306 shipped. `render` is the zero-suppression rule every
 * surface applies: the producer reports the true value of every unit, including the zeros,
 * and the renderer skips a unit that is zero.
 */
describe('issue #60 / D-313: months are calendar-accurate, and zero units are not displayed', () => {
  const UNITS = ['month', 'week', 'day'] as const;

  const render = (c: { months: number; weeks: number; days: number }) =>
    [c.months, c.weeks, c.days]
      .map((value, i) => ({ value, name: UNITS[i] }))
      .filter(({ value }) => value > 0)
      .map(({ value, name }) => `${value} ${name}${value === 1 ? '' : 's'}`)
      .join(' ');

  // Midnight to midnight, so hours/minutes/seconds are 0 and the day count is the
  // whole story. January 2026 has 31 days and February 2026 (non-leap) has 28, so the
  // calendar-month boundary here lands at day 31, not the old fixed day 28.
  const AT_MIDNIGHT = new Date('2026-01-01T00:00:00');
  const daysOut = (n: number) => computeCountdown(new Date(2026, 0, 1 + n), AT_MIDNIGHT);

  it('29 days -> "29 days" (unsplit: not yet a full calendar month in a 31-day January)', () => {
    // This is the exact instant issue #11's shipped bug and D-306's fix both used as their
    // headline example. Under calendar-accurate months, 29 days from Jan 1 has not yet
    // completed January (31 days), so it is 0 months, and 29 >= WEEKS_SUPPRESSED_AT (28)
    // means it reads as unsplit days rather than "4 weeks 1 day".
    const c = daysOut(29);
    expect([c.months, c.weeks, c.days]).toEqual([0, 0, 29]);
    expect(render(c)).toBe('29 days');
    expect(c.totalDays).toBe(29);
  });

  it('31 days -> "1 month" (the real January boundary, not a fixed 28)', () => {
    const c = daysOut(31);
    expect([c.months, c.weeks, c.days]).toEqual([1, 0, 0]);
    expect(render(c)).toBe('1 month');
    expect(c.totalDays).toBe(31);
  });

  it('16 days -> "2 weeks 2 days" (unaffected: well inside a single month either scheme)', () => {
    const c = daysOut(16);
    expect([c.months, c.weeks, c.days]).toEqual([0, 2, 2]);
    expect(render(c)).toBe('2 weeks 2 days');
    expect(c.totalDays).toBe(16);
  });

  it('63 days -> "2 months 4 days" (Jan 31 + Feb 28 = 59, +4 more)', () => {
    // Not "2 months 1 week" -- that was the fixed-28-day reading (issue #11's own worked
    // example). The calendar walk crosses January (31) then February (28, non-leap 2026)
    // to land at day 59, leaving a 4-day residue.
    const c = daysOut(63);
    expect([c.months, c.weeks, c.days]).toEqual([2, 0, 4]);
    expect(render(c)).toBe('2 months 4 days');
    expect(c.totalDays).toBe(63);
  });

  it('carries at the real calendar boundaries: 7 days is 1 week, 31 days is 1 month (not a fixed 28)', () => {
    expect([daysOut(7).weeks, daysOut(7).days]).toEqual([1, 0]);
    expect([daysOut(27).months, daysOut(27).weeks, daysOut(27).days]).toEqual([0, 3, 6]);
    expect([daysOut(28).months, daysOut(28).weeks, daysOut(28).days]).toEqual([0, 0, 28]); // suppressed, not "1 month"
    expect([daysOut(31).months, daysOut(31).weeks, daysOut(31).days]).toEqual([1, 0, 0]);
  });

  it('never reports weeks >= 4, and days is either < 7 or >= 28 (suppressed), never in between', () => {
    // `weeks < 4` is still guaranteed (WEEKS_SUPPRESSED_AT stays). `days < 7` is NOT
    // universally true any more: once a calendar month's residue reaches the suppression
    // window it is reported unsplit, and a calendar month's residue can run up to 30 days
    // (a 31-day month minus a 1-day-short walk), not just up to 27 as under the old fixed
    // 28-day carry. That is the D-313 revert's shape, not a bug.
    for (let n = 0; n <= 400; n++) {
      const c = daysOut(n);
      expect(c.weeks, `${n} days`).toBeLessThan(4);
      expect(c.days < 7 || c.days >= 28, `${n} days -> days=${c.days}`).toBe(true);
    }
  });
});
