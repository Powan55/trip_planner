// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  DEFAULT_TRIP_ID,
  getActiveTripId,
  setActiveTripId,
  keyFor,
  deviceStore,
  wipeAllTripData,
  TRIP_SCOPED_SLOTS,
} from '@/core/storage/gateway';

/**
 * S183 — trip-pack key namespacing (D-172 LOCKED). These are ADDITIVE tests; the
 * pre-S183 gateway suite (gateway.test.ts) is untouched and stands as the "default pack is
 * byte-identical" proof. Here we pin the NEW surface:
 *   - the pack-independent `activeTrip` pointer (unset ⇒ default; SSR/never-throw)
 *   - keyFor grandfather is ID-EQUALITY, not key-absence: default id ⇒ legacy literal VERBATIM
 *   - non-default id ⇒ `trip:{id}:{slot}` (slot = registry NAME)
 *   - keyFor changes the STRING only, never the Store (app-scoped slots structurally excluded)
 *
 * S352: the hand-maintained 9-slot `TRIP_SCOPED` array formerly declared here is DELETED — it had
 * already drifted from the type (missing `docsChecklist`/`packing`/`dayAnchors`/`shareInbox`/
 * `myPlaces`). Every loop below now drives off the canonical `TRIP_SCOPED_SLOTS` export instead, so
 * the coverage widened to the full 14-slot union with no behavior change.
 */

