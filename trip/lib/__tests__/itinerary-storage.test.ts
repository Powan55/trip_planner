// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITINERARY_STORAGE_KEY,
  ITINERARY_QUARANTINE_KEY,
  loadPlans,
  savePlans,
  hasStoredPlans,
} from '../itinerary-storage';
import { SAMPLE_ITINERARY } from '../sample-itinerary';
import { CURRENT_ITINERARY_VERSION } from '@/core/vault/migrations';
import type { DayPlan } from '../trip-data';

// D-018 (LOCKED): distinguish by KEY presence, never array length.
//   1. key ABSENT               -> seed SAMPLE_ITINERARY.
//   2. key PRESENT & valid      -> return AS-IS, including [].
//   3. key PRESENT but corrupt  -> fall back to SAMPLE_ITINERARY.
// savePlans() ALWAYS writes (including []). No length gate anywhere.

describe('itinerary-storage (D-018 contract)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('key ABSENT: loadPlans() returns SAMPLE_ITINERARY and hasStoredPlans() is false', () => {
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBeNull();
    expect(loadPlans()).toEqual(SAMPLE_ITINERARY);
    expect(hasStoredPlans()).toBe(false);
  });

  it('key PRESENT, valid non-empty array: returns the STORED value verbatim, not the sample', () => {
    const custom: DayPlan[] = [
      { date: '2099-01-01', city: 'Testville', country: 'nepal', items: [] },
    ];
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(custom));
    const loaded = loadPlans();
    expect(loaded).toEqual(custom);
    expect(loaded).not.toEqual(SAMPLE_ITINERARY);
    expect(hasStoredPlans()).toBe(true);
  });

  it('key PRESENT, empty array []: returns [] (NOT the sample) — the D-018 hard guarantee', () => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify([]));
    expect(loadPlans()).toEqual([]);
    expect(hasStoredPlans()).toBe(true);
  });

  it('key PRESENT, corrupt (invalid JSON): falls back to SAMPLE_ITINERARY', () => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, '{not valid json');
    expect(loadPlans()).toEqual(SAMPLE_ITINERARY);
    // Key presence for hasStoredPlans() is a raw getItem !== null check — the
    // key IS present (even though corrupt), so this is true by the documented
    // contract (presence, not validity, is the signal it exposes).
    expect(hasStoredPlans()).toBe(true);
  });

  it('key PRESENT, valid JSON but not an array (object): falls back to SAMPLE_ITINERARY', () => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify({}));
    expect(loadPlans()).toEqual(SAMPLE_ITINERARY);
  });

  it('key PRESENT, valid JSON but not an array (number): falls back to SAMPLE_ITINERARY', () => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(42));
    expect(loadPlans()).toEqual(SAMPLE_ITINERARY);
  });

  it('savePlans([]) then loadPlans() returns [] — always-writes, no length gate', () => {
    savePlans([]);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).not.toBeNull();
    expect(loadPlans()).toEqual([]);
    expect(hasStoredPlans()).toBe(true);
  });

  it('savePlans(x) then loadPlans() round-trips x exactly', () => {
    const x: DayPlan[] = [
      {
        date: '2026-12-15',
        city: 'Tokyo',
        country: 'japan',
        items: [
          { id: 'x1', title: 'Test item', category: 'sightseeing', time: '09:00' },
        ],
      },
    ];
    savePlans(x);
    expect(loadPlans()).toEqual(x);
  });

  // S78: quarantine-on-corrupt. loadPlans() must PRESERVE the raw corrupt payload to
  // a backup key before falling back to SAMPLE_ITINERARY, so the store's next
  // savePlans() (which always writes sample-derived data back to the MAIN key, D-031)
  // can never permanently destroy the user's real (corrupt-but-recoverable) trip.
  describe('S78: quarantine-on-corrupt (data-loss fix)', () => {
    it('corrupt = non-array JSON (object): quarantine key holds the exact original raw string', () => {
      const raw = JSON.stringify({ foo: 1 });
      localStorage.setItem(ITINERARY_STORAGE_KEY, raw);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBeNull();

      const loaded = loadPlans();

      expect(loaded).toEqual(SAMPLE_ITINERARY);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
    });

    it('corrupt = non-array JSON (number): quarantine key holds the exact original raw string', () => {
      const raw = '42';
      localStorage.setItem(ITINERARY_STORAGE_KEY, raw);

      const loaded = loadPlans();

      expect(loaded).toEqual(SAMPLE_ITINERARY);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
    });

    it('corrupt = parse error (unquoted key): quarantine key holds the exact original raw string', () => {
      const raw = '{not json';
      localStorage.setItem(ITINERARY_STORAGE_KEY, raw);

      const loaded = loadPlans();

      expect(loaded).toEqual(SAMPLE_ITINERARY);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
    });

    it('corrupt = parse error (truncated array): quarantine key holds the exact original raw string', () => {
      const raw = '[1,2,';
      localStorage.setItem(ITINERARY_STORAGE_KEY, raw);

      const loaded = loadPlans();

      expect(loaded).toEqual(SAMPLE_ITINERARY);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
    });

    it("don't-clobber: a second corrupt load does NOT overwrite an existing quarantine", () => {
      const firstRaw = '{"original":"the users real trip, corrupted"}';
      localStorage.setItem(ITINERARY_STORAGE_KEY, firstRaw);
      loadPlans();
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(firstRaw);

      // A subsequent, DIFFERENT corrupt payload lands in the main key (e.g. another
      // corruption event) — the quarantine must still hold the FIRST captured raw.
      const secondRaw = '{"different":"corruption"}';
      localStorage.setItem(ITINERARY_STORAGE_KEY, secondRaw);
      loadPlans();

      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(firstRaw);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).not.toBe(secondRaw);
    });

    it('CORE GUARANTEE: after a corrupt load, a subsequent savePlans() overwrites the MAIN key but the quarantine key still holds the original bytes (recoverable, not destroyed)', () => {
      const usersRealTrip = '{"this is": "the users real, precious trip data, now corrupted"}';
      localStorage.setItem(ITINERARY_STORAGE_KEY, usersRealTrip);

      // Simulates hooks/use-itinerary.ts's commit(): prev = loadPlans() (corrupt ->
      // sample + quarantine side effect), next = compute(prev), savePlans(next).
      const prev = loadPlans();
      expect(prev).toEqual(SAMPLE_ITINERARY);
      const next = [...prev, { date: '2099-06-01', city: 'New', country: 'nepal' as const, items: [] }];
      savePlans(next);

      // MAIN key now holds sample-derived data (expected — the store always writes).
      // S90 (D-095): savePlans() writes the CURRENT Vault envelope, so the persisted value
      // is `{ schemaVersion: CURRENT, updatedAt, payload: next }` — the PAYLOAD is `next`.
      // (Only pre-existing assertion touched by the Vault: it peeked at the raw on-disk
      //  encoding, which D-095 mandates change from bare-array to envelope; the test's
      //  actual guarantee — main overwritten with the new plans, quarantine intact — is
      //  unchanged and is asserted below. Recorded at review.)
      // S96 (D-104): the current version is now 4 — asserted via the constant so this
      //  tracks the version, not a frozen literal. The guarantee is unchanged.
      const storedEnvelope = JSON.parse(localStorage.getItem(ITINERARY_STORAGE_KEY)!);
      expect(storedEnvelope.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
      expect(storedEnvelope.payload).toEqual(next);
      // But the user's ORIGINAL bytes are still sitting safely in quarantine.
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(usersRealTrip);
    });

    it('no false quarantine: key ABSENT -> sample, quarantine key stays absent', () => {
      expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBeNull();
      expect(loadPlans()).toEqual(SAMPLE_ITINERARY);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBeNull();
    });

    it('no false quarantine: valid non-empty array -> verbatim, quarantine key stays absent', () => {
      const custom: DayPlan[] = [
        { date: '2099-01-01', city: 'Testville', country: 'nepal', items: [] },
      ];
      localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(custom));

      const loaded = loadPlans();

      expect(loaded).toEqual(custom);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBeNull();
    });

    it('no false quarantine: valid empty array [] -> returns [] (D-018 intact), quarantine key stays absent', () => {
      localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify([]));

      const loaded = loadPlans();

      expect(loaded).toEqual([]);
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBeNull();
    });

    it('hasStoredPlans() is unchanged by quarantine: still main-key presence only', () => {
      localStorage.setItem(ITINERARY_STORAGE_KEY, '{not valid json');
      loadPlans(); // triggers quarantine write
      expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).not.toBeNull();
      // hasStoredPlans() must not be influenced by the quarantine key's presence.
      expect(hasStoredPlans()).toBe(true);
    });
  });
});
