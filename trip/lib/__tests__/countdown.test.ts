import { describe, it, expect } from 'vitest';
import { computeCountdown } from '../countdown';

// computeCountdown is PURE (D-016): it never reads the clock, so every case here
// passes fixed `target`/`now` Date fixtures. `totalDays` is computed independently of
// the months/weeks/days decomposition, but the two must AGREE — they are read together
// on screen (the unit grid and the "days to go" ring), and since S423 the breakdown must
// sum back to the exact target instant, which fixes both. The sum-back and the
// totalDays reconciliation are swept over a year in `countdown-sum-back.test.ts`;
// the cases here stay hand-verified fixtures.

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

  it('computes an exact hand-verified interval: 2 months, residue days/hours/min/sec', () => {
    // target: 2027-03-15T10:30:45, now: 2027-01-10T08:15:20
    // differenceInMonths(target, now) -> 2 whole calendar months (Jan10 -> Mar10)
    // cursor = addMonths(now, 2) = 2027-03-10T08:15:20
    // dayRem = differenceInDays(target=2027-03-15T10:30:45, cursor=2027-03-10T08:15:20) = 5
    //   (5 whole days between 03-10T08:15:20 and 03-15T10:30:45, since time-of-day advanced)
    // weeks = floor(5/7) = 0, days = 5 % 7 = 5
    // subDayStart = addDays(cursor, 5) = 2027-03-15T08:15:20
    // remMs = target - subDayStart = (10:30:45 - 08:15:20) = 2h15m25s
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
      totalDays: expect.any(Number),
      isPast: false,
    });
    // totalDays is a SEPARATE flat whole-day count (D-016) - verify it independently,
    // not against the months/weeks/days breakdown.
    expect(result.totalDays).toBe(64); // differenceInDays(2027-03-15T10:30:45, 2027-01-10T08:15:20)
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
    const now = new Date('2026-11-09T00:00:00'); // exactly one calendar month before
    const result = computeCountdown(target, now);
    expect(result.months).toBe(1);
    expect(result.weeks).toBe(0);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
    expect(result.totalDays).toBe(30); // Nov (30 days) -> Dec 9, flat day count
    expect(result.isPast).toBe(false);
  });
});
