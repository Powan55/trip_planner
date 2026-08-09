// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { travelModeGate, travelReturn } from '@/core/storage/travel-mode-store';

/**
 * S190 (D-194 / D-164) — the Travel Mode persisted accessors (keys 19/20). Pins the 3-state flag
 * machine and the session return-route slot, plus the byte-exact on-disk key strings (D-097).
 */
describe('travel-mode-store (S190, keys 19/20)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('pins the on-disk key literals verbatim (D-097)', () => {
    expect(STORAGE_KEYS.travelMode).toBe('nepal_japan_travel_mode');
    expect(STORAGE_KEYS.travelReturn).toBe('tripPlannerTravelReturn');
  });

  describe('travelModeGate — 3-state flag: absent → seen → active', () => {
    it('starts absent: not active, not seen', () => {
      expect(travelModeGate.isActive()).toBe(false);
      expect(travelModeGate.hasSeen()).toBe(false);
    });

    it('enter() arms active AND counts as seen; writes the literal "active"', () => {
      travelModeGate.enter();
      expect(travelModeGate.isActive()).toBe(true);
      expect(travelModeGate.hasSeen()).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.travelMode)).toBe('active');
    });

    it('exit() downgrades active → seen: no longer active, still seen', () => {
      travelModeGate.enter();
      travelModeGate.exit();
      expect(travelModeGate.isActive()).toBe(false);
      expect(travelModeGate.hasSeen()).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.travelMode)).toBe('seen');
    });

    it('markSeen() from absent marks seen (toast dismiss), never active', () => {
      travelModeGate.markSeen();
      expect(travelModeGate.hasSeen()).toBe(true);
      expect(travelModeGate.isActive()).toBe(false);
      expect(localStorage.getItem(STORAGE_KEYS.travelMode)).toBe('seen');
    });

    it('markSeen() NEVER clobbers an active flag', () => {
      travelModeGate.enter(); // 'active'
      travelModeGate.markSeen(); // must be a no-op — active still wins
      expect(travelModeGate.isActive()).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.travelMode)).toBe('active');
    });

    it('once seen (dismissed), it stays seen across reads (exactly-once toast contract)', () => {
      travelModeGate.markSeen();
      expect(travelModeGate.hasSeen()).toBe(true);
      // A second dismiss is idempotent.
      travelModeGate.markSeen();
      expect(travelModeGate.hasSeen()).toBe(true);
    });
  });

  describe('travelReturn — session return-route slot', () => {
    it('is null when unset (cold start → exit falls back to /)', () => {
      expect(travelReturn.get()).toBeNull();
    });

    it('round-trips a route string on the SESSION store, and clears', () => {
      travelReturn.set('/plan/?focus=abc');
      expect(travelReturn.get()).toBe('/plan/?focus=abc');
      expect(sessionStorage.getItem(STORAGE_KEYS.travelReturn)).toBe('/plan/?focus=abc');
      // Not on localStorage — session only.
      expect(localStorage.getItem(STORAGE_KEYS.travelReturn)).toBeNull();
      travelReturn.clear();
      expect(travelReturn.get()).toBeNull();
    });
  });
});
