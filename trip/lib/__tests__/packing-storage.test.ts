// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S206 — packing checklist persistence round-trip through the typed storage gateway (key 21,
 * D-097) + the `core/packing/storage.ts` load/save adapter. Proves: the built-in template on
 * first load (no empty state), set→get, corrupt slot → template (never throws), sanitize-on-write
 * dedupes/drops malformed items, the on-disk key string is pinned + additive, and SSR/quota
 * safety inherited from the gateway. Mirrors journal-storage.test.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_KEYS, packingStore, setActiveTripId } from '@/core/storage/gateway';
import { loadPacking, savePacking } from '@/core/packing/storage';
import { DEFAULT_TEMPLATE, type PackingItem } from '@/core/packing/model';

const KEY = 'nepal_japan_packing';

describe('packing checklist storage (gateway key 21, D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the on-disk key string is exactly nepal_japan_packing (additive, no migration)', () => {
    expect(STORAGE_KEYS.packing).toBe(KEY);
    expect(STORAGE_KEYS.packing).not.toBe(STORAGE_KEYS.itinerary);
    expect(STORAGE_KEYS.packing).not.toBe(STORAGE_KEYS.journal);
    expect(STORAGE_KEYS.packing).not.toBe(STORAGE_KEYS.favorites);
    // No duplicate literals across the whole registry.
    const values = Object.values(STORAGE_KEYS) as string[];
    expect(new Set(values).size).toBe(values.length);
  });

  it('loadPacking returns the built-in 28-item template when the key is absent (fresh visitor, no empty state)', () => {
    const loaded = loadPacking();
    expect(loaded).toEqual(DEFAULT_TEMPLATE);
    expect(loaded).toHaveLength(28);
    expect(loaded.every((i) => i.checked === false)).toBe(true);
  });

  it('savePacking → loadPacking round-trips checked-state, stored as JSON under the key', () => {
    const seeded = loadPacking();
    const toggled: PackingItem[] = seeded.map((i, idx) => (idx === 0 ? { ...i, checked: true } : i));
    savePacking(toggled);
    expect(loadPacking()).toEqual(toggled);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(toggled);
  });

  it('savePacking SANITIZES on write — a malformed item never reaches disk', () => {
    savePacking([
      { id: 'a', label: 'Passport', category: 'universal', checked: true },
      { id: 'bad', label: '', category: 'universal', checked: false } as unknown as PackingItem,
    ]);
    const back = loadPacking();
    expect(back.map((i) => i.id)).toEqual(['a']);
  });

  it('sanitize-on-write DEDUPES a duplicate id (last write wins)', () => {
    savePacking([
      { id: 'a', label: 'First', category: 'nepal', checked: false },
      { id: 'a', label: 'Second', category: 'nepal', checked: true },
    ]);
    const back = loadPacking();
    expect(back).toHaveLength(1);
    expect(back[0].label).toBe('Second');
  });

  it('a corrupt (non-JSON) slot → the built-in template, never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadPacking()).not.toThrow();
    expect(loadPacking()).toEqual(DEFAULT_TEMPLATE);
  });

  it('a slot holding non-array JSON → the built-in template (sanitized)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadPacking()).toEqual(DEFAULT_TEMPLATE);
  });

  it('packingStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(packingStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(packingStore.get<string>('FB')).toBe('FB');
    packingStore.set([{ a: 1 }]);
    expect(packingStore.get<Array<{ a: number }>>([])).toEqual([{ a: 1 }]);
  });

  it('SSR-safe: with no window, load returns the built-in template and save is inert (never throws)', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => {
        expect(loadPacking()).toEqual(DEFAULT_TEMPLATE);
        savePacking([...DEFAULT_TEMPLATE]); // no-op
      }).not.toThrow();
    } finally {
      globalThis.window = saved;
    }
  });

  it('never throws when setItem throws (quota / disabled storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => savePacking([...DEFAULT_TEMPLATE])).not.toThrow();
  });
});

describe('loadPacking — trip-aware fallback (D-355, A-15/#102)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('default trip (unset pointer): absent slot seeds the full 28-item DEFAULT_TEMPLATE, incl. nepal/japan items', () => {
    const loaded = loadPacking();
    expect(loaded).toEqual(DEFAULT_TEMPLATE);
    expect(loaded.some((i) => i.category === 'nepal')).toBe(true);
    expect(loaded.some((i) => i.category === 'japan')).toBe(true);
  });

  it('a custom trip: absent slot seeds only the universal-category items, no nepal/japan rows', () => {
    setActiveTripId('custom-1');
    const loaded = loadPacking();
    expect(loaded.every((i) => i.category === 'universal')).toBe(true);
    expect(loaded).toEqual(DEFAULT_TEMPLATE.filter((i) => i.category === 'universal'));
  });

  it('a custom trip with a CORRUPT slot also falls back to universal-only, not the full template', () => {
    setActiveTripId('custom-1');
    window.localStorage.setItem(KEY, '{not json');
    const loaded = loadPacking();
    expect(loaded.every((i) => i.category === 'universal')).toBe(true);
  });
});

describe('packing stays a device-local slot (#227 — no sync, no outbox, no remote module)', () => {
  it('model/storage/hook source has zero references to core/sync or any *-remote module', () => {
    const files = [
      join(__dirname, '../../core/packing/model.ts'),
      join(__dirname, '../../core/packing/storage.ts'),
      join(__dirname, '../../hooks/use-packing.ts'),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/core\/sync/);
      expect(src).not.toMatch(/-remote/);
      expect(src).not.toMatch(/firestore/i);
      expect(src).not.toMatch(/outbox/i);
    }
  });
});
