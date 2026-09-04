// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeTripConfig,
  setTripConfig,
  getKnownTrip,
  getActiveTripCityCoord,
  joinTrip,
  upsertKnownTrip,
  TRIP_DAYS_MAX,
  type TripConfigBlock,
} from '@/core/trips/registry';
import { customTripConfig, buildDayShells, VIBES, vibeFor, DEFAULT_VIBE } from '@/core/trips/custom';
import { getTripConfig, isDefaultTrip, TRIP_PACKS, DEFAULT_TRIP_ID } from '@/core/trips';
import { NEPAL_JAPAN_2026 } from '@/core/trips/packs/nepal-japan-2026';
import { setActiveTripId } from '@/core/storage/gateway';
// Static import = loaded at file-eval with an EMPTY store ⇒ the DEFAULT pack (parity baseline).
import { LEGS, DEFAULT_BUDGET, legCurrency } from '@/core/budget/model';

/**
 * S250 — the custom-trip config foundation. Proves, on a real run:
 *  - sanitizeTripConfig accepts a good block + drops every malformed shape (entry-kept policy);
 *  - customTripConfig synthesizes the single-leg TripConfig (Plan D2);
 *  - buildDayShells produces one empty DayPlan per date in range (Plan D4);
 *  - getTripConfig resolves pack → custom → default (Plan D2), default path byte-identical;
 *  - the budget LEGS/DEFAULT_BUDGET/legCurrency derive from the active pack (default parity + custom).
 */

const GOOD: TripConfigBlock = {
  start: '2027-03-01',
  end: '2027-03-05',
  destinations: ['Bali', 'Lombok'],
  vibe: 'beach',
  currency: 'USD',
  updatedAt: 1000,
};

describe('sanitizeTripConfig — validate + drop malformed (Plan D1)', () => {
  it('accepts a well-formed block and trims/keeps its fields', () => {
    expect(sanitizeTripConfig({ ...GOOD, destinations: [' Bali ', 'Lombok'] })).toEqual({
      ...GOOD,
      destinations: ['Bali', 'Lombok'],
    });
  });

  it('defaults a missing/bad updatedAt to 0 and drops an empty currency', () => {
    const { currency, updatedAt, ...rest } = GOOD;
    void currency;
    void updatedAt;
    expect(sanitizeTripConfig({ ...rest, updatedAt: 'nope', currency: '' })).toEqual({
      ...rest,
      updatedAt: 0,
    });
  });

  it('returns undefined for every malformed shape', () => {
    expect(sanitizeTripConfig(null)).toBeUndefined();
    expect(sanitizeTripConfig('x')).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, start: 'not-a-date' })).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, end: '2027-02-01' })).toBeUndefined(); // end < start
    expect(sanitizeTripConfig({ ...GOOD, destinations: [] })).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, destinations: [''] })).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, vibe: '   ' })).toBeUndefined();
  });

  // The regex checks SHAPE, not that the digits denote a real day. `2026-13-45` passed it, then
  // `new Date('2026-13-45T00:00:00')` was Invalid Date, so `TRIP_DATES`' loop never ran and the
  // array was `[]` — the exact state ~15 unguarded `TRIP_DATES[0]` readers crash on
  // (`core/trips/custom.ts`'s PLACEHOLDER_DATE comment names it "a fresh crash of the class SB-6
  // fixed"). Reachable from a peer's trip-meta doc, the synced list, or edited storage.
  it('rejects an ISO-SHAPED date that is not a real day (2026-13-45 → empty TRIP_DATES)', () => {
    expect(sanitizeTripConfig({ ...GOOD, start: '2026-13-45', end: '2026-13-46' })).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-02-30', end: '2027-03-05' })).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, end: '2027-04-31' })).toBeUndefined(); // April has 30 days
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-02-29', end: '2027-03-05' })).toBeUndefined(); // 2027 is not a leap year
    // …and a real leap day still passes — the check is "is this a day", not "does it look odd".
    expect(sanitizeTripConfig({ ...GOOD, start: '2028-02-29', end: '2028-03-05' })).toMatchObject({
      start: '2028-02-29',
    });
  });

  // One wrong digit in the year yielded 65,744 trip dates, ~4.3 MB of day shells, and ONE
  // FIRESTORE DOCUMENT PER DAY on a free tier. The cap is inclusive and shared with the create form.
  it(`rejects a span over TRIP_DAYS_MAX (${TRIP_DAYS_MAX}) days, accepts exactly that many`, () => {
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-01-05', end: '2207-01-05' })).toBeUndefined();
    // 2027-01-01 + (TRIP_DAYS_MAX - 1) days is the last accepted end date; one more is refused.
    const atCap = new Date(Date.UTC(2027, 0, 1) + (TRIP_DAYS_MAX - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const overCap = new Date(Date.UTC(2027, 0, 1) + TRIP_DAYS_MAX * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-01-01', end: atCap })).toMatchObject({
      start: '2027-01-01',
      end: atCap,
    });
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-01-01', end: overCap })).toBeUndefined();
  });

  it('a single-day span is still fine (start === end)', () => {
    expect(sanitizeTripConfig({ ...GOOD, start: '2027-03-01', end: '2027-03-01' })).toMatchObject({
      start: '2027-03-01',
      end: '2027-03-01',
    });
  });
});

