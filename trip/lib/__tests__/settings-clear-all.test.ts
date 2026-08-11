// @vitest-environment jsdom
//
// S146 — the per-domain "clear all" mechanics behind the Settings page, exercised by RENDERING the
// real hooks (the same renderHook shim over react-dom/client + act as use-itinerary-clearday-sync
// / use-budget-sync — no new dependency). The CENTERPIECE property is that each clear PROPAGATES
// under sync (it is the mirror of S145 restore-to-empty), not a blind local wipe the next server
// snapshot would unwind:
//
//   ITINERARY.clearAll — SYNC: tombstones EVERY live item across EVERY day in ONE commit → ONE
//     push (D-088); reload keeps the tombstones (no reseed, D-018). NON-VACUOUS via mergeDay: a
//     strictly-later friend add survives, an earlier one stays dead. DORMANT: physically empties
//     every day, NO deleted/rev/hlc (D-038 byte-identity).
//   EXPENSES.clearAll — SYNC: tombstones every live row in ONE commit → ONE push. NON-VACUOUS via
//     mergeItems. DORMANT: a plain local [] wipe, no tombstones.
//   BUDGET.reset — SYNC: LWW-writes the seed with a FRESH per-field HLC so the reset WINS the next
//     mergeBudget (a naive seed-HLC wipe would LOSE — the contrast proves non-vacuity). DORMANT:
//     no sync.fieldHlc, byte-identical seed write.
//   JOURNAL.clearAll — LOCAL ONLY (D-152): the journal store has NO sync port, so the wipe has no
//     propagation path by construction; entries clear + stay cleared on reload.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';
import type { Expense } from '@/core/budget/expenses';
import type { BudgetModel } from '@/core/budget/model';

