// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * D-546 — a `?trip=` share link for the DEFAULT pack must land the joiner on the default pack.
 *
 * The regression this exists to catch is silent and total: the joiner opens the link, the app
 * looks fine, and their trip has quietly become a single-leg custom trip. `custom.ts` builds that
 * leg with `utcOffsetMin: 0`, so `tripOffsetMinFor` short-circuits to `null` ("no geography →
 * device-local") and the countdown, what's-next and preflight's clock check all re-anchor on the
 * joiner's own device offset instead of NPT +345 / JST +540. `contentRef` is `'empty'`, so every
 * Nepal/Japan guide, nightlife and photography binding goes with them. Nothing throws and nothing
 * is reported, which is why the assertions below are on the OFFSETS rather than on the pointer:
 * a pointer test would have passed throughout the defect.
 *
 * The contrast case is kept deliberately — the same uuid WITHOUT the namespace prefix still makes
 * a custom trip, because for every other trip in the app that is the correct reading.
 */
const SHARE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PACK_ID = 'nepal-japan-2026';
const SHARE_KEY = 'nepal_japan_default_trip_share';
const ACTIVE_KEY = 'tripPlannerActiveTrip';
const KNOWN_KEY = 'tripPlannerKnownTrips';

/** Mid-trip in Nepal and mid-trip in Japan, as instants. */
const IN_NEPAL = new Date('2026-12-12T06:00:00Z');
const IN_JAPAN = new Date('2026-12-28T06:00:00Z');

async function load() {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'test-app');
  vi.resetModules();
  const [registry, gateway, config, trips, now] = await Promise.all([
    import('@/core/trips/registry'),
    import('@/core/storage/gateway'),
    import('@/lib/firebase-config'),
    import('@/core/trips'),
    import('@/lib/trip-now'),
  ]);
  return { ...registry, ...gateway, ...config, ...trips, ...now };
}

