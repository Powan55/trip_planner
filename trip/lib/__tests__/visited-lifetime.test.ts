// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STORAGE_KEYS,
  TRIP_SCOPED_SLOTS,
  wipeAllTripData,
} from '@/core/storage/gateway';
import { signIn, signOut } from '@/lib/token-auth';
import {
  getVisited,
  addVisit,
  hasVisitedCity,
  hasVisitedCountry,
} from '@/core/places/visited';

/**
 * Lifetime visit set (issue #29, gateway key 32, D-314). Two things are pinned here, and the
 * second is the reason the file exists:
 *
 *  1. the set itself — unique, idempotent adds, case/whitespace-insensitive matching with the
 *     first spelling kept, insertion order, and a total read over an absent/corrupt slot;
 *  2. that it SURVIVES A FULL TRIP WIPE. The wipe is the real `wipeAllTripData()` and the real
 *     `signOut()`, never a hand-rolled imitation — an imitation would be asserting against a copy
 *     of the sweep rather than the sweep, and would keep passing after someone added this key to
 *     `TRIP_SCOPED_SLOTS`. Both wipe cases seed every trip-scoped slot in BOTH namespaces first and
 *     assert that data is gone, so a wipe that silently stopped wiping cannot pass them vacuously.
 */

const KEY = 'tripPlannerLifetimeVisits';

describe('lifetime visit set — the on-disk key is outside the trip namespace (D-314)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('the key string is exactly tripPlannerLifetimeVisits and is unique in the registry', () => {
    expect(STORAGE_KEYS.lifetimeVisits).toBe(KEY);
    const values = Object.values(STORAGE_KEYS) as string[];
    expect(new Set(values).size).toBe(values.length); // no duplicate literals across the registry
  });

  it('is NOT a trip-scoped slot, and carries neither the trip: prefix nor the pack prefix', () => {
    // The two structural reasons the teardown cannot reach it: it is not in the canonical slot
    // list `wipeAllTripData()` iterates, and it does not match the `trip:` prefix sweep.
    expect((TRIP_SCOPED_SLOTS as readonly string[]).includes('lifetimeVisits')).toBe(false);
    for (const slot of TRIP_SCOPED_SLOTS) expect(STORAGE_KEYS[slot]).not.toBe(KEY);
    expect(STORAGE_KEYS.lifetimeVisits.startsWith('trip:')).toBe(false);
    expect(STORAGE_KEYS.lifetimeVisits.startsWith('nepal_japan_')).toBe(false);
  });
});

describe('lifetime visit set — add/read, uniqueness, ordering', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reads as empty on a fresh device (key absent)', () => {
    expect(getVisited()).toEqual({ cities: [], countries: [] });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('addVisit round-trips through storage under the exact key, as JSON', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    expect(getVisited()).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
  });

  it('adds are IDEMPOTENT — the same place twice is recorded once', () => {
    addVisit({ city: 'Tokyo', country: 'Japan' });
    addVisit({ city: 'Tokyo', country: 'Japan' });
    addVisit({ city: 'Tokyo', country: 'Japan' });
    expect(getVisited()).toEqual({ cities: ['Tokyo'], countries: ['Japan'] });
  });

  it('matching folds case and whitespace, and the FIRST spelling is the one kept', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    addVisit({ city: '  kathmandu ', country: 'NEPAL' });
    expect(getVisited()).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
  });

  it('either half may be omitted — a country-only or city-only visit is legal', () => {
    addVisit({ country: 'Bhutan' });
    addVisit({ city: 'Pokhara' });
    expect(getVisited()).toEqual({ cities: ['Pokhara'], countries: ['Bhutan'] });
  });

  it('a blank or whitespace-only value is never recorded', () => {
    addVisit({ city: '   ', country: '' });
    expect(getVisited()).toEqual({ cities: [], countries: [] });
  });

  it('ordering is INSERTION order and stays stable as the set grows', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    addVisit({ city: 'Pokhara' });
    addVisit({ city: 'Tokyo', country: 'Japan' });
    addVisit({ city: 'Kathmandu', country: 'Nepal' }); // a repeat must not re-order
    addVisit({ city: 'Kyoto' });
    expect(getVisited().cities).toEqual(['Kathmandu', 'Pokhara', 'Tokyo', 'Kyoto']);
    expect(getVisited().countries).toEqual(['Nepal', 'Japan']);
  });

  it('addVisit returns the resulting set, so a caller need not re-read', () => {
    expect(addVisit({ city: 'Tokyo', country: 'Japan' })).toEqual({
      cities: ['Tokyo'],
      countries: ['Japan'],
    });
  });

  it('hasVisitedCity / hasVisitedCountry answer through the same fold rule', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    expect(hasVisitedCity('Kathmandu')).toBe(true);
    expect(hasVisitedCity(' kathmandu ')).toBe(true);
    expect(hasVisitedCity('Tokyo')).toBe(false);
    expect(hasVisitedCountry('nepal')).toBe(true);
    expect(hasVisitedCountry('Japan')).toBe(false);
  });

  it('a corrupt or wrong-shaped slot reads as empty and never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(getVisited()).toEqual({ cities: [], countries: [] });
    window.localStorage.setItem(KEY, '"a string"');
    expect(getVisited()).toEqual({ cities: [], countries: [] });
    window.localStorage.setItem(KEY, '{"cities":"Tokyo","countries":7}');
    expect(getVisited()).toEqual({ cities: [], countries: [] });
  });

  it('sanitizes on read: non-strings, blanks and duplicates are dropped, order preserved', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ cities: ['Tokyo', 3, '', 'Kyoto', ' tokyo ', null], countries: ['Japan'] }),
    );
    expect(getVisited()).toEqual({ cities: ['Tokyo', 'Kyoto'], countries: ['Japan'] });
  });

  it('SSR-safe: with no window the read is empty and the write is inert, neither throws', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(getVisited()).toEqual({ cities: [], countries: [] });
      expect(() => addVisit({ city: 'Tokyo', country: 'Japan' })).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });
});

