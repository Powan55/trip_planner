import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  subscribeTravelTick,
  requestFastTick,
  currentTravelTickMs,
  __resetTravelTick,
} from '@/lib/travel-tick';

/**
 * S277 — the testable core of the shared `/travel` tick: ONE interval, slow (20s) when idle,
 * escalated to 1s ONLY while a fast subscriber is held, relaxed back on release. (The battery win
 * itself isn't unit-testable; the rate-selection logic is.)
 */
describe('travel-tick rate selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetTravelTick();
  });
  afterEach(() => {
    __resetTravelTick();
    vi.useRealTimers();
  });

  it('runs no interval until something subscribes', () => {
    expect(currentTravelTickMs()).toBeNull();
  });

  it('ticks at the 20s base rate while idle (no fast request)', () => {
    subscribeTravelTick(() => {});
    expect(currentTravelTickMs()).toBe(20_000);
  });

  it('escalates to 1s while a fast subscriber is held, relaxes to base on release', () => {
    subscribeTravelTick(() => {});
    expect(currentTravelTickMs()).toBe(20_000);

    const release = requestFastTick();
    expect(currentTravelTickMs()).toBe(1_000);

    release();
    expect(currentTravelTickMs()).toBe(20_000);
  });

  it('stays fast until the LAST of multiple fast requests releases (ref-counted)', () => {
    subscribeTravelTick(() => {});
    const r1 = requestFastTick();
    const r2 = requestFastTick();
    expect(currentTravelTickMs()).toBe(1_000);

    r1();
    expect(currentTravelTickMs()).toBe(1_000); // r2 still holds it

    r2();
    expect(currentTravelTickMs()).toBe(20_000);
  });

  it('a double release does not underflow the count', () => {
    subscribeTravelTick(() => {});
    const release = requestFastTick();
    release();
    release(); // idempotent — must not drop below zero
    expect(currentTravelTickMs()).toBe(20_000);

    // A fresh fast request must still escalate (count is a clean 0, not negative).
    const again = requestFastTick();
    expect(currentTravelTickMs()).toBe(1_000);
    again();
  });

  it('fires every subscriber on each tick and stops the interval when the last leaves', () => {
    let a = 0;
    let b = 0;
    const offA = subscribeTravelTick(() => { a += 1; });
    const offB = subscribeTravelTick(() => { b += 1; });

    vi.advanceTimersByTime(20_000);
    expect(a).toBe(1);
    expect(b).toBe(1);

    offA();
    offB();
    expect(currentTravelTickMs()).toBeNull(); // no subscribers → no timer running
  });

  it('a fast request with no subscriber does not start an interval on its own', () => {
    const release = requestFastTick();
    expect(currentTravelTickMs()).toBeNull();
    release();
  });
});
