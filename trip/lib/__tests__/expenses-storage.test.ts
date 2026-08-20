// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S102 — expense persistence round-trip through the typed storage gateway (key 11, D-097) + the
 * `core/budget/storage.ts` load/save adapter. Proves: empty list when absent, set→get, corrupt
 * slot → [] (never throws), sanitize-on-write drops malformed entries, the on-disk key string is
 * pinned + additive (no migration, distinct from the itinerary Vault + the budget key), and SSR /
 * quota safety inherited from the gateway. Mirrors budget-storage.test.ts.
 */

import { STORAGE_KEYS, expensesStore } from '@/core/storage/gateway';
import { loadExpenses, saveExpenses } from '@/core/budget/storage';
import type { Expense } from '@/core/budget/expenses';

const KEY = 'nepal_japan_expenses';

function sample(): Expense[] {
  return [
    { id: 'a', leg: 'nepal', category: 'food', amount: 1200, createdAt: '2026-12-10T09:00:00.000Z', note: 'Momos' },
    { id: 'b', leg: 'japan', category: 'hotel', amount: 8000, createdAt: '2026-12-20T18:00:00.000Z' },
  ];
}

describe('expense storage (gateway key 11, D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('the on-disk key string is exactly nepal_japan_expenses (additive, no migration)', () => {
    expect(STORAGE_KEYS.expenses).toBe(KEY);
    // Distinct from the itinerary Vault AND the budget key (each its own domain).
    expect(STORAGE_KEYS.expenses).not.toBe(STORAGE_KEYS.itinerary);
    expect(STORAGE_KEYS.expenses).not.toBe(STORAGE_KEYS.budget);
  });

  it('loadExpenses returns [] when the key is absent (fresh visitor)', () => {
    expect(loadExpenses()).toEqual([]);
  });

  it('saveExpenses → loadExpenses round-trips the list, stored as JSON under the key', () => {
    const list = sample();
    saveExpenses(list);
    expect(loadExpenses()).toEqual(list);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(list);
  });

  it('saveExpenses SANITIZES on write — an UNSALVAGEABLE entry never reaches disk (an unknown leg is not one)', () => {
    saveExpenses([
      { id: 'ok', leg: 'nepal', category: 'food', amount: 1000, createdAt: 't' },
      { id: 'foreign', leg: 'atlantis', category: 'food', amount: 1 } as unknown as Expense, // RETAINED
      { leg: 'japan', category: 'hotel', amount: 5000, createdAt: 't' } as unknown as Expense, // no id, dropped
      { id: 'badcat', leg: 'nepal', category: 'bogus', amount: 1 } as unknown as Expense, // bad category, dropped
    ]);
    const back = loadExpenses();
    // 'foreign' survives: sanitize-on-write is what made a leg mismatch a PERMANENT deletion rather
    // than a hidden row, so the leg check moved out of the sanitizer and into the aggregates.
    expect(back.map((e) => e.id)).toEqual(['ok', 'foreign']);
    expect(back.find((e) => e.id === 'foreign')!.leg).toBe('atlantis');
  });

  it("a row whose leg is unknown to the active pack ('main') round-trips save → load", () => {
    // The exact A-6 shape: a whole-trip backup taken under a single-leg custom pack, restored while
    // the active pack is the default nepal/japan one. Every row's leg is foreign to this build.
    const foreign: Expense[] = [
      { id: 'm1', leg: 'main', category: 'food', amount: 1200, createdAt: '2026-12-10T09:00:00.000Z', note: 'Lunch' },
      { id: 'm2', leg: 'main', category: 'hotel', amount: 8000, createdAt: '2026-12-11T18:00:00.000Z', date: '2026-12-11' },
    ];
    saveExpenses(foreign);
    const back = loadExpenses();
    expect(back).toEqual(foreign); // leg still 'main', every other field intact
    expect(back.map((e) => e.leg)).toEqual(['main', 'main']);
    // And on disk, not just in memory — this is the write-side sanitize that used to erase them.
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual(foreign);
    // Re-saving what was loaded is stable: the old bug emptied the slot on the NEXT commit.
    saveExpenses(back);
    expect(loadExpenses()).toEqual(foreign);
  });

  it('a corrupt (non-JSON) slot → [] , never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadExpenses()).not.toThrow();
    expect(loadExpenses()).toEqual([]);
  });

  it('a slot holding non-array JSON → [] (sanitized)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadExpenses()).toEqual([]);
  });

  it('expensesStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(expensesStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(expensesStore.get<string>('FB')).toBe('FB');
    expensesStore.set([{ a: 1 }]);
    expect(expensesStore.get<Array<{ a: number }>>([])).toEqual([{ a: 1 }]);
  });

  it('SSR-safe: with no window, load returns [] and save is inert (never throws)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(loadExpenses()).toEqual([]);
        saveExpenses(sample()); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when setItem throws (quota / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveExpenses(sample())).not.toThrow();
  });
});
