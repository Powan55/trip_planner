import { describe, it, expect } from 'vitest';
import { isAfterTrip } from '@/hooks/use-trip-day';

describe('isAfterTrip (#791 post-trip /travel copy)', () => {
  it('is false before mount (empty day)', () => {
    expect(isAfterTrip('', '2027-01-09')).toBe(false);
  });
  it('is false on the last trip day and before it', () => {
    expect(isAfterTrip('2027-01-09', '2027-01-09')).toBe(false);
    expect(isAfterTrip('2026-11-15', '2027-01-09')).toBe(false);
  });
  it('is true the day after the trip ends', () => {
    expect(isAfterTrip('2027-01-10', '2027-01-09')).toBe(true);
  });
  it('is false when the trip has no days', () => {
    expect(isAfterTrip('2027-01-10', undefined)).toBe(false);
  });
});