// Shared config gate + per-domain push spies (record every SyncPort.push so a test can assert ONE
// push per commit and inspect the pushed snapshot).
const state = vi.hoisted(() => ({
  remoteOn: false,
  itinPush: [] as Array<{ prev: DayPlan[]; next: DayPlan[] }>,
  expPush: [] as Array<{ prev: Expense[]; next: Expense[] }>,
  budgetPush: [] as Array<{ prev: BudgetModel; next: BudgetModel }>,
}));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: {
      push: async (prev: DayPlan[], next: DayPlan[]) => void state.itinPush.push({ prev, next }),
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/expenses-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/expenses-ports')>();
  return {
    ...orig,
    expensesSyncPort: {
      push: async (prev: Expense[], next: Expense[]) => void state.expPush.push({ prev, next }),
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/budget-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/budget-ports')>();
  return {
    ...orig,
    budgetSyncPort: {
      push: async (prev: BudgetModel, next: BudgetModel) => void state.budgetPush.push({ prev, next }),
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { useExpenses } from '@/hooks/use-expenses';
import { useBudget } from '@/hooks/use-budget';
import { useJournal } from '@/hooks/use-journal';
import { ITINERARY_STORAGE_KEY, savePlans } from '@/lib/itinerary-storage';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { mergeDay } from '@/core/sync/merge-day';
import { mergeItems } from '@/core/sync/merge-items';
import { mergeBudget, type BudgetFields } from '@/core/sync/merge-budget';
import { modelToFields } from '@/core/budget/flatten';
import { seedHlcFromLegacy, serialize, parse, type Hlc } from '@/core/sync/hlc';

// ── Generic renderHook shim (mirrors use-itinerary-clearday-sync.test.ts) ────────────────────
interface HookHandle<T> {
  current: T;
  run: (fn: (s: T) => void) => Promise<void>;
  unmount: () => void;
}
function renderHookOf<T>(useHook: () => T): HookHandle<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref = { current: null as unknown as T };
  function Probe() {
    ref.current = useHook();
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

function rawItin(): DayPlan[] {
  const blob = localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : parsed.payload;
}
function rawExpenses(): Expense[] {
  const blob = localStorage.getItem(STORAGE_KEYS.expenses);
  return blob ? (JSON.parse(blob) as Expense[]) : [];
}
function rawBudget(): BudgetModel {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.budget) as string) as BudgetModel;
}
function rawJournal(): unknown[] {
  const blob = localStorage.getItem(STORAGE_KEYS.journal);
  return blob ? (JSON.parse(blob) as unknown[]) : [];
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → itinerary store loads [] and never reseeds the sample.
  state.itinPush = [];
  state.expPush = [];
  state.budgetPush = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════ ITINERARY ═══════════════════════════
describe('itinerary.clearAll', () => {
  const D1 = '2026-12-10';
  const D2 = '2026-12-19';

  it('SYNC: tombstones every live item across every day in ONE push; reload stays cleared; non-vacuous', async () => {
    state.remoteOn = true;
    const h = renderHookOf(useItinerary);
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'Temple', category: 'cultural', sourceId: 's-a' }));
    await h.run((s) => s.addItem(D1, { id: 'b', title: 'Ramen', category: 'food', sourceId: 's-b' }));
    await h.run((s) => s.addItem(D2, { id: 'c', title: 'Shrine', category: 'cultural', sourceId: 's-c' }));

    state.itinPush = [];
    await h.run((s) => s.clearAll());

    // ONE commit → exactly ONE push.
    expect(state.itinPush).toHaveLength(1);
    // Every previously-live id is now a tombstone (rev bumped), ZERO live remain anywhere.
    const raw = rawItin();
    const allItems = raw.flatMap((d) => d.items);
    expect(allItems.filter((i) => i.deleted !== true)).toHaveLength(0);
    expect(allItems.filter((i) => i.deleted === true).map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    for (const t of allItems) {
      expect(t.rev).toBe(2); // add stamped rev=1, the clear tombstone bumps to 2
      expect(typeof t.hlc).toBe('string');
    }
    // UI shows every day empty.
    expect(h.current.plans.flatMap((d) => d.items)).toHaveLength(0);

    // "Reload": a fresh hook instance re-hydrates from the SAME on-disk bytes → still cleared, no reseed.
    h.unmount();
    const h2 = renderHookOf(useItinerary);
    expect(h2.current.plans.flatMap((d) => d.items)).toHaveLength(0);

    // NON-VACUOUS (mergeDay): a friend's STRICTLY-LATER add to a cleared id survives; an earlier one stays dead.
    const tomb = rawItin().find((d) => d.date === D1)!.items.find((i) => i.id === 'a')!;
    expect(tomb.deleted).toBe(true);
    const cleared: DayPlan = { date: D1, city: '', country: 'nepal', items: [tomb] };
    const tHlc: Hlc = parse(tomb.hlc!);
    const friendAdd = (dpt: number): ItineraryItem => ({
      ...tomb,
      deleted: false,
      hlc: serialize({ pt: tHlc.pt + dpt, ct: tHlc.ct, actor: 'Sushil' }),
    });
    const later = mergeDay(cleared, { date: D1, city: '', country: 'nepal', items: [friendAdd(1000)] }).items;
    expect(later.find((i) => i.id === 'a')!.deleted).toBe(false); // later add wins → survives
    const earlier = mergeDay(cleared, { date: D1, city: '', country: 'nepal', items: [friendAdd(-1000)] }).items;
    expect(earlier.find((i) => i.id === 'a')!.deleted).toBe(true); // clear wins → stays dead
    h2.unmount();
  });

  it('DORMANT: physically empties every day; NO deleted/rev/hlc anywhere (byte-identity)', async () => {
    state.remoteOn = false;
    const h = renderHookOf(useItinerary);
    await h.run((s) => s.addItem(D1, { id: 'a', title: 'Temple', category: 'cultural' }));
    await h.run((s) => s.addItem(D2, { id: 'b', title: 'Ramen', category: 'food' }));

    await h.run((s) => s.clearAll());

    expect(rawItin().flatMap((d) => d.items)).toEqual([]); // truly empty — no tombstones
    for (const d of rawItin()) {
      for (const it of d.items) {
        expect(it).not.toHaveProperty('rev');
        expect(it).not.toHaveProperty('hlc');
        expect(it).not.toHaveProperty('deleted');
      }
    }
    h.unmount();
  });
});

// ═══════════════════════════ EXPENSES ═══════════════════════════
describe('expenses.clearAll', () => {
  it('SYNC: tombstones every live expense in ONE push; reload stays cleared; non-vacuous', async () => {
    state.remoteOn = true;
    const h = renderHookOf(useExpenses);
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 100 }));
    await h.run((s) => s.addExpense({ leg: 'japan', category: 'hotel', amount: 200 }));
    expect(h.current.expenses).toHaveLength(2);

    state.expPush = [];
    await h.run((s) => s.clearAll());

    expect(state.expPush).toHaveLength(1); // ONE commit → ONE push
    const raw = rawExpenses();
    expect(raw.filter((e) => e.deleted !== true)).toHaveLength(0); // all tombstoned
    expect(raw.filter((e) => e.deleted === true)).toHaveLength(2);
    for (const t of raw) expect(typeof t.hlc).toBe('string');
    expect(h.current.expenses).toHaveLength(0); // UI empty

    // "Reload": fresh instance re-hydrates → still cleared.
    h.unmount();
    const h2 = renderHookOf(useExpenses);
    expect(h2.current.expenses).toHaveLength(0);

    // NON-VACUOUS (mergeItems): a friend's strictly-later edit to a cleared row survives; earlier stays dead.
    const tomb = rawExpenses()[0];
    const tHlc = parse(tomb.hlc!);
    const friendEdit = (dpt: number): Expense => ({
      ...tomb,
      deleted: false,
      hlc: serialize({ pt: tHlc.pt + dpt, ct: tHlc.ct, actor: 'Sushil' }),
    });
    const later = mergeItems([tomb], [friendEdit(1000)]);
    expect(later.find((e) => e.id === tomb.id)!.deleted).toBe(false);
    const earlier = mergeItems([tomb], [friendEdit(-1000)]);
    expect(earlier.find((e) => e.id === tomb.id)!.deleted).toBe(true);
    h2.unmount();
  });

  it('DORMANT: plain local [] wipe, no tombstones, no push (byte-identity)', async () => {
    state.remoteOn = false;
    const h = renderHookOf(useExpenses);
    await h.run((s) => s.addExpense({ leg: 'nepal', category: 'food', amount: 100 }));

    await h.run((s) => s.clearAll());

    expect(rawExpenses()).toEqual([]); // truly empty — no tombstones (byte-identity)
    h.unmount();
  });
});