describe('gateway trip-scope (S183 / D-172)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // ── activeTrip pointer ─────────────────────────────────────────────────────
  describe('activeTrip pointer (pack-independent, app-scoped)', () => {
    it('the on-disk key is exactly tripPlannerActiveTrip and the default id is the grandfather slug', () => {
      expect(STORAGE_KEYS.activeTrip).toBe('tripPlannerActiveTrip');
      expect(DEFAULT_TRIP_ID).toBe('nepal-japan-2026');
    });

    it('getActiveTripId returns DEFAULT_TRIP_ID when the pointer is unset (grandfather)', () => {
      expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
    });

    it('setActiveTripId writes the raw id under the exact key and getActiveTripId reads it back', () => {
      setActiveTripId('hokkaido-2027');
      expect(window.localStorage.getItem('tripPlannerActiveTrip')).toBe('hokkaido-2027');
      expect(getActiveTripId()).toBe('hokkaido-2027');
    });

    it('the pointer lives on LOCAL storage only (survives reload), never session', () => {
      setActiveTripId('hokkaido-2027');
      expect(window.sessionStorage.getItem('tripPlannerActiveTrip')).toBeNull();
    });

    it('SSR-safe: with no window, getActiveTripId returns the default and setActiveTripId is inert', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => {
          expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
          setActiveTripId('x'); // no-op
        }).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });

    it('never throws when storage is disabled; getActiveTripId falls back to the default', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => setActiveTripId('x')).not.toThrow();
      expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
    });
  });

  // ── keyFor grandfather (id-equality) ───────────────────────────────────────
  describe('keyFor — default pack yields the legacy literal VERBATIM (grandfather)', () => {
    it('unset pointer ⇒ every trip-scoped slot returns its exact legacy STORAGE_KEYS literal', () => {
      for (const slot of TRIP_SCOPED_SLOTS) {
        expect(keyFor(slot)).toBe(STORAGE_KEYS[slot]);
      }
    });

    it('grandfather is ID-EQUALITY, not key-absence: explicitly writing the default id still yields legacy literals', () => {
      setActiveTripId(DEFAULT_TRIP_ID); // the S194 switcher writing the default id
      expect(window.localStorage.getItem('tripPlannerActiveTrip')).toBe(DEFAULT_TRIP_ID);
      for (const slot of TRIP_SCOPED_SLOTS) {
        expect(keyFor(slot)).toBe(STORAGE_KEYS[slot]);
      }
    });

    it('spot-check: the byte-identical legacy strings the live site already uses', () => {
      expect(keyFor('budget')).toBe('nepal_japan_budget');
      expect(keyFor('expenses')).toBe('nepal_japan_expenses');
      expect(keyFor('journal')).toBe('nepal_japan_journal');
      expect(keyFor('favorites')).toBe('nepal_japan_favorites');
      expect(keyFor('photos')).toBe('nepal_japan_photos');
      expect(keyFor('syncOutbox')).toBe('nepal_japan_sync_outbox');
      expect(keyFor('weatherCache')).toBe('nepal_japan_weather_cache');
      // S232 / D-210 — the itinerary slots grandfather to the EXACT legacy literals the live
      // Vault already uses, so the deployed trip's itinerary bytes are untouched.
      expect(keyFor('itinerary')).toBe('nepal_japan_itinerary');
      expect(keyFor('itineraryCorrupt')).toBe('nepal_japan_itinerary_corrupt');
    });
  });

  // ── S232 / D-210 — the itinerary Vault trip-scoping fix, grandfather BOTH directions ───────
  describe('itinerary Vault slots — the local-data-bleed fix (S232 / D-210)', () => {
    it('default pack ⇒ the exact legacy Vault literals VERBATIM (grandfather, both directions)', () => {
      // Pointer unset (implicit default) and pointer explicitly set to the default id both yield
      // the byte-identical legacy strings — the live trip's itinerary + quarantine keys never move.
      expect(keyFor('itinerary')).toBe('nepal_japan_itinerary');
      expect(keyFor('itineraryCorrupt')).toBe('nepal_japan_itinerary_corrupt');
      setActiveTripId(DEFAULT_TRIP_ID);
      expect(keyFor('itinerary')).toBe('nepal_japan_itinerary');
      expect(keyFor('itineraryCorrupt')).toBe('nepal_japan_itinerary_corrupt');
      expect(STORAGE_KEYS.itinerary).toBe('nepal_japan_itinerary');
      expect(STORAGE_KEYS.itineraryCorrupt).toBe('nepal_japan_itinerary_corrupt');
    });

    it('non-default pack ⇒ itinerary namespaces under trip:{id}:* (no collision with the default)', () => {
      setActiveTripId('a1b2c3d4-token');
      expect(keyFor('itinerary')).toBe('trip:a1b2c3d4-token:itinerary');
      expect(keyFor('itineraryCorrupt')).toBe('trip:a1b2c3d4-token:itineraryCorrupt');
      // crucially NOT the legacy literal — a new trip can never read/write the live trip's itinerary
      expect(keyFor('itinerary')).not.toBe('nepal_japan_itinerary');
      expect(keyFor('itineraryCorrupt')).not.toBe('nepal_japan_itinerary_corrupt');
    });
  });

  // ── S232 / D-210 — the device-id slot (app-scoped, presence heartbeat doc id after auth strip) ──
  describe('deviceStore — a persisted, reload-stable device id (S232 / D-210)', () => {
    it('mints a uuid on first call, persists it under the exact key, and returns it verbatim thereafter', () => {
      expect(STORAGE_KEYS.deviceId).toBe('nepal_japan_device_id');
      const first = deviceStore.getId();
      expect(first).toMatch(/[0-9a-f-]{8,}/i);
      expect(window.localStorage.getItem('nepal_japan_device_id')).toBe(first);
      // Read-back is stable (never re-mints once persisted).
      expect(deviceStore.getId()).toBe(first);
    });

    it('is APP-SCOPED — the id is the SAME across a pack switch (identifies the device, not a trip)', () => {
      const id = deviceStore.getId();
      setActiveTripId('a1b2c3d4-token');
      expect(deviceStore.getId()).toBe(id);
    });
  });

  // ── keyFor namespacing (non-default pack) ──────────────────────────────────
  describe('keyFor — a non-default pack namespaces to trip:{id}:{slot}', () => {
    it('uses the registry NAME (not the legacy literal) in the namespaced key', () => {
      setActiveTripId('hokkaido-2027');
      expect(keyFor('journal')).toBe('trip:hokkaido-2027:journal');
      expect(keyFor('budget')).toBe('trip:hokkaido-2027:budget');
      for (const slot of TRIP_SCOPED_SLOTS) {
        expect(keyFor(slot)).toBe(`trip:hokkaido-2027:${slot}`);
        // and crucially NOT the legacy literal — the live tree is untouched by another pack
        expect(keyFor(slot)).not.toBe(STORAGE_KEYS[slot]);
      }
    });

    it('the activeTrip pointer itself is NEVER namespaced (it is the pointer that drives namespacing)', () => {
      setActiveTripId('hokkaido-2027');
      // reading the pointer still uses the pack-independent literal, not trip:hokkaido:activeTrip
      expect(window.localStorage.getItem('tripPlannerActiveTrip')).toBe('hokkaido-2027');
      expect(STORAGE_KEYS.activeTrip).toBe('tripPlannerActiveTrip');
    });

    it('never throws when storage is disabled during a namespaced read', () => {
      setActiveTripId('hokkaido-2027');
      // even if a later getItem throws, keyFor falls back to the default id ⇒ legacy literal, no throw
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => keyFor('journal')).not.toThrow();
    });
  });

  // ── App-scoped slots are STRUCTURALLY excluded (type-level, D-172 fact 5) ───
  describe('app-scoped slots cannot be namespaced — the type system forbids it', () => {
    it('passing an app-scoped slot to keyFor is a COMPILE error (structural guarantee)', () => {
      // @ts-expect-error — 'token' is app-scoped (identity per-person), not a TripScopedSlot.
      expect(() => keyFor('token')).not.toThrow();
      // @ts-expect-error — 'todayOverride' is app-scoped (D-075 session), never namespaced.
      expect(() => keyFor('todayOverride')).not.toThrow();
      // @ts-expect-error — 'activeTrip' is the pack-independent pointer itself.
      expect(() => keyFor('activeTrip')).not.toThrow();
      // @ts-expect-error — 'firstRunTour' is app-scoped.
      expect(() => keyFor('firstRunTour')).not.toThrow();
    });
  });
});