// ── The centrepiece: it outlives the trip ────────────────────────────────────────────────────────
describe('lifetime visit set — survives a FULL trip wipe (issue #29, D-314)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  /** Seed every trip-scoped slot in BOTH namespaces plus the app-scoped pointers the wipe clears. */
  function seedTripData(): void {
    for (const slot of TRIP_SCOPED_SLOTS) {
      window.localStorage.setItem(STORAGE_KEYS[slot], 'default-pack');
      window.localStorage.setItem(`trip:some-other-trip:${slot}`, 'non-default-pack');
    }
    window.localStorage.setItem(STORAGE_KEYS.activeTrip, 'some-other-trip');
    window.localStorage.setItem(STORAGE_KEYS.knownTrips, '[{"id":"some-other-trip"}]');
    window.localStorage.setItem(STORAGE_KEYS.removedTrips, '[{"id":"gone"}]');
    window.localStorage.setItem(STORAGE_KEYS.syncCode, 'abc-123');
    window.localStorage.setItem(STORAGE_KEYS.travelMode, 'active');
  }

  /** The wipe really ran — asserted in both cases so neither can pass vacuously. */
  function expectTripDataGone(): void {
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(window.localStorage.getItem(STORAGE_KEYS[slot])).toBeNull();
      expect(window.localStorage.getItem(`trip:some-other-trip:${slot}`)).toBeNull();
    }
    expect(window.localStorage.getItem(STORAGE_KEYS.activeTrip)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.knownTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.removedTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.syncCode)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.travelMode)).toBeNull();
  }

  it('wipeAllTripData() — the REAL wipe — clears every trip key and leaves the visit set intact', () => {
    seedTripData();
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    addVisit({ city: 'Tokyo', country: 'Japan' });

    wipeAllTripData();

    expectTripDataGone();
    expect(getVisited()).toEqual({
      cities: ['Kathmandu', 'Tokyo'],
      countries: ['Nepal', 'Japan'],
    });
    // ...and the bytes are still on disk under the same key, not merely re-derivable in memory.
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('signOut() — the whole user-facing teardown — also leaves it intact, identity cleared', () => {
    seedTripData();
    signIn('Powan');
    addVisit({ city: 'Kathmandu', country: 'Nepal' });

    signOut();

    expectTripDataGone();
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.userName)).toBeNull();
    expect(getVisited()).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
  });

  it('the set stays readable and appendable after the wipe (no orphaned/half-cleared state)', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    wipeAllTripData();
    addVisit({ city: 'Pokhara', country: 'Nepal' });
    expect(getVisited()).toEqual({
      cities: ['Kathmandu', 'Pokhara'],
      countries: ['Nepal'],
    });
  });
});
