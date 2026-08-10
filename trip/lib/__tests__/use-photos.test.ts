// @vitest-environment jsdom
//
// S160 — WIRED-behavior unit suite for hooks/use-photos.ts, exercised by RENDERING the real hook (the
// same renderHook shim over react-dom/client + act the expense-sync suite uses — no new dep). The
// blob-store + downscale are the two browser-only seams (jsdom has no IndexedDB / Canvas), so they are
// module-mocked: `defaultBlobStore` → an in-memory fake we control, `preparePhoto` → a canned blob.
// This proves the META lifecycle at gateway key 16:
//   - addPhoto → meta persisted at key 16 + a fresh mount (reload) survives;
//   - removePhoto → meta AND blob gone;
//   - a full-device (quota) put → NO meta written, host entry/expense unaffected, reason surfaced;
//   - the sync-on expense Undo re-point: restoreExpense returns a FRESH id, repointExpense moves the
//     receipt meta old→new (NON-VACUOUS — the receipt follows the restored row). D-159/D-160 cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// ── Control handles for the two mocked browser seams ─────────────────────────────────────────────
const h = vi.hoisted(() => {
  const map = new Map<string, Blob>();
  const ctl = { mode: 'ok' as 'ok' | 'quota' | 'unavailable', decodeOk: true, seq: 0 };
  const store = {
    async put(blob: Blob) {
      if (ctl.mode !== 'ok') return { ok: false as const, reason: ctl.mode };
      const id = `ph-test-${ctl.seq++}`;
      map.set(id, blob);
      return { ok: true as const, id };
    },
    async get(id: string) {
      return map.get(id) ?? null;
    },
    async delete(id: string) {
      map.delete(id);
    },
    async list() {
      return [...map.keys()];
    },
    async usage() {
      let bytes = 0;
      for (const b of map.values()) bytes += b.size;
      return { count: map.size, bytes };
    },
  };
  return { map, ctl, store };
});

vi.mock('@/core/photos/blob-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/photos/blob-store')>();
  return { ...orig, defaultBlobStore: h.store };
});

vi.mock('@/core/photos/downscale', () => ({
  MAX_EDGE: 1600,
  JPEG_QUALITY: 0.8,
  fitWithin: (w: number, hh: number) => ({ w, h: hh }),
  preparePhoto: async (file: Blob) =>
    h.ctl.decodeOk ? { ok: true as const, blob: file, w: 800, h: 600 } : { ok: false as const, reason: 'decode' },
}));

// useExpenses pulls firebase/sync/identity — stub them so the store is deterministic (sync ON here so
// restoreExpense mints a fresh id, the case the re-point exists for).
const syncState = vi.hoisted(() => ({ remoteOn: true }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => syncState.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => syncState.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/expenses-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/expenses-ports')>();
  return {
    ...orig,
    expensesSyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => syncState.remoteOn },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { usePhotos, type PhotosStore } from '@/hooks/use-photos';
import { useExpenses, type ExpenseStore } from '@/hooks/use-expenses';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import type { PhotoMeta, PhotoOwner } from '@/core/photos/model';

interface Combined {
  photos: PhotosStore;
  expenses: ExpenseStore;
}

interface Handle {
  current: Combined;
  run: (fn: (c: Combined) => unknown) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function render(): Handle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: Combined } = { current: null as unknown as Combined };

  function Probe() {
    ref.current = { photos: usePhotos(), expenses: useExpenses() };
    return null;
  }
  act(() => root.render(createElement(Probe)));

  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        await fn(ref.current);
        await Promise.resolve();
      });
    },
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => root.render(createElement(Probe)));
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Raw key-16 metadata index off localStorage. */
function rawMeta(): PhotoMeta[] {
  const blob = localStorage.getItem(STORAGE_KEYS.photos);
  return blob ? (JSON.parse(blob) as PhotoMeta[]) : [];
}

const DAY: PhotoOwner = { kind: 'journal', date: '2026-12-14' };
const file = () => new Blob([new Uint8Array(1234)], { type: 'image/jpeg' });

beforeEach(() => {
  localStorage.clear();
  h.map.clear();
  h.ctl.mode = 'ok';
  h.ctl.decodeOk = true;
  h.ctl.seq = 0;
  syncState.remoteOn = true;
});
afterEach(() => vi.restoreAllMocks());

