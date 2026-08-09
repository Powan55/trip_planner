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
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ExpenseStore } from '@/hooks/use-expenses';
import type { Expense } from '@/core/budget/expenses';

const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
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
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useExpenses } from '@/hooks/use-expenses';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { mergeItems } from '@/core/sync/merge-items';
import { parse } from '@/core/sync/hlc';
import { nextSyncStamp } from '@/core/sync/stamp';

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
