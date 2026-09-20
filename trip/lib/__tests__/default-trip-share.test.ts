// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * D-542 — the default pack gains a remote path WITHOUT moving any data.
 *
 * The failure mode this guards is losing the traveler's plan. The rejected design (create a custom
 * trip, copy every slot across) has an obvious one: `keyFor` namespaces on the PACK id, so a
 * pointer switch strands the itinerary at the legacy key and the vault falls back to blank day
 * shells. The shipped design copies nothing, so the assertion that matters is the NEGATIVE one —
 * `ITINERARY_STORAGE_KEY` and the plans behind it are byte-identical either side of opting in.
 *
 * Env is stubbed present throughout (a dormant build cannot sync at all, which the pack-gate suite
 * already covers); the only variable here is the share id.
 */
async function loadWithEnv() {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'test-app');
  vi.resetModules();
  const [config, gateway, storage] = await Promise.all([
    import('@/lib/firebase-config'),
    import('@/core/storage/gateway'),
    import('@/core/vault/storage'),
  ]);
  return { ...config, ...gateway, ...storage };
}

const SHARE_KEY = 'nepal_japan_default_trip_share';
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('D-542 — the default pack can be shared without moving its data', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('the gate', () => {
    it("absent share id ⇒ getTripId() is '' and the trip is local-only (#10 verbatim)", async () => {
      const { getTripId, isTripRemoteConfigured, isRemoteConfigured } = await loadWithEnv();
      expect(isRemoteConfigured()).toBe(true);
      expect(getTripId()).toBe('');
      expect(isTripRemoteConfigured()).toBe(false);
    });

    it('a minted share id ⇒ getTripId() returns it and sync turns ON', async () => {
      const { getTripId, isTripRemoteConfigured, setDefaultTripShareId } = await loadWithEnv();
      setDefaultTripShareId(ID);
      expect(getTripId()).toBe(ID);
      expect(isTripRemoteConfigured()).toBe(true);
    });

    it('a NON-default pack ignores the share id — its own pack id is still the token', async () => {
      const { getTripId, setDefaultTripShareId } = await loadWithEnv();
      setDefaultTripShareId(ID);
      localStorage.setItem('tripPlannerActiveTrip', 'hokkaido-2027');
      expect(getTripId()).toBe('hokkaido-2027');
    });

    it('a pasted code is trimmed — a stray space would compose a different, empty trip path', async () => {
      const { getTripId, getDefaultTripShareId } = await loadWithEnv();
      localStorage.setItem(SHARE_KEY, `  ${ID}\n`);
      expect(getDefaultTripShareId()).toBe(ID);
      expect(getTripId()).toBe(ID);
    });

    it("clearing with '' removes the key and returns the trip to local-only", async () => {
      const { getTripId, setDefaultTripShareId } = await loadWithEnv();
      setDefaultTripShareId(ID);
      setDefaultTripShareId('   ');
      expect(localStorage.getItem(SHARE_KEY)).toBeNull();
      expect(getTripId()).toBe('');
    });
  });

  describe('THE DATA NEVER MOVES — the guard against losing the plan', () => {
    it('the itinerary storage key is identical before and after opting in', async () => {
      const { keyFor, setDefaultTripShareId, ITINERARY_STORAGE_KEY } = await loadWithEnv();
      const before = keyFor('itinerary');
      setDefaultTripShareId(ID);
      const after = keyFor('itinerary');

      expect(before).toBe('nepal_japan_itinerary');
      expect(after).toBe(before);
      // Never the namespaced form the rejected copy-across design would have produced.
      expect(after).not.toBe(`trip:${ID}:itinerary`);
      expect(ITINERARY_STORAGE_KEY).toBe(before);
    });

    it('a real saved plan is still readable, item for item, after opting in', async () => {
      const { savePlans, loadPlans, setDefaultTripShareId } = await loadWithEnv();
      const plan = [
        {
          date: '2026-12-10',
          city: 'Kathmandu',
          country: 'nepal' as const,
          items: [
            {
              id: 'n2-5',
              title: 'Welcome dinner at Bhojan Griha',
              category: 'food' as const,
              time: '20:30',
              duration: '2h',
            },
          ],
        },
      ];
      savePlans(plan);
      const before = loadPlans();

      setDefaultTripShareId(ID);

      expect(loadPlans()).toEqual(before);
      expect(loadPlans()[0].items[0].title).toBe('Welcome dinner at Bhojan Griha');
    });

    it('EVERY trip-scoped slot keeps its key — expenses, docs, places and the rest travel too', async () => {
      const { keyFor, TRIP_SCOPED_SLOTS, setDefaultTripShareId } = await loadWithEnv();
      const before = TRIP_SCOPED_SLOTS.map((s) => keyFor(s));
      setDefaultTripShareId(ID);
      expect(TRIP_SCOPED_SLOTS.map((s) => keyFor(s))).toEqual(before);
      expect(before.some((k) => k.startsWith('trip:'))).toBe(false);
    });
  });

  describe('idempotence', () => {
    it('opting in twice with the same id changes nothing the second time', async () => {
      const { savePlans, loadPlans, keyFor, setDefaultTripShareId, getTripId } = await loadWithEnv();
      savePlans([{ date: '2026-12-09', city: 'New York', country: 'nepal' as const, items: [] }]);

      setDefaultTripShareId(ID);
      const snapshot = { ...localStorage };
      const plansOnce = loadPlans();

      setDefaultTripShareId(ID);

      expect({ ...localStorage }).toEqual(snapshot);
      expect(loadPlans()).toEqual(plansOnce);
      expect(getTripId()).toBe(ID);
      expect(keyFor('itinerary')).toBe('nepal_japan_itinerary');
    });

    it('re-pointing at a DIFFERENT shared plan still leaves the local plan on disk', async () => {
      const { savePlans, loadPlans, setDefaultTripShareId } = await loadWithEnv();
      savePlans([{ date: '2026-12-09', city: 'New York', country: 'nepal' as const, items: [] }]);
      const before = loadPlans();

      setDefaultTripShareId(ID);
      setDefaultTripShareId('a-different-trip-code');

      expect(loadPlans()).toEqual(before);
    });
  });

  describe('teardown', () => {
    it('sign-out clears the share id — the next person on this device is not joined to the old trip', async () => {
      const { setDefaultTripShareId, wipeAllTripData, getTripId } = await loadWithEnv();
      setDefaultTripShareId(ID);
      expect(getTripId()).toBe(ID);

      wipeAllTripData();

      expect(localStorage.getItem(SHARE_KEY)).toBeNull();
      expect(getTripId()).toBe('');
    });
  });
});