// #250 — a custom trip's city has no coordinates in `lib/city-coords.ts`'s 14-row table, so it
// gets a permanent, silent "weather unavailable". `cityCoords` is the one-shot geocode cache that
// lives on the trip's OWN record instead — additive, so a re-sanitize pass (every one of the four
// config sources funnels through this gate) must never strip it back out.
describe('sanitizeTripConfig — cityCoords (#250)', () => {
  const WITH_COORDS: TripConfigBlock = {
    ...GOOD,
    cityCoords: { Bali: { latitude: -8.34, longitude: 115.09 } },
  };

  it('accepts a well-formed cityCoords map and keeps it', () => {
    expect(sanitizeTripConfig(WITH_COORDS)).toEqual(WITH_COORDS);
  });

  it('survives a RE-SANITIZE pass unchanged (the trust-boundary invariant every source relies on)', () => {
    const once = sanitizeTripConfig(WITH_COORDS);
    const twice = sanitizeTripConfig(once);
    expect(twice).toEqual(WITH_COORDS);
  });

  it('drops an out-of-range or non-numeric coordinate but keeps the rest of the config', () => {
    const bad = sanitizeTripConfig({
      ...GOOD,
      cityCoords: {
        Bali: { latitude: 999, longitude: 115.09 }, // out of range
        Lombok: { latitude: 'nope', longitude: 116 }, // not a number
      },
    });
    expect(bad).toBeDefined();
    expect(bad!.cityCoords).toBeUndefined(); // nothing survived → no bare {}
  });

  // The bounds arithmetic here matches `ranged` (core/vault/item-schema.ts), but the rule does
  // not: `ranged` blanks one optional field and keeps its row. A CityCoord has no optional half,
  // so a bad number takes the whole city with it. This case is what goes red if the two are ever
  // merged into one helper.
  it('a bad coordinate drops its CITY whole — never a half-pair — and spares the good ones', () => {
    const out = sanitizeTripConfig({
      ...GOOD,
      cityCoords: {
        Bali: { latitude: -8.34, longitude: 115.09 },
        Lombok: { latitude: -8.65, longitude: 500 }, // longitude out of range
        Gili: { latitude: Infinity, longitude: 116.03 }, // non-finite latitude
      },
    })!.cityCoords;

    expect(out).toEqual({ Bali: { latitude: -8.34, longitude: 115.09 } });
    expect(Object.keys(out!)).toEqual(['Bali']); // the bad cities are GONE, not blanked
  });

  it('a malformed cityCoords shape (array/string) is dropped, the rest of the config survives', () => {
    expect(sanitizeTripConfig({ ...GOOD, cityCoords: ['not', 'a', 'map'] })!.cityCoords).toBeUndefined();
    expect(sanitizeTripConfig({ ...GOOD, cityCoords: 'nope' })!.cityCoords).toBeUndefined();
  });

  it('absent cityCoords stays absent — old configs serialize with no new field', () => {
    expect(sanitizeTripConfig(GOOD)!.cityCoords).toBeUndefined();
  });
});

