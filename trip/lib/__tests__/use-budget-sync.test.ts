// @vitest-environment jsdom
//
// S143 — WIRED-behavior unit suite for the budget-sync store changes in hooks/use-budget.ts,
// exercised by RENDERING the real hook (a tiny renderHook shim over react-dom/client + act — no new
// dependency). The CONTRAST between the two regimes is the D-038 dormant-build byte-identity gate:
//
//   SYNC ON  (isRemoteConfigured() === true):
//     - a field edit stamps sync.fieldHlc for exactly the changed leaf path(s); an unchanged commit
//       stamps nothing; a later edit ADVANCES that path's HLC (monotonic).
//
//   DORMANT (isRemoteConfigured() === false):
//     - NO sync.fieldHlc is ever written — the on-disk model is byte-for-byte S140 (D-038).
//
// D-038 (dormant gate), D-149 (per-field HLC) cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { BudgetStore } from '@/hooks/use-budget';
import type { BudgetModel } from '@/core/budget/model';

const stateT = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => stateT.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
// Never let the sync fan-out touch firebase in this unit suite: stub the SyncPort to no-ops.
vi.mock('@/lib/budget-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/budget-ports')>();
  return {
    ...orig,
    budgetSyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => stateT.remoteOn,
    },
  };
});
// A signed-in traveler so actor() is a real name (drives the hlc actor).
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useBudget } from '@/hooks/use-budget';
import { STORAGE_KEYS } from '@/core/storage/gateway';

interface HookHandle {
  current: BudgetStore;
  run: (fn: (s: BudgetStore) => void) => Promise<void>;
  unmount: () => void;
}

function renderBudget(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref = { current: null as unknown as BudgetStore };
  function Probe() {
    ref.current = useBudget();
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

/** Read the RAW on-disk budget model. */
function rawOnDisk(): BudgetModel {
  const blob = localStorage.getItem(STORAGE_KEYS.budget);
  return JSON.parse(blob as string) as BudgetModel;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SYNC ON — a field edit stamps sync.fieldHlc for exactly the changed path', () => {
  beforeEach(() => {
    stateT.remoteOn = true;
  });

  it('editing the nepal leg budget stamps legBudgets.nepal; a later edit advances it', async () => {
    const h = renderBudget();
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 20000 } })));
    const first = rawOnDisk().sync!.fieldHlc['legBudgets.nepal'];
    expect(typeof first).toBe('string');
    // Only the changed path is stamped (rates untouched).
    expect(rawOnDisk().sync!.fieldHlc['rates.NPR']).toBeUndefined();

    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 25000 } })));
    const second = rawOnDisk().sync!.fieldHlc['legBudgets.nepal'];
    expect(second > first).toBe(true); // monotonic advance
    h.unmount();
  });

  it('a clear (category set→unset) stamps the cleared path so the delete propagates', async () => {
    const h = renderBudget();
    await h.run((s) => s.commit((cur) => ({ ...cur, categoryBudgets: { nepal: { food: 2760 } } })));
    expect(rawOnDisk().sync!.fieldHlc['categoryBudgets.nepal.food']).toBeDefined();
    await h.run((s) => s.commit((cur) => ({ ...cur, categoryBudgets: { nepal: {} } })));
    // The path is still stamped (now a cleared field) — the on-disk model no longer carries the value.
    expect(rawOnDisk().sync!.fieldHlc['categoryBudgets.nepal.food']).toBeDefined();
    expect(rawOnDisk().categoryBudgets.nepal?.food).toBeUndefined();
    h.unmount();
  });
});

describe('DORMANT — no stamping, byte-for-byte S140 (D-038)', () => {
  beforeEach(() => {
    stateT.remoteOn = false;
  });

  it('a field edit writes NO sync.fieldHlc (on-disk model is byte-identical to S140)', async () => {
    const h = renderBudget();
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 20000 } })));
    const raw = rawOnDisk();
    expect('sync' in raw).toBe(false);
    expect(raw).toEqual({
      version: 1,
      homeCurrency: 'USD',
      rates: { NPR: 138, JPY: 155 },
      legBudgets: { nepal: 20000, japan: 0 },
      categoryBudgets: {},
    });
    h.unmount();
  });
});