describe('D-546 — a default-pack share link keeps the pack', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('parseTripToken — which namespace does this token name?', () => {
    it('a pack:-prefixed token is the default pack share id, with the prefix stripped', async () => {
      const { parseTripToken } = await load();
      expect(parseTripToken(`pack:${SHARE_ID}`)).toEqual({ kind: 'default', id: SHARE_ID });
    });

    it('a bare token is still a custom trip — that reading is correct for every other trip', async () => {
      const { parseTripToken } = await load();
      expect(parseTripToken(SHARE_ID)).toEqual({ kind: 'custom', id: SHARE_ID });
    });

    it('surrounding whitespace is trimmed on both sides of the prefix', async () => {
      const { parseTripToken } = await load();
      expect(parseTripToken(`  pack: ${SHARE_ID}\n`)).toEqual({ kind: 'default', id: SHARE_ID });
    });

    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['prefix with nothing after it', 'pack:'],
      ['a path separator (#476 — this becomes a Firestore path segment)', 'trips/other/days'],
      ['a prefixed path separator', 'pack:../../other'],
      ['dot', '.'],
      ['dot dot', '..'],
      ['a Firestore-reserved name', '__name__'],
      ['an interior space', 'f47ac10b 58cc'],
      ['a tab', 'f47ac10b\t58cc'],
      ['longer than 128 chars', 'a'.repeat(129)],
    ])('refuses %s', async (_label, raw) => {
      const { parseTripToken } = await load();
      expect(parseTripToken(raw)).toBeNull();
    });

    it('formatShareToken round-trips through parseTripToken for both namespaces', async () => {
      const { formatShareToken, parseTripToken, DEFAULT_TRIP_ID } = await load();
      const forDefault = formatShareToken(DEFAULT_TRIP_ID, SHARE_ID);
      expect(forDefault).toBe(`pack:${SHARE_ID}`);
      expect(parseTripToken(forDefault)).toEqual({ kind: 'default', id: SHARE_ID });

      const forCustom = formatShareToken('hokkaido-2027', 'hokkaido-2027');
      expect(forCustom).toBe('hokkaido-2027');
      expect(parseTripToken(forCustom)).toEqual({ kind: 'custom', id: 'hokkaido-2027' });

      // A pack with no remote path yet has nothing to share, which is what every share
      // affordance disables itself on.
      expect(formatShareToken(DEFAULT_TRIP_ID, '')).toBe('');
    });

    it('survives the URL round trip Settings builds — the colon is percent-encoded', async () => {
      const { formatShareToken, parseTripToken, DEFAULT_TRIP_ID } = await load();
      const token = formatShareToken(DEFAULT_TRIP_ID, SHARE_ID);
      const url = new URL(`https://example.test/trip_planner/?trip=${encodeURIComponent(token)}`);
      expect(url.search).toContain('pack%3A');
      expect(parseTripToken(url.searchParams.get('trip') ?? '')).toEqual({
        kind: 'default',
        id: SHARE_ID,
      });
    });
  });

  describe('THE JOINER KEEPS THEIR CLOCKS — the regression this file exists for', () => {
    it('joining a pack: link stays on the default pack and syncs to the sharer', async () => {
      const { joinTrip, getActiveTripId, getDefaultTripShareId, getTripId, isTripRemoteConfigured } =
        await load();

      expect(joinTrip(`pack:${SHARE_ID}`, 'Shared trip')).toBe(true);

      expect(getActiveTripId()).toBe(PACK_ID);
      expect(getDefaultTripShareId()).toBe(SHARE_ID);
      // …and the pack now points at the SHARER's remote trip, which is the whole point.
      expect(getTripId()).toBe(SHARE_ID);
      expect(isTripRemoteConfigured()).toBe(true);
    });

    it('both legs keep their offsets: Nepal +345, Japan +540', async () => {
      const { joinTrip, tripOffsetMinFor, getActiveTrip } = await load();

      joinTrip(`pack:${SHARE_ID}`, 'Shared trip');

      expect(tripOffsetMinFor(IN_NEPAL)).toBe(345);
      expect(tripOffsetMinFor(IN_JAPAN)).toBe(540);
      expect(getActiveTrip().legs.map((l) => l.utcOffsetMin)).toEqual([345, 540]);
    });

    it('the Nepal/Japan content bindings survive — contentRef is never "empty"', async () => {
      const { joinTrip, getActiveTrip } = await load();

      joinTrip(`pack:${SHARE_ID}`, 'Shared trip');

      const trip = getActiveTrip();
      expect(trip.id).toBe(PACK_ID);
      expect(trip.contentRef).toBe(PACK_ID);
      expect(trip.legs.map((l) => l.id)).toEqual(['nepal', 'japan']);
    });

    it('the share id is never registered as a trip of its own', async () => {
      const { joinTrip, listKnownTrips } = await load();

      joinTrip(`pack:${SHARE_ID}`, 'Shared trip');

      expect(listKnownTrips().some((t) => t.id === SHARE_ID)).toBe(false);
      expect(localStorage.getItem(KNOWN_KEY)).toBeNull();
    });

    it('a joiner already on a custom trip is brought back to the pack', async () => {
      const { joinTrip, getActiveTripId, tripOffsetMinFor } = await load();

      joinTrip('hokkaido-2027', 'Their other trip');
      expect(getActiveTripId()).toBe('hokkaido-2027');
      expect(tripOffsetMinFor(IN_NEPAL)).toBeNull(); // custom: no geography

      expect(joinTrip(`pack:${SHARE_ID}`, 'Shared trip')).toBe(true);

      expect(getActiveTripId()).toBe(PACK_ID);
      expect(tripOffsetMinFor(IN_NEPAL)).toBe(345);
    });

    it('THE DEFECT, pinned: the SAME uuid unprefixed is a custom trip with no clocks', async () => {
      const { joinTrip, getActiveTripId, tripOffsetMinFor, getActiveTrip } = await load();

      joinTrip(SHARE_ID, 'Shared trip');

      expect(getActiveTripId()).toBe(SHARE_ID);
      // This is what every share-link joiner got before D-546: one leg at offset 0, so
      // `tripOffsetMinFor` short-circuits to device-local and the countdown re-anchors.
      expect(tripOffsetMinFor(IN_NEPAL)).toBeNull();
      expect(tripOffsetMinFor(IN_JAPAN)).toBeNull();
      expect(getActiveTrip().contentRef).toBe('empty');
      expect(getActiveTrip().legs).toHaveLength(1);
    });
  });

  describe('a token that cannot be used writes NOTHING (no half-joined state)', () => {
    it.each([['pack:'], ['pack:../escape'], ['trips/x/days'], ['  '], ['__name__']])(
      'joinTrip(%j) returns false and leaves every pointer untouched',
      async (raw) => {
        const { joinTrip, getActiveTripId, getDefaultTripShareId } = await load();

        expect(joinTrip(raw, 'Shared trip')).toBe(false);

        expect(getActiveTripId()).toBe(PACK_ID); // unset pointer ⇒ the default pack
        expect(getDefaultTripShareId()).toBe('');
        expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
        expect(localStorage.getItem(SHARE_KEY)).toBeNull();
        expect(localStorage.getItem(KNOWN_KEY)).toBeNull();
      },
    );

    it('a refused join does not disturb a share id already set on this device', async () => {
      const { joinTrip, getDefaultTripShareId, setDefaultTripShareId } = await load();
      setDefaultTripShareId(SHARE_ID);

      expect(joinTrip('pack:', 'Shared trip')).toBe(false);

      expect(getDefaultTripShareId()).toBe(SHARE_ID);
    });
  });

  describe('joinTrip reports whether the switch landed', () => {
    it('returns true on a successful custom-trip switch (the unchanged path)', async () => {
      const { joinTrip, getActiveTripId } = await load();
      expect(joinTrip('hokkaido-2027', 'Shared trip')).toBe(true);
      expect(getActiveTripId()).toBe('hokkaido-2027');
    });

    it('returns false when the browser swallows the write (private mode / full box)', async () => {
      const { joinTrip, getActiveTripId } = await load();
      // The gateway swallows a throwing setItem by contract, so a call RETURNING is not evidence
      // anything was stored. This is the state the handshake's error copy describes.
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new DOMException('QuotaExceededError');
        });
      try {
        expect(joinTrip('hokkaido-2027', 'Shared trip')).toBe(false);
        expect(getActiveTripId()).toBe(PACK_ID);
      } finally {
        setItem.mockRestore();
      }
    });

    it('…including on the default-pack path, where the share id is the thing that must stick', async () => {
      const { joinTrip, getDefaultTripShareId } = await load();
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new DOMException('QuotaExceededError');
        });
      try {
        expect(joinTrip(`pack:${SHARE_ID}`, 'Shared trip')).toBe(false);
        expect(getDefaultTripShareId()).toBe('');
      } finally {
        setItem.mockRestore();
      }
    });
  });
});
