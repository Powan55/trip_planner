// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S104 — journal persistence round-trip through the typed storage gateway (key 12, D-097) + the
 * `core/journal/storage.ts` load/save adapter. Proves: empty list when absent, set→get, corrupt slot
 * → [] (never throws), sanitize-on-write drops malformed entries + dedupes by date, the on-disk key
 * string is pinned + additive (no migration, distinct from the itinerary Vault + budget + expense
 * keys), and SSR / quota safety inherited from the gateway. Mirrors expenses-storage.test.ts.
 */

import { STORAGE_KEYS, journalStore } from '@/core/storage/gateway';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import type { JournalEntry } from '@/core/journal/model';

const KEY = 'nepal_japan_journal';

function sample(): JournalEntry[] {
  return [
    {
      date: '2026-12-14',
      text: 'Momos in Thamel; the light was perfect at Boudhanath.',
      mood: 'great',
      highlight: 'Sunset over the stupa',
      createdAt: '2026-12-14T18:00:00.000Z',
      updatedAt: '2026-12-14T18:00:00.000Z',
    },
    {
      date: '2026-12-20',
      text: 'First day in Tokyo — Shinjuku at night.',
      createdAt: '2026-12-20T22:00:00.000Z',
      updatedAt: '2026-12-20T22:00:00.000Z',
    },
  ];
}

describe('journal storage (gateway key 12, D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the on-disk key string is exactly nepal_japan_journal (additive, no migration)', () => {
    expect(STORAGE_KEYS.journal).toBe(KEY);
    // Distinct from the itinerary Vault AND the budget + expense keys (each its own domain).
    expect(STORAGE_KEYS.journal).not.toBe(STORAGE_KEYS.itinerary);
    expect(STORAGE_KEYS.journal).not.toBe(STORAGE_KEYS.budget);
    expect(STORAGE_KEYS.journal).not.toBe(STORAGE_KEYS.expenses);
    // No duplicate literals across the whole registry.
    const values = Object.values(STORAGE_KEYS) as string[];
    expect(new Set(values).size).toBe(values.length);
  });

  it('loadJournal returns [] when the key is absent (fresh visitor)', () => {
    expect(loadJournal()).toEqual([]);
  });

  it('saveJournal → loadJournal round-trips the list, stored as JSON under the key', () => {
    const list = sample();
    saveJournal(list);
    expect(loadJournal()).toEqual(list);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(list);
  });

  it('saveJournal SANITIZES on write — a malformed entry never reaches disk', () => {
    saveJournal([
      { date: '2026-12-14', text: 'ok', createdAt: 't', updatedAt: 't' },
      { date: 'bad-date', text: 'x', createdAt: 't', updatedAt: 't' } as unknown as JournalEntry, // dropped
      { date: '2026-12-15', text: '   ', createdAt: 't', updatedAt: 't' } as unknown as JournalEntry, // empty content, dropped
    ]);
    const back = loadJournal();
    expect(back.map((e) => e.date)).toEqual(['2026-12-14']);
  });

  it('sanitize-on-write DEDUPES a duplicate date (last write wins)', () => {
    saveJournal([
      { date: '2026-12-14', text: 'first', createdAt: 't', updatedAt: 't' },
      { date: '2026-12-14', text: 'second', createdAt: 't', updatedAt: 'u' },
    ]);
    const back = loadJournal();
    expect(back).toHaveLength(1);
    expect(back[0].text).toBe('second');
  });

  it('a corrupt (non-JSON) slot → [] , never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadJournal()).not.toThrow();
    expect(loadJournal()).toEqual([]);
  });

  it('a slot holding non-array JSON → [] (sanitized)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadJournal()).toEqual([]);
  });

  it('journalStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(journalStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(journalStore.get<string>('FB')).toBe('FB');
    journalStore.set([{ a: 1 }]);
    expect(journalStore.get<Array<{ a: number }>>([])).toEqual([{ a: 1 }]);
  });

  it('SSR-safe: with no window, load returns [] and save is inert (never throws)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(loadJournal()).toEqual([]);
        saveJournal(sample()); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when setItem throws (quota / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveJournal(sample())).not.toThrow();
  });
});
