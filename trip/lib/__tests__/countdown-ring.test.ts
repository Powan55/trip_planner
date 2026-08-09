import { describe, it, expect } from 'vitest';
import { ringFraction } from '@/lib/countdown-ring';

describe('ringFraction — S204 pure derivation over computeCountdown output', () => {
  it('is 0 at the horizon (365 days out by default)', () => {
    expect(ringFraction(365, false)).toBe(0);
  });
  it('is 1 exactly at departure (totalDays === 0)', () => {
    expect(ringFraction(0, false)).toBe(1);
  });
  it('is 1 whenever isPast is true, regardless of totalDays', () => {
    expect(ringFraction(999, true)).toBe(1);
    expect(ringFraction(0, true)).toBe(1);
  });
  it('is the linear midpoint at half the horizon', () => {
    expect(ringFraction(182.5, false)).toBeCloseTo(0.5, 5);
  });
  it('clamps beyond the horizon to 0 (never negative)', () => {
    expect(ringFraction(1000, false)).toBe(0);
  });
  it('clamps a negative totalDays to 1 (defensive — should not occur pre-arrival)', () => {
    expect(ringFraction(-5, false)).toBe(1);
  });
  it('honors a custom horizonDays', () => {
    expect(ringFraction(30, false, 60)).toBeCloseTo(0.5, 5);
    expect(ringFraction(60, false, 60)).toBe(0);
    expect(ringFraction(0, false, 60)).toBe(1);
  });
});
