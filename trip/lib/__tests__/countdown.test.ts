import { describe, it, expect } from 'vitest';
import { computeCountdown } from '../countdown';

// computeCountdown is PURE (D-016): it never reads the clock, so every case here
// passes fixed `target`/`now` Date fixtures. The units carry maximally over fixed 28-day
// months (issue #11, D-306), so `totalDays` and the breakdown are the same number read two
// ways: `months*28 + weeks*7 + days === totalDays`. They are read together on screen (the
// unit grid and the "days to go" ring), and the breakdown must also sum back to the exact
// target instant. The sum-back, the carry and the totalDays reconciliation are swept over a
// year in `countdown-sum-back.test.ts`; the cases here stay hand-verified fixtures.

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

  it('computes an exact hand-verified interval: 2 months, residue weeks/days/hours/min/sec', () => {
    // target: 2027-03-15T10:30:45, now: 2027-01-10T08:15:20
    // totalDays = differenceInDays(target, now) = 64 whole days (the time of day advances
    //   from 08:15:20 to 10:30:45, so the last day is complete and nothing is borrowed)
    // months = floor(64/28) = 2, leaving 64 - 56 = 8 days
    // weeks  = floor(8/7) = 1, days = 64 % 7 = 1
    // walk   = addDays(now, 64) = 2027-03-15T08:15:20
    // remMs  = target - walk = (10:30:45 - 08:15:20) = 2h15m25s
    const target = new Date('2027-03-15T10:30:45');
    const now = new Date('2027-01-10T08:15:20');
    const result = computeCountdown(target, now);
    expect(result).toEqual({
      months: 2,
      weeks: 1,
      days: 1,
      hours: 2,
      minutes: 15,
      seconds: 25,
      totalDays: 64,
      isPast: false,
    });
    // Since issue #11 the parts DO reconcile with the total, by construction.
    expect(result.months * 28 + result.weeks * 7 + result.days).toBe(result.totalDays);
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
    // A carry month is 28 days (issue #11), so a 30-day calendar month reads as
    // 1 month 2 days. The two do not line up, and that is the accepted trade.
    expect(result.months).toBe(1);
    expect(result.weeks).toBe(0);
    expect(result.days).toBe(2);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.totalDays).toBe(30); // Nov (30 days) -> Dec 9, flat day count
    expect(result.isPast).toBe(false);
  });
});

/**
 * Issue #11 acceptance criteria, stated as the issue states them. `render` is the
 * zero-suppression rule every surface applies: the producer reports the true value of every
 * unit, including the zeros, and the renderer skips a unit that is zero.
 */
describe('issue #11: units carry maximally and zero units are not displayed', () => {
  const UNITS = ['month', 'week', 'day'] as const;

  const render = (c: { months: number; weeks: number; days: number }) =>
    [c.months, c.weeks, c.days]
      .map((value, i) => ({ value, name: UNITS[i] }))
      .filter(({ value }) => value > 0)
      .map(({ value, name }) => `${value} ${name}${value === 1 ? '' : 's'}`)
      .join(' ');

  // Midnight to midnight, so hours/minutes/seconds are 0 and the day count is the
  // whole story. Jan-Mar 2026 carries no DST transition in the suite's TZ.
  const AT_MIDNIGHT = new Date('2026-01-01T00:00:00');
  const daysOut = (n: number) => computeCountdown(new Date(2026, 0, 1 + n), AT_MIDNIGHT);

  it('29 days -> "1 month 1 day" (the reported bug: this used to read 29 days, 0 weeks)', () => {
    const c = daysOut(29);
    expect([c.months, c.weeks, c.days]).toEqual([1, 0, 1]);
    expect(render(c)).toBe('1 month 1 day');
    expect(c.totalDays).toBe(29);
  });

  it('16 days -> "2 weeks 2 days"', () => {
    const c = daysOut(16);
    expect([c.months, c.weeks, c.days]).toEqual([0, 2, 2]);
    expect(render(c)).toBe('2 weeks 2 days');
    expect(c.totalDays).toBe(16);
  });

  it('9 weeks (63 days) -> "2 months 1 week"', () => {
    const c = daysOut(63);
    expect([c.months, c.weeks, c.days]).toEqual([2, 1, 0]);
    expect(render(c)).toBe('2 months 1 week');
    expect(c.totalDays).toBe(63);
  });

  it('carries at every boundary the issue names: 7 days is 1 week, 28 days is 1 month', () => {
    expect([daysOut(7).weeks, daysOut(7).days]).toEqual([1, 0]);
    expect([daysOut(27).months, daysOut(27).weeks, daysOut(27).days]).toEqual([0, 3, 6]);
    expect([daysOut(28).months, daysOut(28).weeks, daysOut(28).days]).toEqual([1, 0, 0]);
  });

  it('never reports a unit that a bigger unit could carry: days < 7, weeks < 4', () => {
    for (let n = 0; n <= 400; n++) {
      const c = daysOut(n);
      expect(c.days, `${n} days`).toBeLessThan(7);
      expect(c.weeks, `${n} days`).toBeLessThan(4);
      expect(c.months * 28 + c.weeks * 7 + c.days, `${n} days`).toBe(c.totalDays);
    }
  });
});