describe('getActiveTripCityCoord (#250)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('returns the active trip\'s resolved coordinate for a known destination', () => {
    setTripConfig('bali-trip', {
      ...GOOD,
      cityCoords: { Bali: { latitude: -8.34, longitude: 115.09 } },
    });
    setActiveTripId('bali-trip');
    expect(getActiveTripCityCoord('Bali')).toEqual({ latitude: -8.34, longitude: 115.09 });
  });

  it('returns undefined for a city the active trip has not resolved yet, or with no config at all', () => {
    setTripConfig('bali-trip', GOOD); // no cityCoords
    setActiveTripId('bali-trip');
    expect(getActiveTripCityCoord('Bali')).toBeUndefined();
    setActiveTripId('never-joined');
    expect(getActiveTripCityCoord('Bali')).toBeUndefined();
  });
});

// The two halves of the same defect, joined: a config the validator now refuses is DROPPED (the
// entry is kept — Plan D1), so the trip resolves to the one-day placeholder instead of a trip whose
// day list is empty (crash) or 65,744 long (4.3 MB + one Firestore doc per day).
describe('a rejected span/date never reaches the day-shell builder', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  for (const [why, block] of [
    ['not a real day', { ...GOOD, start: '2026-13-45', end: '2026-13-46' }],
    ['span over the cap', { ...GOOD, start: '2027-01-05', end: '2207-01-05' }],
  ] as const) {
    it(`${why}: the config is dropped, the entry survives, TRIP_DATES-equivalent stays length 1`, () => {
      upsertKnownTrip('bad-cfg', 'Bad Config');
      setTripConfig('bad-cfg', block as TripConfigBlock);
      expect(getKnownTrip('bad-cfg')).toBeDefined(); // entry kept
      expect(getKnownTrip('bad-cfg')?.config).toBeUndefined(); // config dropped
      const shells = buildDayShells(getTripConfig('bad-cfg'));
      expect(shells).toHaveLength(1); // the placeholder — never 0, never 65,744
    });
  }
});

describe('customTripConfig — single-leg synthesis (Plan D2)', () => {
  it('synthesizes a single main leg, joined countryLabel, USD default, empty contentRef', () => {
    const cfg = customTripConfig({ id: 'custom-1', name: 'My Trip', joinedAt: 1, config: GOOD });
    expect(cfg).not.toBeNull();
    expect(cfg!.id).toBe('custom-1');
    expect(cfg!.label).toBe('My Trip');
    expect(cfg!.start).toBe('2027-03-01');
    expect(cfg!.end).toBe('2027-03-05');
    expect(cfg!.contentRef).toBe('empty');
    expect(cfg!.legs).toHaveLength(1);
    expect(cfg!.legs[0]).toMatchObject({
      id: 'main',
      countryLabel: 'Bali × Lombok',
      currency: 'USD',
      utcOffsetMin: 0,
      fallbackCity: 'Bali',
    });
  });

  it('defaults the currency to USD when the config omits it', () => {
    const { currency, ...noCur } = GOOD;
    void currency;
    const cfg = customTripConfig({ id: 'c', name: 'C', joinedAt: 1, config: noCur });
    expect(cfg!.legs[0].currency).toBe('USD');
  });

  it('returns null only when the id is not a known trip at all (⇒ caller falls to the default pack)', () => {
    expect(customTripConfig(undefined)).toBeNull();
    expect(customTripConfig(null)).toBeNull();
  });

  // A-2 (SB-6): a REGISTERED trip (join-by-Trip-Token's normal, config-less state) must never
  // fall through null → NEPAL_JAPAN_2026 — that silently handed a stranger's trip the whole
  // Nepal×Japan pack. It now gets a placeholder instead.
  it('a known trip with no config block gets a placeholder, not null', () => {
    const cfg = customTripConfig({ id: 'x', name: 'X', joinedAt: 1 });
    expect(cfg).not.toBeNull();
    expect(cfg!.id).toBe('x');
    expect(cfg!.label).toBe('X');
    expect(cfg!.contentRef).toBe('empty');
    expect(cfg!.legs).toHaveLength(1);
    expect(cfg!.legs[0].id).toBe('main');
    expect(cfg!.legs[0].currency).toBe('USD');
    // Never Kathmandu/Tokyo (A-28 — the downstream visited-city symptom of A-2).
    expect(cfg!.legs[0].fallbackCity).not.toMatch(/Kathmandu|Tokyo|Osaka/);
    expect(cfg!.start).toBe(cfg!.end); // single-day placeholder span
  });

  it('the placeholder is a single day → buildDayShells manufactures ONE shell, not 32', () => {
    const cfg = customTripConfig({ id: 'x', name: 'X', joinedAt: 1 })!;
    const shells = buildDayShells(cfg);
    expect(shells).toHaveLength(1);
    expect(shells[0].country).toBe('main');
    expect(shells[0].items).toEqual([]);
  });
});

