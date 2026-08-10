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

  it('saveExpenses SANITIZES on write — a malformed entry never reaches disk', () => {
    saveExpenses([
      { id: 'ok', leg: 'nepal', category: 'food', amount: 1000, createdAt: 't' },
      { id: 'bad', leg: 'atlantis', category: 'food', amount: 1 } as unknown as Expense, // dropped
      { leg: 'japan', category: 'hotel', amount: 5000, createdAt: 't' } as unknown as Expense, // no id, dropped
    ]);
    const back = loadExpenses();
    expect(back.map((e) => e.id)).toEqual(['ok']);
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
