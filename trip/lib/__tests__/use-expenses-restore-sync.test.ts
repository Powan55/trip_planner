// @vitest-environment jsdom
//
// S174 (FU-37) — regression suite for whole-store expenses RESTORE under sync (`restoreExpenses`,
// D-156 tombstone-replace, mirroring `use-itinerary-restore-plans-sync.test.ts`'s `restorePlans`
// proof but over the FLAT expenses row-set instead of day-keyed itinerary plans). Exercised by
// RENDERING the real hook (the same renderHook shim — no new dep).
//
// Proven on a real run (SYNC ON):
//   - tombstone-replace: after restore, the backup's rows are LIVE (fresh ids) and every prior live
//     row is a tombstone.
//   - a concurrent peer edit with a STRICTLY-LATER hlc SURVIVES the next merge (not a blind clobber).
//   - a peer that still holds an old row LIVE does NOT resurrect it (the restore's tombstone wins).
//   - NON-VACUOUS: fresh-id/fresh-stamp is load-bearing — a same-id-same-hlc "restore" would be
//     re-killed by the tombstone bias, while the real fresh-id copy survives.
// DORMANT: restoreExpenses is a plain local overwrite (byte-identical, no sync fields stamped).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firebaseConfigMock } from './firebase-config-mock';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ExpenseStore } from '@/hooks/use-expenses';
import type { Expense } from '@/core/budget/expenses';

const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', (io) =>
  firebaseConfigMock(io, () => state.remoteOn, 'nepal-japan-2026'));
vi.mock('@/lib/expenses-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/expenses-ports')>();
  return {
    ...orig,
    expensesSyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/places-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/places-ports')>();
  return {
    ...orig,
    placesSyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => state.remoteOn },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useExpenses } from '@/hooks/use-expenses';
import { importTripBackup } from '@/lib/trip-backup';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { mergeItems } from '@/core/sync/merge-items';
import { parse } from '@/core/sync/hlc';
import { nextSyncStamp } from '@/core/sync/stamp';
import { useMyPlaces, type MyPlacesStore } from '@/hooks/use-my-places';
import { loadPhotos, savePhotos } from '@/core/photos/storage';
import { makeInMemoryBlobStore } from '@/core/photos/blob-store';
import type { PhotoMeta } from '@/core/photos/model';
import { usePhotos, type PhotosStore } from '@/hooks/use-photos';

function renderPlaces(): { current: MyPlacesStore } {
  const ref: { current: MyPlacesStore } = { current: null as unknown as MyPlacesStore };
  function Probe() {
    ref.current = useMyPlaces();
    return null;
  }
  act(() => createRoot(document.body.appendChild(document.createElement('div'))).render(createElement(Probe)));
  return ref;
}

const receipt = (id: string, expenseId: string): PhotoMeta => ({
  id,
  owner: { kind: 'expense', expenseId },
  altText: 'receipt',
  w: 1,
  h: 1,
  bytes: 3,
  createdAt: '2026-12-10T00:00:00.000Z',
});

const backupFile = (domains: Record<string, unknown>, photos: { meta: PhotoMeta[]; blobs: Record<string, string> }) =>
  new Blob([
    JSON.stringify({
      format: 'nepal-japan-trip-backup',
      version: 1,
      exportedAt: '2026-12-01T00:00:00.000Z',
      tripId: 'nepal-japan-2026',
      remoteId: 'nepal-japan-2026',
      domains,
      photos,
    }),
  ]);

interface HookHandle {
  current: ExpenseStore;
  run: (fn: (store: ExpenseStore) => void) => Promise<void>;
  unmount: () => void;
}