// ═══════════════════════════ BUDGET ═══════════════════════════
describe('budget.reset', () => {
  it('SYNC: reset-to-seed stamps the changed field FRESH so it WINS the next mergeBudget (non-vacuous)', async () => {
    state.remoteOn = true;
    const h = renderHookOf(useBudget);
    // Set a leg budget, then reset.
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 20000 } })));
    const setHlc = rawBudget().sync!.fieldHlc['legBudgets.nepal'];
    expect(typeof setHlc).toBe('string');

    await h.run((s) => s.reset());

    const afterReset = rawBudget();
    expect(afterReset.legBudgets).toEqual({ nepal: 0, japan: 0 }); // back to seed
    expect(afterReset.rates).toEqual({ NPR: 138, JPY: 155 });
    const resetHlc = afterReset.sync!.fieldHlc['legBudgets.nepal'];
    expect(resetHlc > setHlc).toBe(true); // reset advanced the field's HLC (monotonic)

    // "Reload": fresh instance re-hydrates → still seed.
    h.unmount();
    const h2 = renderHookOf(useBudget);
    expect(h2.current.model.legBudgets).toEqual({ nepal: 0, japan: 0 });
    h2.unmount();

    // NON-VACUOUS: a peer still holding nepal=20000 at the OLDER hlc loses to the reset's 0.
    const resetFields = modelToFields(afterReset);
    const peer: BudgetFields = { 'legBudgets.nepal': { v: 20000, hlc: setHlc } };
    const merged = mergeBudget(resetFields, peer);
    expect(merged['legBudgets.nepal'].v).toBe(0); // reset WINS → stays cleared

    // CONTRAST (proves the stamp is what makes it stick): a naive wipe stamped with a SEED hlc LOSES.
    const naiveFields: BudgetFields = {
      ...resetFields,
      'legBudgets.nepal': { v: 0, hlc: seedHlcFromLegacy(undefined) },
    };
    const mergedNaive = mergeBudget(naiveFields, peer);
    expect(mergedNaive['legBudgets.nepal'].v).toBe(20000); // naive wipe is UNWOUND by the peer
  });

  it('DORMANT: reset writes the seed with NO sync.fieldHlc (byte-identity)', async () => {
    state.remoteOn = false;
    const h = renderHookOf(useBudget);
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 20000 } })));
    await h.run((s) => s.reset());

    const raw = rawBudget();
    expect('sync' in raw).toBe(false);
    expect(raw).toEqual({
      version: 1,
      homeCurrency: 'USD',
      rates: { NPR: 138, JPY: 155 },
      legBudgets: { nepal: 0, japan: 0 },
      categoryBudgets: {},
    });
    h.unmount();
  });
});

// ═══════════════════════════ JOURNAL ═══════════════════════════
describe('journal.clearAll (LOCAL ONLY — D-152)', () => {
  it('clears every entry locally and stays cleared on reload; no sync path exists', async () => {
    // Even with remote "on", the journal store carries no sync port — the wipe cannot propagate.
    state.remoteOn = true;
    const h = renderHookOf(useJournal);
    await h.run((s) => s.saveEntry('2026-12-10', { text: 'Landed in Kathmandu' }));
    await h.run((s) => s.saveEntry('2026-12-11', { text: 'Bhaktapur day' }));
    expect(h.current.entries).toHaveLength(2);

    await h.run((s) => s.clearAll());

    expect(rawJournal()).toEqual([]);
    expect(h.current.entries).toHaveLength(0);

    // "Reload": fresh instance re-hydrates → still cleared (key present, no reseed).
    h.unmount();
    const h2 = renderHookOf(useJournal);
    expect(h2.current.entries).toHaveLength(0);
    h2.unmount();
  });
});
