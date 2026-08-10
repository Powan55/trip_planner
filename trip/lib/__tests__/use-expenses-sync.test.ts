// @vitest-environment jsdom
//
// S142 — WIRED-behavior unit suite for the expense-sync store changes in hooks/use-expenses.ts,
// exercised by RENDERING the real hook (a tiny renderHook shim over react-dom/client + act — no
// new dependency), plus a direct sanitizeExpenses passthrough check. The CONTRAST between the two
// regimes is the D-038 dormant-build byte-identity gate:
//
//   SYNC ON  (isRemoteConfigured() === true):
//     - addExpense stamps rev=1 + a serialized hlc + "logged by" attribution (createdBy/updatedBy).
//     - updateExpense bumps rev + advances hlc.
//     - removeExpense writes a TOMBSTONE (deleted:true) on disk but the EXPOSED list hides it.
//     - restoreExpense (undo) inserts a FRESH-ID copy (D-032/D-119) — never the tombstoned id.
//
//   DORMANT (isRemoteConfigured() === false):
//     - removeExpense PHYSICALLY removes (no tombstone); NO sync/attribution field is stamped, so
//       the on-disk bytes are exactly today's (D-038); restoreExpense re-inserts verbatim same-id.
//
// D-038 (dormant gate), D-041 (attribution), D-149 (expense sync), D-032/D-119 (fresh-id undo) cited.

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
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
// Never let the sync fan-out touch firebase in this unit suite: stub the SyncPort to no-ops.
// (The push/subscribe wiring is covered by expenses-remote-sync.test.ts against a fake Firestore;
// here we only exercise the STORE's local stamping/tombstone/filter behavior.)
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
// A signed-in traveler so actor() is a real distinct name (drives attribution + the hlc actor).
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useExpenses } from '@/hooks/use-expenses';
import { sanitizeExpenses } from '@/core/budget/expenses';
import { STORAGE_KEYS } from '@/core/storage/gateway';

interface HookHandle {
  current: ExpenseStore;
  run: (fn: (store: ExpenseStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderExpenses(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: ExpenseStore } = { current: null as unknown as ExpenseStore };

  function Probe() {
    ref.current = useExpenses();
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });

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
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
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

/** Read the RAW on-disk expenses (with tombstones), bypassing the exposed filter. */
function rawOnDisk(): Expense[] {
  const blob = localStorage.getItem(STORAGE_KEYS.expenses);
  return blob ? (JSON.parse(blob) as Expense[]) : [];
}

const LOG: Parameters<ExpenseStore['addExpense']>[0] = { leg: 'nepal', category: 'food', amount: 1000, note: 'Momos' };

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeExpenses — PASSES THROUGH the new sync/attribution fields (a DoD line)', () => {
  it('rev/hlc/deleted/createdBy/updatedBy survive a sanitize round-trip', () => {
    const stamped: Expense = {
      id: 'e1', leg: 'nepal', category: 'food', amount: 1000, createdAt: 't',
      rev: 3, hlc: '000000000005000:000000:Powan', deleted: true, createdBy: 'Powan', updatedBy: 'Sushil',
    };
    const [out] = sanitizeExpenses([stamped]);
    expect(out).toEqual(stamped); // nothing stripped — merge ordering + attribution preserved
  });

  it('a dormant expense (no sync fields) round-trips byte-identical (nothing added)', () => {
    const dormant: Expense = { id: 'e2', leg: 'japan', category: 'hotel', amount: 8000, createdAt: 't' };
    expect(sanitizeExpenses([dormant])[0]).toEqual(dormant);
  });
});

describe('SYNC ON — stamping + attribution + tombstone + live-filter + fresh-id undo', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('addExpense stamps rev=1, an hlc, and "logged by" attribution; updateExpense advances them', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense(LOG));
    let e = h.current.expenses[0];
    expect(e.rev).toBe(1);
    expect(typeof e.hlc).toBe('string');
    expect(e.createdBy).toBe('Powan');
    expect(e.updatedBy).toBe('Powan');
    const firstHlc = e.hlc!;

    await h.run((s) => s.updateExpense(e.id, { amount: 1500 }));
    e = h.current.expenses[0];
    expect(e.amount).toBe(1500);
    expect(e.rev).toBe(2);
    expect(e.hlc! > firstHlc).toBe(true); // monotonic advance
    h.unmount();
  });

  it('removeExpense writes a TOMBSTONE on disk but the EXPOSED list hides it', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense(LOG));
    const id = h.current.expenses[0].id;
    await h.run((s) => s.removeExpense(id));

    expect(h.current.expenses).toHaveLength(0); // UI sees a normal delete
    const raw = rawOnDisk().find((e) => e.id === id);
    expect(raw?.deleted).toBe(true); // retained on disk to propagate + win
    expect(raw?.rev).toBe(2);
    h.unmount();
  });

  it('restoreExpense (undo) inserts a FRESH-ID copy — never the tombstoned id (D-032/D-119)', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense(LOG));
    const original = h.current.expenses[0];
    await h.run((s) => s.removeExpense(original.id));
    await h.run((s) => s.restoreExpense(original));

    const live = h.current.expenses;
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(original.id); // fresh id, not the tombstoned one
    expect(live[0].amount).toBe(original.amount); // same content restored
    expect(live[0].deleted).not.toBe(true);
    expect(live[0].createdBy).toBe('Powan');
    // The original tombstone is still on disk (so the delete keeps propagating to peers).
    expect(rawOnDisk().find((e) => e.id === original.id)?.deleted).toBe(true);
    h.unmount();
  });
});

describe('DORMANT — no stamping, physical remove, byte-for-byte today (D-038)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('addExpense stamps NO sync/attribution fields (on disk byte-identical to S102)', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense(LOG));
    const e = h.current.expenses[0];
    expect(e).not.toHaveProperty('rev');
    expect(e).not.toHaveProperty('hlc');
    expect(e).not.toHaveProperty('deleted');
    expect(e).not.toHaveProperty('createdBy');
    const raw = rawOnDisk()[0];
    expect(raw).toEqual({ id: e.id, leg: 'nepal', category: 'food', amount: 1000, note: 'Momos', createdAt: e.createdAt });
    h.unmount();
  });

  it('removeExpense PHYSICALLY removes (no tombstone); restoreExpense is verbatim same-id', async () => {
    const h = renderExpenses();
    await h.run((s) => s.addExpense(LOG));
    const original = h.current.expenses[0];
    await h.run((s) => s.removeExpense(original.id));

    expect(rawOnDisk()).toEqual([]); // truly gone, no deleted:true ghost
    await h.run((s) => s.restoreExpense(original));
    const raw = rawOnDisk();
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe(original.id); // verbatim same-id restore (byte-identical)
    expect('deleted' in raw[0]).toBe(false);
    h.unmount();
  });
});