function renderExpenses(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: ExpenseStore } = { current: null as unknown as ExpenseStore };
  function Probe() {
    ref.current = useExpenses();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function rawOnDisk(): Expense[] {
  const blob = localStorage.getItem(STORAGE_KEYS.expenses);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : [];
}

const backupRow = (id: string, note: string): Expense => ({
  id,
  leg: 'nepal',
  category: 'food',
  amount: 100,
  note,
  createdAt: '2026-12-10T00:00:00.000Z',
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SYNC ON — restoreExpenses is a tombstone-replace merge (S174, D-156)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('backup WINS: its rows become live (fresh ids), prior live rows tombstoned', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));
    await h.run((s) => s.addExpense({ leg: 'japan', category: 'transportation', amount: 700 }));
    const priorIds = h.current.expenses.map((e) => e.id);
    expect(priorIds).toHaveLength(2);

    const backup: Expense[] = [backupRow('x', 'X'), backupRow('y', 'Y')];
    await h.run((s) => s.restoreExpenses(backup));

    expect(h.current.expenses.map((e) => e.note).sort()).toEqual(['X', 'Y']);
    expect(h.current.expenses.every((e) => !priorIds.includes(e.id))).toBe(true);
    expect(h.current.expenses.every((e) => e.rev === 1 && typeof e.hlc === 'string')).toBe(true);

    const raw = rawOnDisk();
    for (const id of priorIds) {
      expect(raw.find((e) => e.id === id)?.deleted).toBe(true);
    }
    h.unmount();
  });

  it('a concurrent peer edit with a STRICTLY-LATER hlc survives the next merge (not a blind clobber)', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));
    const originalId = h.current.expenses[0].id;
    await h.run((s) => s.restoreExpenses([])); // restore-to-empty tombstones it

    const tomb = rawOnDisk().find((e) => e.id === originalId)!;
    expect(tomb.deleted).toBe(true);

    const laterPt = parse(tomb.hlc!).pt + 1000;
    const peerEdit: Expense = {
      ...tomb,
      deleted: false,
      note: 'Peer edit',
      ...nextSyncStamp(tomb, laterPt, 'peer'),
    };
    const merged = mergeItems(rawOnDisk(), [peerEdit]);
    const survivor = merged.find((e) => e.id === originalId)!;
    expect(survivor.deleted).not.toBe(true);
    expect(survivor.note).toBe('Peer edit');
    h.unmount();
  });

  it('restore-to-empty STAYS empty — a peer still holding a row live does not resurrect it', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));
    const peerStillLive: Expense[] = JSON.parse(JSON.stringify(rawOnDisk()));

    await h.run((s) => s.restoreExpenses([]));
    expect(h.current.expenses).toEqual([]);

    const merged = mergeItems(rawOnDisk(), peerStillLive);
    expect(merged.some((e) => e.deleted !== true)).toBe(false);
    h.unmount();
  });

  it('NON-VACUOUS: fresh-id restore survives an existing remote tombstone; a same-id-same-hlc restore would be re-killed', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));
    const originalId = h.current.expenses[0].id;
    await h.run((s) => s.restoreExpenses([backupRow(originalId, 'Restored')]));

    const restoredLive = rawOnDisk().filter((e) => e.deleted !== true);
    expect(restoredLive).toHaveLength(1);
    expect(restoredLive[0].id).not.toBe(originalId);
    expect(restoredLive[0].note).toBe('Restored');

    const remoteTomb: Expense = { ...rawOnDisk().find((e) => e.id === originalId)! };
    const merged = mergeItems(rawOnDisk(), [remoteTomb]);
    const live = merged.filter((e) => e.deleted !== true);
    expect(live).toHaveLength(1);
    expect(live[0].note).toBe('Restored');

    // Counterfactual: a same-id-same-hlc "restore" would be re-killed by the tombstone bias.
    const tomb = rawOnDisk().find((e) => e.id === originalId)!;
    const sameIdRestore: Expense = { ...tomb, deleted: false, note: 'Restored' };
    const wrong = mergeItems([sameIdRestore], [tomb]);
    expect(wrong.filter((e) => e.deleted !== true)).toHaveLength(0);
    h.unmount();
  });

  it('#573: a whole-trip restore replaces expenses, so a row added after the backup is gone', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 999, note: 'after backup' }));
    const addedId = h.current.expenses[0].id;
    const file = new Blob([
      JSON.stringify({
        format: 'nepal-japan-trip-backup',
        version: 1,
        exportedAt: '2026-12-01T00:00:00.000Z',
        tripId: 'nepal-japan-2026',
        remoteId: 'nepal-japan-2026',
        domains: { expenses: [backupRow('x', 'X')] },
        photos: { meta: [], blobs: {} },
      }),
    ]);

    let ok = false;
    await act(async () => {
      const res = await importTripBackup(file, undefined, undefined, undefined, undefined, h.current.restoreExpenses);
      ok = res.ok;
    });

    expect(ok).toBe(true);
    expect(h.current.expenses.map((e) => e.note)).toEqual(['X']);
    expect(rawOnDisk().find((e) => e.id === addedId)?.deleted).toBe(true);
    h.unmount();
  });

  it('#750: receipts follow their restored expense, and a restored place keeps the id its plan item links to', async () => {
    const h = renderExpenses();
    const places = renderPlaces();
    const store = makeInMemoryBlobStore();
    const place = { id: 'p1', name: 'Temple', legId: 'nepal', addedAt: '2026-12-10T00:00:00.000Z' };
    const planItemSourceId = `myplace-${place.id}`;
    const file = backupFile(
      { expenses: [backupRow('x', 'X')], myPlaces: [place] },
      { meta: [receipt('ph-1', 'x')], blobs: { 'ph-1': 'data:image/png;base64,AAAA' } },
    );

    let res: Awaited<ReturnType<typeof importTripBackup>> | undefined;
    await act(async () => {
      res = await importTripBackup(file, store, undefined, places.current.restoreMyPlaces, undefined, h.current.restoreExpenses);
    });

    expect(res).toMatchObject({ ok: true, dropped: [] });
    const liveIds = new Set(h.current.expenses.map((e) => e.id));
    expect(liveIds.has('x')).toBe(false); // sync still mints a fresh expense id
    const photos = loadPhotos();
    expect(photos).toHaveLength(1);
    for (const p of photos) {
      expect(p.owner.kind === 'expense' && liveIds.has(p.owner.expenseId)).toBe(true);
    }
    expect(await store.get('ph-1')).not.toBeNull();
    expect(places.current.places.map((p) => `myplace-${p.id}`)).toEqual([planItemSourceId]);
    h.unmount();
  });

  it('#750: the expenses-only restore re-points every live receipt to its restored expense', async () => {
    const h = renderExpenses();
    const photos: { current: PhotosStore } = { current: null as unknown as PhotosStore };
    function PhotosProbe() {
      photos.current = usePhotos();
      return null;
    }
    act(() => createRoot(document.body.appendChild(document.createElement('div'))).render(createElement(PhotosProbe)));
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 1, note: 'A' }));
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 2, note: 'B' }));
    const backup: Expense[] = JSON.parse(JSON.stringify(rawOnDisk()));
    savePhotos(backup.map((e) => receipt(`ph-${e.note}`, e.id)));

    // Same steps as the settings panel's ExpensesBackupRestore confirm.
    await act(async () => {
      const ids = h.current.restoreExpenses(backup);
      if (ids) for (const [from, to] of ids) photos.current.repointExpense(from, to);
    });

    const byNote = new Map(h.current.expenses.map((e) => [e.note, e.id]));
    expect(byNote.size).toBe(2);
    for (const p of loadPhotos()) {
      expect(p.owner).toEqual({ kind: 'expense', expenseId: byNote.get(p.id.slice(3)) });
    }
    expect(backup.some((e) => byNote.get(e.note!) === e.id)).toBe(false);
    h.unmount();
  });

  it('#751: an empty photo list in the file keeps this device\'s photos, re-pointed to the restored expense', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500, note: 'X' }));
    const liveId = h.current.expenses[0].id;
    const store = makeInMemoryBlobStore();
    await store.putWithId('ph-live', new Blob(['abc']));
    savePhotos([receipt('ph-live', liveId)]);

    let ok = false;
    await act(async () => {
      const res = await importTripBackup(
        backupFile({ expenses: [backupRow(liveId, 'X')] }, { meta: [], blobs: {} }),
        store, undefined, undefined, undefined, h.current.restoreExpenses,
      );
      ok = res.ok;
    });

    expect(ok).toBe(true);
    const newId = h.current.expenses[0].id;
    expect(newId).not.toBe(liveId);
    expect(loadPhotos().map((p) => p.owner)).toEqual([{ kind: 'expense', expenseId: newId }]);
    expect(await store.get('ph-live')).not.toBeNull();
    h.unmount();
  });
});

describe('DORMANT — restoreExpenses is a plain local overwrite (S174, D-038 byte-identity)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('overwrites the store with the backup verbatim, with NO sync fields stamped', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 500 }));

    const backup: Expense[] = [backupRow('z', 'Z')];
    await h.run((s) => s.restoreExpenses(backup));

    expect(rawOnDisk()).toEqual(backup);
    for (const e of rawOnDisk()) {
      expect(e).not.toHaveProperty('rev');
      expect(e).not.toHaveProperty('hlc');
      expect(e).not.toHaveProperty('deleted');
    }
    expect(h.current.expenses.map((e) => e.id)).toEqual(['z']);
    h.unmount();
  });
});
