// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Visit auto-counting (issue #30, D-320 amends D-158). Four things are pinned here, and the third
 * is the reason the file exists:
 *
 *  1. **Day-arrival counting** — a city is credited once its day has arrived, as a BACKFILL over
 *     the whole arrived prefix rather than an event, so a device that skips a week still catches up.
 *  2. **The confirmation matcher** — a device fix resolves to the nearest trip city within
 *     `CITY_MATCH_KM`, offline, against the coordinate table the app already ships, and to `null`
 *     when nothing is close enough.
 *  3. **Nothing location-shaped reaches disk.** The success-path test dumps the WHOLE of
 *     localStorage and asserts the fix's own latitude and longitude appear nowhere in it, and that
 *     a stored confirmation has exactly the three fields `city` / `country` / `at`. That is the
 *     amended guarantee, asserted against the bytes rather than against the type.
 *  4. **Every failure is a non-event.** Denied, unavailable, timed out, unsupported, and a
 *     `getCurrentPosition` that throws outright: each leaves the planned count standing, writes no
 *     confirmation, and never throws at the caller — and the denied path still marks the day, so a
 *     refusal costs one prompt, not one per page load.
 *
 * ── Why every case re-imports the module ──────────────────────────────────────────────────────
 * `core/dates`, `lib/leg-label` and `lib/trip-now` all capture their world ONCE (the active trip at
 * module load; the `?today=` override at first read, cached in a module var). So each case seeds
 * storage FIRST, then `vi.resetModules()` + dynamic import, exactly as `trip-cities-scoped.test.ts`
 * does. The clock is always driven through the `?today=` override rather than the real one: a test
 * whose meaning changes when December 2026 actually arrives is not a test.
 */

const VISITS_KEY = 'tripPlannerLifetimeVisits';
const CONFIRM_KEY = 'tripPlannerVisitConfirmations';
const TODAY_KEY = 'tripPlannerTodayOverride';

/** The default pack's per-day cities, for reference: Dec 9 New York (leg 'nepal', label USA — D-315),
 *  Dec 10-18 Kathmandu with Lalitpur/Nagarkot/Bhaktapur day trips, Dec 19-23 Osaka, Dec 24-26 Kyoto,
 *  Dec 27-Jan 9 Tokyo. */
const KATHMANDU = { latitude: 27.7172, longitude: 85.324 };

/**
 * Seed the world, then load a fresh module graph on top of it.
 * `today` drives the `?today=` clock override; `signedIn` gates the front door.
 */
async function load({ today, signedIn = true }: { today: string; signedIn?: boolean }) {
  if (signedIn) {
    window.localStorage.setItem('tripPlannerToken', 'Powan');
    window.localStorage.setItem('tripPlannerUserName', 'Powan');
  }
  window.sessionStorage.setItem(TODAY_KEY, today);
  vi.resetModules();
  const autocount = await import('@/lib/visit-autocount');
  const visited = await import('@/core/places/visited');
  return {
    runVisitAutocount: autocount.runVisitAutocount,
    matchPlace: autocount.matchPlace,
    tripPlacesThrough: autocount.tripPlacesThrough,
    allTripPlaces: autocount.allTripPlaces,
    CITY_MATCH_KM: autocount.CITY_MATCH_KM,
    getVisited: visited.getVisited,
    getVisitConfirmations: visited.getVisitConfirmations,
  };
}

/** Install a fake `navigator.geolocation`, or remove it entirely with `undefined`. */
function setGeolocation(value: unknown): void {
  Object.defineProperty(window.navigator, 'geolocation', {
    value,
    configurable: true,
    writable: true,
  });
}

/** The real `getCurrentPosition` parameter list, so a fake can be inspected for its options. */
type GetPositionArgs = Parameters<Geolocation['getCurrentPosition']>;

/** A `getCurrentPosition` that hands back a fix at `coords`, synchronously. */
function grants(coords: { latitude: number; longitude: number }) {
  return vi.fn((...args: GetPositionArgs) => {
    args[0]({ coords, timestamp: Date.now() } as unknown as GeolocationPosition);
  });
}

/** A `getCurrentPosition` that fails with a `GeolocationPositionError` code (1/2/3). */
function refuses(code: number) {
  return vi.fn((...args: GetPositionArgs) => {
    args[1]?.({ code, message: 'nope' } as unknown as GeolocationPositionError);
  });
}