describe('buildDayShells — empty itinerary over the span (Plan D4)', () => {
  it('one blank DayPlan per inclusive date, items empty, country = leg id', () => {
    const cfg = customTripConfig({ id: 'c', name: 'C', joinedAt: 1, config: GOOD })!;
    const shells = buildDayShells(cfg);
    expect(shells).toHaveLength(5); // 03-01 .. 03-05 inclusive
    expect(shells[0]).toEqual({ date: '2027-03-01', city: 'Bali', country: 'main', items: [] });
    expect(shells[4].date).toBe('2027-03-05');
    for (const d of shells) {
      expect(d.items).toEqual([]);
      expect(d.country).toBe('main');
    }
  });
});

describe('VIBES — CSS-only presets', () => {
  it('has presets and vibeFor falls back to the default for an unknown key', () => {
    expect(Object.keys(VIBES).length).toBeGreaterThanOrEqual(4);
    expect(vibeFor('beach')).toBe(VIBES.beach);
    expect(vibeFor('does-not-exist')).toBe(VIBES.city);
    expect(vibeFor(undefined)).toBe(VIBES.city);
  });

  // D-307: `VIBES['constructor']` is the `Object` FUNCTION — non-nullish, so `??` never fired and
  // the bare index handed a function back typed as `Vibe`. Home's hero then did
  // `customVibe!.gradient.join(', ')` on it and took the whole route to the error boundary.
  // `sanitizeTripConfig` accepts any non-empty `vibe`, so a peer's trip-meta doc can carry this.
  for (const poison of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    it(`vibeFor('${poison}') returns a real Vibe, never a function (D-307)`, () => {
      const v = vibeFor(poison);
      expect(typeof v).toBe('object');
      expect(v).toBe(VIBES[DEFAULT_VIBE]);
      // The exact dereference hero-section.tsx does on it.
      expect(() => v.gradient.join(', ')).not.toThrow();
      expect(Array.isArray(v.gradient)).toBe(true);
    });
  }
});

describe('getTripConfig — pack → custom → default fallthrough (Plan D2)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('a registered pack id resolves to the pack (default path unchanged, same reference)', () => {
    expect(getTripConfig(DEFAULT_TRIP_ID)).toBe(TRIP_PACKS[DEFAULT_TRIP_ID]);
    expect(TRIP_PACKS[DEFAULT_TRIP_ID]).toBe(NEPAL_JAPAN_2026);
  });

  it('an unknown id with NO stored config falls back to the default pack', () => {
    expect(getTripConfig('ghost')).toBe(NEPAL_JAPAN_2026);
  });

  it('a custom id with a stored config resolves to its synthesized single-leg config', () => {
    setTripConfig('custom-1', GOOD);
    expect(getKnownTrip('custom-1')?.config).toEqual(GOOD);
    const cfg = getTripConfig('custom-1');
    expect(cfg.id).toBe('custom-1');
    expect(cfg.legs).toHaveLength(1);
    expect(cfg.legs[0].id).toBe('main');
    expect(cfg.contentRef).toBe('empty');
  });

  it('isDefaultTrip reflects the active pointer', () => {
    expect(isDefaultTrip()).toBe(true); // unset pointer ⇒ default
    setActiveTripId('custom-1');
    expect(isDefaultTrip()).toBe(false);
  });
});