// ── wipeAllTripData (S352, D-249 amended — Ruling 1 / Ruling 1b / Ruling 4) ─────────────────────
describe('wipeAllTripData — the sign-out teardown clears BOTH trip-scoped namespaces', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the DEFAULT PACK (bare nepal_japan_* literals, no prefix) — the mandatory shape (Ruling 1)', () => {
    // The default pack is the COMMON case (no active-trip pointer ever written) — a `trip:` prefix
    // sweep alone reaches ZERO of these, which is the exact defect this test exists to catch.
    for (const slot of TRIP_SCOPED_SLOTS) window.localStorage.setItem(STORAGE_KEYS[slot], 'x');
    wipeAllTripData();
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(window.localStorage.getItem(STORAGE_KEYS[slot])).toBeNull();
    }
  });

  it('clears a NON-DEFAULT pack (trip:{id}:* prefixed keys) in the SAME call — both namespaces, one seed', () => {
    // The mandatory shape: seed BOTH namespaces in the same test so a wipe that only handles
    // one of them — the vacuous pass that hid this defect originally — cannot pass silently.
    for (const slot of TRIP_SCOPED_SLOTS) {
      window.localStorage.setItem(STORAGE_KEYS[slot], 'default-pack');
      window.localStorage.setItem(`trip:some-other-trip:${slot}`, 'non-default-pack');
    }
    wipeAllTripData();
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(window.localStorage.getItem(STORAGE_KEYS[slot])).toBeNull();
      expect(window.localStorage.getItem(`trip:some-other-trip:${slot}`)).toBeNull();
    }
    expect(Object.keys(window.localStorage).some((k) => k.startsWith('trip:'))).toBe(false);
  });

  it('clears itineraryCorrupt in BOTH namespaces (Ruling 1b — REVERSES the earlier "must exclude" reading)', () => {
    window.localStorage.setItem(STORAGE_KEYS.itineraryCorrupt, 'previous travelers raw bytes');
    window.localStorage.setItem('trip:some-other-trip:itineraryCorrupt', 'previous travelers raw bytes');
    wipeAllTripData();
    expect(window.localStorage.getItem(STORAGE_KEYS.itineraryCorrupt)).toBeNull();
    expect(window.localStorage.getItem('trip:some-other-trip:itineraryCorrupt')).toBeNull();
  });

  it('collect-then-delete: ≥3 trip:* keys are ALL removed (delete-while-iterating would skip every other one)', () => {
    window.localStorage.setItem('trip:a:budget', '1');
    window.localStorage.setItem('trip:a:journal', '2');
    window.localStorage.setItem('trip:a:expenses', '3');
    window.localStorage.setItem('trip:a:photos', '4');
    wipeAllTripData();
    expect(Object.keys(window.localStorage).some((k) => k.startsWith('trip:'))).toBe(false);
  });

  it('clears the app-scoped pointers/lists: activeTrip, knownTrips, removedTrips, syncCode, travelMode (Ruling 4)', () => {
    window.localStorage.setItem(STORAGE_KEYS.activeTrip, 'some-trip');
    window.localStorage.setItem(STORAGE_KEYS.knownTrips, '[{"id":"x"}]');
    window.localStorage.setItem(STORAGE_KEYS.removedTrips, '[{"id":"y"}]');
    window.localStorage.setItem(STORAGE_KEYS.syncCode, 'abc-123');
    window.localStorage.setItem(STORAGE_KEYS.travelMode, 'active');
    wipeAllTripData();
    expect(window.localStorage.getItem(STORAGE_KEYS.activeTrip)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.knownTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.removedTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.syncCode)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.travelMode)).toBeNull();
  });

  it('does NOT touch identity or anything else unrelated (the caller, signOut(), clears identity itself)', () => {
    window.localStorage.setItem(STORAGE_KEYS.token, 'Powan');
    window.localStorage.setItem(STORAGE_KEYS.userName, 'Powan');
    window.localStorage.setItem(STORAGE_KEYS.firstRunTour, '1');
    wipeAllTripData();
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBe('Powan');
    expect(window.localStorage.getItem(STORAGE_KEYS.userName)).toBe('Powan');
    expect(window.localStorage.getItem(STORAGE_KEYS.firstRunTour)).toBe('1');
  });

  it('is SSR-safe: with no window, wipeAllTripData is a silent no-op', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => wipeAllTripData()).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when storage is disabled (throwing key/removeItem accessors)', () => {
    window.localStorage.setItem('trip:a:budget', '1'); // ensures the prefix-scan loop actually iterates
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(() => wipeAllTripData()).not.toThrow();
  });
});