describe('addPhoto → persists meta at key 16 + a fresh mount survives (the hard guarantee)', () => {
  it('stores the blob, writes the meta, and it survives a remount (reload)', async () => {
    const t = render();
    await t.run((c) => c.photos.addPhoto(DAY, file(), 'A momo stall', 'warm from the steamer'));

    const live = t.current.photos.photosFor(DAY);
    expect(live).toHaveLength(1);
    expect(live[0].altText).toBe('A momo stall');
    expect(live[0].caption).toBe('warm from the steamer');
    expect(live[0].bytes).toBe(1234);

    // Persisted to key 16, and the blob is in the store.
    expect(rawMeta()).toHaveLength(1);
    expect(await h.store.list()).toHaveLength(1);

    // RELOAD — a fresh mount reads key 16 and the photo is still there.
    await t.rerenderFresh();
    expect(t.current.photos.photosFor(DAY)).toHaveLength(1);
    t.unmount();
  });

  it('a decode failure stores NOTHING and surfaces the reason', async () => {
    const t = render();
    h.ctl.decodeOk = false;
    let result: unknown;
    await t.run(async (c) => {
      result = await c.photos.addPhoto(DAY, file(), 'unreadable');
    });
    expect(result).toEqual({ ok: false, reason: 'decode' });
    expect(rawMeta()).toEqual([]);
    expect(await h.store.list()).toEqual([]);
    t.unmount();
  });
});

describe('removePhoto → meta + blob both gone', () => {
  it('drops the key-16 meta and deletes the blob', async () => {
    const t = render();
    let id = '';
    await t.run(async (c) => {
      const r = await c.photos.addPhoto(DAY, file(), 'to delete');
      if (r.ok) id = r.id;
    });
    expect(t.current.photos.photosFor(DAY)).toHaveLength(1);

    await t.run((c) => c.photos.removePhoto(id));
    expect(t.current.photos.photosFor(DAY)).toHaveLength(0);
    expect(rawMeta()).toEqual([]);
    expect(await h.store.get(id)).toBeNull(); // blob gone too
    t.unmount();
  });
});

describe('quota — a full device keeps the host entry/expense saved', () => {
  it('addPhoto returns {ok:false,quota}, writes no meta; the expense it was for is untouched', async () => {
    const t = render();
    // The expense the receipt was meant for still logs fine (independent of the photo store).
    await t.run((c) => c.expenses.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));
    const expId = t.current.expenses.expenses[0].id;

    h.ctl.mode = 'quota';
    let result: unknown;
    await t.run(async (c) => {
      result = await c.photos.addPhoto({ kind: 'expense', expenseId: expId }, file(), 'receipt');
    });
    expect(result).toEqual({ ok: false, reason: 'quota' });
    expect(rawMeta()).toEqual([]); // no meta written
    expect(t.current.expenses.expenses).toHaveLength(1); // the expense survived
    t.unmount();
  });
});

describe('sync-on expense Undo re-point (D-160) — the receipt follows a fresh-id restore', () => {
  it('restoreExpense returns a FRESH id and repointExpense moves the receipt meta old→new', async () => {
    const t = render();
    // 1. Log an expense + attach a receipt to its id.
    await t.run((c) => c.expenses.addExpense({ leg: 'japan', category: 'food', amount: 900 }));
    const original = t.current.expenses.expenses[0];
    await t.run((c) => c.photos.addPhoto({ kind: 'expense', expenseId: original.id }, file(), 'ramen receipt'));
    expect(t.current.photos.photosFor({ kind: 'expense', expenseId: original.id })).toHaveLength(1);

    // 2. Delete (tombstone under sync), then Undo → a FRESH-ID restore.
    await t.run((c) => c.expenses.removeExpense(original.id));
    let newId = '';
    await t.run((c) => {
      newId = c.expenses.restoreExpense(original); // void→string (D-160)
      c.photos.repointExpense(original.id, newId);
    });

    // Non-vacuous: the restored id is genuinely different, and the receipt now points at it.
    expect(newId).not.toBe(original.id);
    expect(t.current.photos.photosFor({ kind: 'expense', expenseId: original.id })).toHaveLength(0);
    const moved = t.current.photos.photosFor({ kind: 'expense', expenseId: newId });
    expect(moved).toHaveLength(1);
    expect(moved[0].altText).toBe('ramen receipt');
    // Persisted at key 16 under the new id.
    expect(rawMeta()[0].owner).toEqual({ kind: 'expense', expenseId: newId });
    t.unmount();
  });

  it('DORMANT restore returns the SAME id (re-point is a no-op)', async () => {
    syncState.remoteOn = false;
    const t = render();
    await t.run((c) => c.expenses.addExpense({ leg: 'nepal', category: 'hotel', amount: 3000 }));
    const original = t.current.expenses.expenses[0];
    await t.run((c) => c.expenses.removeExpense(original.id));
    let newId = '';
    await t.run((c) => {
      newId = c.expenses.restoreExpense(original);
    });
    expect(newId).toBe(original.id); // verbatim same-id restore
    t.unmount();
  });
});