// A-4 (SB-6, D-307): a prototype-key trip id must resolve TOTAL — never a function, never a
// crash — through `TRIP_PACKS`'s own-key read guard.
describe('getTripConfig — prototype-pollution-shaped ids never leak a function (A-4, D-307)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  for (const poison of ['constructor', '__proto__', 'toString']) {
    it(`getTripConfig('${poison}') never joined ⇒ safe fallback to the default pack, never a function`, () => {
      const cfg = getTripConfig(poison);
      expect(typeof cfg).toBe('object');
      expect(Array.isArray(cfg.legs)).toBe(true);
      expect(cfg.legs.length).toBeGreaterThan(0);
      expect(cfg).toBe(NEPAL_JAPAN_2026); // unregistered id ⇒ same as any other unknown id
    });

    it(`getTripConfig('${poison}') after joinTrip('${poison}') ⇒ the config-less placeholder, never a crash`, () => {
      // The reachable path: pasting the poison string into "Add a trip by Trip Token" (or
      // `?trip=${poison}`) calls joinTrip, which registers it with NO config block — exactly
      // the A-2 config-less state, now on a prototype-key id.
      joinTrip(poison);
      const cfg = getTripConfig(poison);
      // was TRIP_PACKS[poison] === the Object constructor (typeof 'function') pre-fix.
      expect(typeof cfg).not.toBe('function');
      expect(Array.isArray(cfg.legs)).toBe(true);
      expect(cfg.legs[0].id).toBe('main'); // the placeholder, not NEPAL_JAPAN_2026's 'nepal'/'japan'
      // The old bug crashed HERE: `activeTrip.legs.find(...)` at module load
      // (core/dates/trip-dates.ts:33) on a `.legs === undefined` config. Prove it no longer throws.
      expect(() => cfg.legs.find((l) => l.id === 'nepal')).not.toThrow();
    });
  }
});

// A-2 root-cause proof: the seed branch `reconcileFirstSnapshot` (lib/itinerary-remote.ts) pushes
// to Firestore is `loadPlans()`'s vault fallback, `buildDayShells(getActiveTrip())` — this proves
// that fallback shrinks from the default pack's 32 Nepal/Japan shells to the placeholder's 1,
// without needing a Firestore fake (buildDayShells/getTripConfig are pure; itinerary-remote.ts is
// untouched by this slice).
describe('A-2 — a config-less joiner writes ~0 day docs, not the whole Nepal×Japan pack', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('config-less join: the itinerary Vault fallback is 1 shell (was 32 Nepal/Japan shells pre-fix)', () => {
    joinTrip('joined-no-config');
    const cfg = getTripConfig('joined-no-config');
    expect(cfg).not.toBe(NEPAL_JAPAN_2026); // the actual pre-fix defect
    const shells = buildDayShells(cfg);
    expect(shells).toHaveLength(1); // reconcileFirstSnapshot's seed branch pushes exactly this
    expect(shells[0].country).toBe('main');
    expect(shells[0].city).not.toMatch(/Kathmandu|Osaka|Tokyo/); // A-28 closed as a side effect
  });

  it('a config-less join never resolves to a 2-leg (nepal/japan) config', () => {
    upsertKnownTrip('joined-2', 'Some Trip');
    const cfg = getTripConfig('joined-2');
    expect(cfg.legs.map((l) => l.id)).toEqual(['main']);
  });
});

describe('budget LEGS derivation — default parity + custom pack (Plan D3)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('DEFAULT pack: LEGS/legCurrency/DEFAULT_BUDGET are byte-identical to the legacy hardcodes', () => {
    expect(LEGS).toEqual(['nepal', 'japan']);
    expect(legCurrency('nepal')).toBe('NPR');
    expect(legCurrency('japan')).toBe('JPY');
    expect(DEFAULT_BUDGET.legBudgets).toEqual({ nepal: 0, japan: 0 });
  });

  it('CUSTOM pack: budget model re-derives LEGS/legCurrency/DEFAULT_BUDGET from the active trip', async () => {
    setActiveTripId('custom-1');
    setTripConfig('custom-1', GOOD);
    vi.resetModules(); // force a fresh module graph that resolves the active (custom) pack at load
    const model = await import('@/core/budget/model');
    expect(model.LEGS).toEqual(['main']);
    expect(model.legCurrency('main')).toBe('USD');
    expect(model.DEFAULT_BUDGET.legBudgets).toEqual({ main: 0 });
  });
});
