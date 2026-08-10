// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeTripConfig,
  setTripConfig,
  getKnownTrip,
  type TripConfigBlock,
} from '@/core/trips/registry';
import { customTripConfig, buildDayShells, VIBES, vibeFor } from '@/core/trips/custom';
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

  it('returns null when the meta carries no config (⇒ caller falls to the default pack)', () => {
    expect(customTripConfig({ id: 'x', name: 'X', joinedAt: 1 })).toBeNull();
    expect(customTripConfig(undefined)).toBeNull();
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
