// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * V6-6 (A-15/#102) — docs-checklist persistence round-trip through the typed storage gateway
 * (key 25) + the `core/docs/storage.ts` load/save adapter, plus the trip-aware fallback split
 * (D-355): the default trip still seeds the 18-item Nepal/Japan `DEFAULT_TEMPLATE`, a custom trip
 * seeds the 16-item country-neutral `UNIVERSAL_TEMPLATE` instead — so an absent/corrupt slot on a
 * custom trip never seeds (and, once synced, pushes to Firestore) Nepal/Japan-specific rows.
 * Mirrors packing-storage.test.ts.
 */

import { STORAGE_KEYS, docsStore, setActiveTripId, keyFor } from '@/core/storage/gateway';
import { loadDocs, saveDocs } from '@/core/docs/storage';
import { DEFAULT_TEMPLATE, UNIVERSAL_TEMPLATE, type DocItem } from '@/core/docs/model';

const KEY = STORAGE_KEYS.docsChecklist;

describe('docs checklist storage (gateway key 25)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadDocs returns the built-in 18-item template on the default trip (absent slot)', () => {
    const loaded = loadDocs();
    expect(loaded).toEqual(DEFAULT_TEMPLATE);
    expect(loaded).toHaveLength(18);
  });

  it('saveDocs → loadDocs round-trips checked-state, stored as JSON under the key', () => {
    const seeded = loadDocs();
    const toggled: DocItem[] = seeded.map((i, idx) => (idx === 0 ? { ...i, checked: true } : i));
    saveDocs(toggled);
    expect(loadDocs()).toEqual(toggled);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(toggled);
  });

  it('a corrupt (non-JSON) slot → the built-in template on the default trip, never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadDocs()).not.toThrow();
    expect(loadDocs()).toEqual(DEFAULT_TEMPLATE);
  });

  it('docsStore is byte-transport only: get(fallback) returns fallback on absent/corrupt', () => {
    expect(docsStore.get<string>('FB')).toBe('FB');
    window.localStorage.setItem(KEY, '{broken');
    expect(docsStore.get<string>('FB')).toBe('FB');
  });
});

describe('loadDocs — trip-aware fallback (D-355, A-15/#102)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('default trip (unset pointer): absent/corrupt slot seeds the 18-item DEFAULT_TEMPLATE, incl. nepal-visa/japan-entry', () => {
    const loaded = loadDocs();
    expect(loaded).toHaveLength(18);
    expect(loaded.map((i) => i.id)).toContain('nepal-visa');
    expect(loaded.map((i) => i.id)).toContain('japan-entry');
  });

  it('a custom trip: absent/corrupt slot seeds the 16-item UNIVERSAL_TEMPLATE, no nepal-visa/japan-entry', () => {
    setActiveTripId('custom-1');
    const loaded = loadDocs();
    expect(loaded).toEqual(UNIVERSAL_TEMPLATE);
    expect(loaded).toHaveLength(16);
    expect(loaded.map((i) => i.id)).not.toContain('nepal-visa');
    expect(loaded.map((i) => i.id)).not.toContain('japan-entry');
  });

  it('a custom trip with a CORRUPT slot also falls back to UNIVERSAL_TEMPLATE, not DEFAULT_TEMPLATE', () => {
    setActiveTripId('custom-1');
    window.localStorage.setItem(KEY, '{not json');
    expect(loadDocs()).toEqual(UNIVERSAL_TEMPLATE);
  });
});

describe('#335 — an EMPTY list is a real value, not an absent one (mirrors packing #328)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saveDocs([]) writes an empty array — NOT the built-in template', () => {
    saveDocs([]);
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual([]);
  });

  it('loadDocs after emptying returns [] and a reload keeps it empty (the seed is for ABSENT only)', () => {
    saveDocs([]);
    expect(loadDocs()).toEqual([]);
    expect(loadDocs()).toEqual([]);
  });

  it('the ABSENT slot still seeds the template — removing the key re-seeds, emptying it does not', () => {
    saveDocs([]);
    expect(loadDocs()).toEqual([]);
    window.localStorage.removeItem(KEY);
    expect(loadDocs()).toEqual(DEFAULT_TEMPLATE);
  });

  it('CUSTOM TRIP: an empty slot stays empty, never falls back to UNIVERSAL_TEMPLATE', () => {
    setActiveTripId('custom-1');
    const customKey = keyFor('docsChecklist');
    saveDocs([]);
    expect(JSON.parse(window.localStorage.getItem(customKey) as string)).toEqual([]);
    expect(loadDocs()).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
