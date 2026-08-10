// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S101 — budget persistence round-trip through the typed storage gateway (key 10, D-097) +
 * the `core/budget/storage.ts` load/save adapter. Proves: seeded default when absent, set→get,
 * corrupt slot → normalized default (never throws), and SSR / quota safety inherited from the
 * gateway. The on-disk key string is pinned (additive, no migration).
 */

import { STORAGE_KEYS, budgetStore } from '@/core/storage/gateway';
import { loadBudget, saveBudget } from '@/core/budget/storage';
import { DEFAULT_BUDGET, SEED_RATES, type BudgetModel } from '@/core/budget/model';

const KEY = 'nepal_japan_budget';

function sampleModel(): BudgetModel {
  return {
    version: 1,
    homeCurrency: 'JPY',
    rates: { NPR: 140, JPY: 150 },
    legBudgets: { nepal: 13800, japan: 31000 },
    categoryBudgets: { nepal: { food: 2760 } },
  };
}

describe('budget storage (gateway key 10, D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('the on-disk key string is exactly nepal_japan_budget (additive, no migration)', () => {
    expect(STORAGE_KEYS.budget).toBe(KEY);
    // It does NOT collide with the itinerary Vault key (budget is its own domain).
    expect(STORAGE_KEYS.budget).not.toBe(STORAGE_KEYS.itinerary);
  });

  it('loadBudget returns the seeded DEFAULT when the key is absent (fresh visitor)', () => {
    expect(loadBudget()).toEqual(DEFAULT_BUDGET);
    expect(loadBudget().rates).toEqual(SEED_RATES);
  });

  it('saveBudget → loadBudget round-trips the whole model, and stores it as JSON under the key', () => {
    const m = sampleModel();
    saveBudget(m);
    expect(loadBudget()).toEqual(m);
    // On-disk: a JSON string at the exact key.
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(m);
  });

  it('saveBudget NORMALIZES on write (negative amount → 0, missing rate → seed, junk category dropped)', () => {
    saveBudget({
      version: 1,
      homeCurrency: 'USD',
      rates: { NPR: 0 } as unknown as BudgetModel['rates'], // JPY missing / NPR invalid
      legBudgets: { nepal: -50, japan: 31000 },
      categoryBudgets: { japan: { food: 0, hotel: 4000 } },
    } as BudgetModel);
    const back = loadBudget();
    expect(back.rates).toEqual(SEED_RATES); // both seed-defaulted
    expect(back.legBudgets).toEqual({ nepal: 0, japan: 31000 });
    expect(back.categoryBudgets.japan).toEqual({ hotel: 4000 }); // food:0 dropped
  });

  it('a corrupt (non-JSON) slot → the seeded default, never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadBudget()).not.toThrow();
    expect(loadBudget()).toEqual(DEFAULT_BUDGET);
  });

  it('a partially-valid stored object is normalized on read (keeps good, seeds the rest)', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ homeCurrency: 'NPR', legBudgets: { nepal: 20000 } }),
    );
    const back = loadBudget();
    expect(back.homeCurrency).toBe('NPR');
    expect(back.legBudgets).toEqual({ nepal: 20000, japan: 0 });
    expect(back.rates).toEqual(SEED_RATES);
  });

  it('budgetStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(budgetStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(budgetStore.get<string>('FB')).toBe('FB');
    budgetStore.set({ a: 1 });
    expect(budgetStore.get<{ a: number }>({ a: 0 })).toEqual({ a: 1 });
  });

  it('SSR-safe: with no window, load returns the default and save is inert (never throws)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(loadBudget()).toEqual(DEFAULT_BUDGET);
        saveBudget(sampleModel()); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when setItem throws (quota / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveBudget(sampleModel())).not.toThrow();
  });
});