/** Today (UTC), derived exactly as the PRE-D-342 placeholder trip config derived its own span. */
function realTodayUtc(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
}

/** Everything currently on disk, keys and values, as one string — for the privacy sweep. */
function dumpStorage(): string {
  const parts: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i) as string;
    parts.push(key, window.localStorage.getItem(key) ?? '');
  }
  return parts.join('\n');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setGeolocation(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. Day-arrival counting ──────────────────────────────────────────────────────────────────────
describe('day-arrival counting — the itinerary credits a city once its day has arrived', () => {
  it('credits nothing before the trip starts', async () => {
    const { tripPlacesThrough } = await load({ today: '2026-11-01' });
    expect(tripPlacesThrough('2026-11-01')).toEqual([]);
  });

  it('credits day one only on day one, with the AUTHORED departure label, not the leg label', async () => {
    const { tripPlacesThrough } = await load({ today: '2026-12-09' });
    // Dec 9 is a 'nepal'-LEG day spent at JFK (D-315). The raw leg label would write "New York /
    // Nepal" into a permanent record; `countryLabelForDate` gives the authored 'USA'.
    expect(tripPlacesThrough('2026-12-09')).toEqual([{ city: 'New York', country: 'USA' }]);
  });

  it('is a PREFIX of the trip, in first-appearance order, deduped', async () => {
    const { tripPlacesThrough } = await load({ today: '2026-12-16' });
    expect(tripPlacesThrough('2026-12-16')).toEqual([
      { city: 'New York', country: 'USA' },
      { city: 'Kathmandu', country: 'Nepal' }, // Dec 10 and Dec 12 — recorded once
      { city: 'Kirtipur', country: 'Nepal' }, // Dec 11, new with the Nepal rebuild
      { city: 'Lalitpur', country: 'Nepal' },
      { city: 'Nagarkot', country: 'Nepal' },
      { city: 'Chitlang', country: 'Nepal' }, // Dec 15, new with the Nepal rebuild
      { city: 'Bhaktapur', country: 'Nepal' },
    ]);
    // Tomorrow's cities are NOT credited today.
    expect(tripPlacesThrough('2026-12-16').map((p) => p.city)).not.toContain('Osaka');
  });

  it('a day that has not arrived is never credited, and the last day credits the whole trip', async () => {
    const { tripPlacesThrough, allTripPlaces } = await load({ today: '2027-01-09' });
    expect(allTripPlaces().map((p) => p.city)).toEqual([
      'New York',
      'Kathmandu',
      'Kirtipur',
      'Lalitpur',
      'Nagarkot',
      'Chitlang',
      'Bhaktapur',
      'Osaka',
      'Kyoto',
      'Tokyo',
    ]);
    expect(tripPlacesThrough('2026-12-18').map((p) => p.city)).not.toContain('Tokyo');
    expect(tripPlacesThrough('2027-06-01')).toEqual(allTripPlaces()); // after the trip: all of it
  });

  it('runs the count into the lifetime set, and BACKFILLS every day the app was closed for', async () => {
    // This device has never been opened during the trip and is opened for the first time on Dec 20.
    const { runVisitAutocount, getVisited } = await load({ today: '2026-12-20' });
    runVisitAutocount();
    expect(getVisited().cities).toEqual([
      'New York',
      'Kathmandu',
      'Kirtipur',
      'Lalitpur',
      'Nagarkot',
      'Chitlang',
      'Bhaktapur',
      'Osaka',
    ]);
    expect(getVisited().countries).toEqual(['USA', 'Nepal', 'Japan']);
  });

  it('is idempotent — running it again the same day changes nothing', async () => {
    const { runVisitAutocount, getVisited } = await load({ today: '2026-12-20' });
    runVisitAutocount();
    const first = getVisited();
    runVisitAutocount();
    runVisitAutocount();
    expect(getVisited()).toEqual(first);
  });

  it('writes NOTHING AT ALL before the trip — no keys, so no route gains a key on load', async () => {
    // Load-bearing beyond tidiness: `e2e/map-trip-mode.spec.ts` asserts that opening /map adds no
    // storage key, and CI runs at whatever date it runs at.
    const { runVisitAutocount } = await load({ today: '2026-11-01' });
    runVisitAutocount();
    expect(window.localStorage.getItem(VISITS_KEY)).toBeNull();
    expect(window.localStorage.getItem(CONFIRM_KEY)).toBeNull();
  });

  it('writes nothing for a visitor who has not signed in, and never asks them for a location', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    setGeolocation({ getCurrentPosition });
    const { runVisitAutocount } = await load({ today: '2026-12-20', signedIn: false });
    runVisitAutocount();
    expect(window.localStorage.getItem(VISITS_KEY)).toBeNull();
    expect(window.localStorage.getItem(CONFIRM_KEY)).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

// ── 2. The confirmation matcher ──────────────────────────────────────────────────────────────────
describe('the confirmation matcher — offline, nearest-wins, bounded', () => {
  it('resolves an exact trip-city coordinate to that city', async () => {
    const { matchPlace } = await load({ today: '2026-12-12' });
    expect(matchPlace(27.7172, 85.324)).toEqual({ city: 'Kathmandu', country: 'Nepal' });
  });

  it('resolves a fix a few km out to the same city', async () => {
    const { matchPlace } = await load({ today: '2026-12-12' });
    expect(matchPlace(27.7402, 85.3401)?.city).toBe('Kathmandu'); // ~3 km NE
  });

  it('NEAREST wins between two cities that are close together', async () => {
    const { matchPlace } = await load({ today: '2026-12-13' });
    // Kathmandu 27.7172 and Lalitpur 27.6667 share a longitude and are ~5.6 km apart.
    expect(matchPlace(27.667, 85.324)?.city).toBe('Lalitpur');
    expect(matchPlace(27.7172, 85.324)?.city).toBe('Kathmandu');
  });

  it('matches against the WHOLE trip, not only the days that have arrived', async () => {
    // Mid-Nepal by the plan, physically in Kyoto: the traveller gets Kyoto, not the planned city.
    const { matchPlace } = await load({ today: '2026-12-12' });
    expect(matchPlace(35.0116, 135.7681)).toEqual({ city: 'Kyoto', country: 'Japan' });
  });

  it('returns null when nothing is within range — no nearest-anything fallback', async () => {
    const { matchPlace } = await load({ today: '2026-12-20' });
    expect(matchPlace(51.5072, -0.1276)).toBeNull(); // London
    expect(matchPlace(0, 0)).toBeNull(); // Null Island
    expect(matchPlace(-33.8688, 151.2093)).toBeNull(); // Sydney
  });

  it('honours CITY_MATCH_KM at the boundary — in range matches, out of range does not', async () => {
    const { matchPlace, CITY_MATCH_KM } = await load({ today: '2026-12-20' });
    expect(CITY_MATCH_KM).toBe(75);
    // Due north of Kathmandu: 1 degree of latitude is ~111.19 km on this haversine.
    expect(matchPlace(27.7172 + 0.5, 85.324)?.city).toBe('Kathmandu'); // ~55.6 km — in
    expect(matchPlace(27.7172 + 0.8, 85.324)).toBeNull(); // ~89 km — out
  });

  it('skips a candidate the coordinate table does not know, rather than guessing', async () => {
    const { matchPlace } = await load({ today: '2026-12-20' });
    const madeUp = [{ city: 'Shangri-La', country: 'Nowhere' }];
    expect(matchPlace(27.7172, 85.324, madeUp)).toBeNull();
    expect(matchPlace(27.7172, 85.324, [...madeUp, { city: 'Kathmandu', country: 'Nepal' }])).toEqual({
      city: 'Kathmandu',
      country: 'Nepal',
    });
  });

  it('is total on a garbage fix and on an empty candidate set', async () => {
    const { matchPlace } = await load({ today: '2026-12-20' });
    expect(matchPlace(NaN, 85.324)).toBeNull();
    expect(matchPlace(27.7172, Infinity)).toBeNull();
    expect(matchPlace(27.7172, 85.324, [])).toBeNull();
  });
});

// ── 3. The one-shot check: what it stores, and what it must never store ──────────────────────────
describe('the one-shot location check — what reaches disk', () => {
  it('a granted fix records the PLACE and the TIME, and marks the day', async () => {
    setGeolocation({ getCurrentPosition: grants({ latitude: 34.6937, longitude: 135.5023 }) });
    const { runVisitAutocount, getVisitConfirmations, getVisited } = await load({ today: '2026-12-20' });

    runVisitAutocount();

    const log = getVisitConfirmations();
    expect(log.checkedOn).toBe('2026-12-20');
    expect(log.confirmed).toHaveLength(1);
    expect(log.confirmed[0].city).toBe('Osaka');
    expect(log.confirmed[0].country).toBe('Japan');
    expect(Number.isNaN(Date.parse(log.confirmed[0].at))).toBe(false); // a real ISO instant
    expect(getVisited().cities).toContain('Osaka');
  });

  it('NEVER writes a coordinate — the fix is matched in memory and thrown away', async () => {
    // Distinctive decimals so a leak anywhere in storage is unmistakable. Kathmandu, give or take.
    const latitude = 27.71234567;
    const longitude = 85.32456789;
    setGeolocation({ getCurrentPosition: grants({ latitude, longitude }) });
    const { runVisitAutocount, getVisitConfirmations } = await load({ today: '2026-12-12' });

    runVisitAutocount();

    const dump = dumpStorage();
    expect(dump).toContain('Kathmandu'); // the run really did confirm something
    expect(dump).not.toContain(String(latitude));
    expect(dump).not.toContain(String(longitude));
    expect(dump).not.toContain('27.712');
    expect(dump).not.toContain('85.324');
    expect(dump).not.toMatch(/latitude|longitude|"lat"|"lng"|coords|accuracy|altitude|heading|speed/i);
    // And the stored record has nowhere to put one: exactly three fields.
    expect(Object.keys(getVisitConfirmations().confirmed[0]).sort()).toEqual(['at', 'city', 'country']);
  });

  it('a fix that matches no trip city records nothing, and the planned count still stands', async () => {
    setGeolocation({ getCurrentPosition: grants({ latitude: 51.5072, longitude: -0.1276 }) });
    const { runVisitAutocount, getVisitConfirmations, getVisited } = await load({ today: '2026-12-20' });

    runVisitAutocount();

    expect(getVisitConfirmations().confirmed).toEqual([]);
    expect(getVisitConfirmations().checkedOn).toBe('2026-12-20'); // asked, and answered nothing useful
    expect(getVisited().cities).toContain('Osaka'); // the itinerary's word still counts
    expect(dumpStorage()).not.toContain('51.507');
  });

  it('confirming is idempotent per city — a second confirmation keeps the FIRST timestamp', async () => {
    setGeolocation({ getCurrentPosition: grants({ latitude: 34.6937, longitude: 135.5023 }) });
    const { runVisitAutocount, getVisitConfirmations } = await load({ today: '2026-12-20' });
    runVisitAutocount();
    const first = getVisitConfirmations().confirmed[0].at;

    // A later day, same city: moving the clock forward one day re-arms the check.
    const next = await load({ today: '2026-12-21' });
    next.runVisitAutocount();

    const log = next.getVisitConfirmations();
    expect(log.confirmed).toHaveLength(1);
    expect(log.confirmed[0].at).toBe(first);
    expect(log.checkedOn).toBe('2026-12-21');
  });
});

// ── 4. Every failure is a non-event ──────────────────────────────────────────────────────────────
describe('permission denied, unavailable and timed out are all NON-EVENTS', () => {
  // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3.
  for (const [code, label] of [
    [1, 'PERMISSION_DENIED'],
    [2, 'POSITION_UNAVAILABLE'],
    [3, 'TIMEOUT'],
  ] as const) {
    it(`${label}: the planned count stands, nothing is confirmed, nothing throws`, async () => {
      setGeolocation({ getCurrentPosition: refuses(code) });
      const { runVisitAutocount, getVisited, getVisitConfirmations } = await load({
        today: '2026-12-20',
      });

      expect(() => runVisitAutocount()).not.toThrow();

      expect(getVisited().cities).toContain('Osaka'); // the whole app still works
      expect(getVisited().countries).toEqual(['USA', 'Nepal', 'Japan']);
      expect(getVisitConfirmations().confirmed).toEqual([]);
    });
  }

  it('a refusal still MARKS the day, so it costs one prompt — not one per page load', async () => {
    const getCurrentPosition = refuses(1);
    setGeolocation({ getCurrentPosition });
    const { runVisitAutocount, getVisitConfirmations } = await load({ today: '2026-12-20' });

    runVisitAutocount();
    expect(getVisitConfirmations().checkedOn).toBe('2026-12-20');

    runVisitAutocount();
    runVisitAutocount();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1); // asked once, on this day, full stop
  });

  it('a browser with no geolocation at all is a non-event, and is not marked as asked', async () => {
    setGeolocation(undefined);
    const { runVisitAutocount, getVisited, getVisitConfirmations } = await load({ today: '2026-12-20' });

    expect(() => runVisitAutocount()).not.toThrow();

    expect(getVisited().cities).toContain('Osaka');
    // Nothing was asked, so nothing is marked — a browser that gains support tomorrow is not
    // locked out by a marker written for a check that never happened.
    expect(getVisitConfirmations().checkedOn).toBeNull();
    expect(window.localStorage.getItem(CONFIRM_KEY)).toBeNull();
  });

  it('a getCurrentPosition that throws outright cannot take the page down with it', async () => {
    setGeolocation({
      getCurrentPosition: () => {
        throw new Error('hostile shim');
      },
    });
    const { runVisitAutocount, getVisited } = await load({ today: '2026-12-20' });

    expect(() => runVisitAutocount()).not.toThrow();
    expect(getVisited().cities).toContain('Osaka');
  });
});

// ── 5. One shot, on day change only ──────────────────────────────────────────────────────────────
describe('one shot, on DAY CHANGE only', () => {
  it('asks once per page load at most, and not at all on the second load of the same day', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    setGeolocation({ getCurrentPosition });
    const first = await load({ today: '2026-12-12' });
    first.runVisitAutocount();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    const second = await load({ today: '2026-12-12' }); // a fresh page load, same day
    second.runVisitAutocount();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('asks again once the day changes', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    setGeolocation({ getCurrentPosition });
    const day4 = await load({ today: '2026-12-12' });
    day4.runVisitAutocount();

    const day5 = await load({ today: '2026-12-13' });
    day5.runVisitAutocount();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(day5.getVisitConfirmations().checkedOn).toBe('2026-12-13');
  });

  it('never asks OFF-TRIP — someone who never travels is never prompted', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    setGeolocation({ getCurrentPosition });

    const before = await load({ today: '2026-11-01' });
    before.runVisitAutocount();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    const after = await load({ today: '2027-03-01' });
    after.runVisitAutocount();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // ...and the trip still counted itself in full on the way past.
    expect(after.getVisited().cities).toContain('Tokyo');
  });

  it('a config-less joined trip is never IN PROGRESS — nothing counted, no prompt (D-342)', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    setGeolocation({ getCurrentPosition });

    // The joiner's NORMAL state (SB-6 / A-2): a registered TripMeta with no config block, so the
    // active pack resolves to `placeholderTripConfig` — one day, at a fixed unreachable sentinel.
    const { joinTrip } = await import('@/core/trips/registry');
    joinTrip('joined-no-config');

    // The clock is the REAL current UTC day, uniquely in this file, and that is the point: it is
    // the one reading that catches a placeholder span moved back onto "today" (the pre-D-342 code
    // asked for a location every day of the year, and stamped 'Somewhere' into the LIFETIME
    // record). Still deterministic — with a fixed far-future span, no real date is ever a trip day.
    const today = realTodayUtc();
    const { runVisitAutocount, getVisited, getVisitConfirmations } = await load({ today });

    runVisitAutocount();

    // Nothing reached key 32, which survives sign-out and wipeAllTripData() (D-314).
    expect(getVisited().cities).toEqual([]);
    expect(window.localStorage.getItem(VISITS_KEY)).toBeNull();
    // `getTodayInTrip()` is null, so the one-shot check hard-stops BEFORE markVisitCheck.
    expect(getVisitConfirmations().checkedOn).not.toBe(today);
    expect(getVisitConfirmations().checkedOn).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('uses a one-shot getCurrentPosition and never a position stream', async () => {
    const getCurrentPosition = grants(KATHMANDU);
    const watchPosition = vi.fn();
    setGeolocation({ getCurrentPosition, watchPosition, clearWatch: vi.fn() });
    const { runVisitAutocount } = await load({ today: '2026-12-12' });

    runVisitAutocount();

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition).not.toHaveBeenCalled();
    // Coarse and bounded, deliberately: a city-level answer needs no GPS fix and no long wait.
    const options = getCurrentPosition.mock.calls[0][2];
    expect(options?.enableHighAccuracy).toBe(false);
    expect(typeof options?.timeout).toBe('number');
  });
});

// ── 6. The confirmation store survives the trip teardown, like the visits it confirms ────────────
describe('the confirmation record is lifetime-scoped, like key 32 (D-314, D-320)', () => {
  it('survives the REAL wipeAllTripData()', async () => {
    setGeolocation({ getCurrentPosition: grants(KATHMANDU) });
    const { runVisitAutocount, getVisitConfirmations, getVisited } = await load({ today: '2026-12-12' });
    runVisitAutocount();
    expect(getVisitConfirmations().confirmed).toHaveLength(1);

    const { wipeAllTripData, TRIP_SCOPED_SLOTS, STORAGE_KEYS } = await import('@/core/storage/gateway');
    // Seed the trip namespace so the wipe cannot pass this vacuously.
    for (const slot of TRIP_SCOPED_SLOTS) window.localStorage.setItem(STORAGE_KEYS[slot], 'x');
    wipeAllTripData();
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(window.localStorage.getItem(STORAGE_KEYS[slot])).toBeNull();
    }

    expect(getVisitConfirmations().confirmed[0].city).toBe('Kathmandu');
    expect(getVisited().cities).toContain('Kathmandu');
    expect((TRIP_SCOPED_SLOTS as readonly string[]).includes('visitConfirmations')).toBe(false);
    expect(STORAGE_KEYS.visitConfirmations).toBe(CONFIRM_KEY);
  });

  it('a corrupt or wrong-shaped slot reads as empty and never throws', async () => {
    const { getVisitConfirmations } = await load({ today: '2026-12-12' });
    window.localStorage.setItem(CONFIRM_KEY, '{not json');
    expect(getVisitConfirmations()).toEqual({ checkedOn: null, confirmed: [] });
    window.localStorage.setItem(CONFIRM_KEY, '"a string"');
    expect(getVisitConfirmations()).toEqual({ checkedOn: null, confirmed: [] });
    window.localStorage.setItem(CONFIRM_KEY, '{"checkedOn":7,"confirmed":"Kathmandu"}');
    expect(getVisitConfirmations()).toEqual({ checkedOn: null, confirmed: [] });
  });

  it('sanitizes on read: half-built entries are dropped whole, duplicates collapse', async () => {
    const { getVisitConfirmations } = await load({ today: '2026-12-12' });
    window.localStorage.setItem(
      CONFIRM_KEY,
      JSON.stringify({
        checkedOn: '2026-12-12',
        confirmed: [
          { city: 'Kathmandu', country: 'Nepal', at: '2026-12-12T04:00:00.000Z' },
          { city: 'Osaka', at: '2026-12-19T04:00:00.000Z' }, // no country — legal, kept
          { city: 'Kyoto', country: 'Japan' }, // no instant — dropped
          { country: 'Japan', at: '2026-12-27T04:00:00.000Z' }, // no place — dropped
          { city: ' kathmandu ', country: 'Nepal', at: '2027-01-01T04:00:00.000Z' }, // duplicate
          'not an object',
        ],
      }),
    );
    expect(getVisitConfirmations()).toEqual({
      checkedOn: '2026-12-12',
      confirmed: [
        { city: 'Kathmandu', country: 'Nepal', at: '2026-12-12T04:00:00.000Z' },
        { city: 'Osaka', country: '', at: '2026-12-19T04:00:00.000Z' },
      ],
    });
  });

  it('SSR-safe: with no window the read is empty and the writes are inert, none throw', async () => {
    const { getVisitConfirmations } = await load({ today: '2026-12-12' });
    const { markVisitCheck, confirmVisit } = await import('@/core/places/visited');
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(getVisitConfirmations()).toEqual({ checkedOn: null, confirmed: [] });
      expect(() => markVisitCheck('2026-12-12')).not.toThrow();
      expect(() => confirmVisit({ city: 'Kathmandu', country: 'Nepal' }, 'now')).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });
});
