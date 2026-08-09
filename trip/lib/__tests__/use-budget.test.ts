// @vitest-environment jsdom
//
// S140 — unit coverage for `use-budget`, the greenfield factory-backed budget
// hook the budget panel now consumes. Rendered for real (react-dom/client + act shim). Proves:
//   - hydrates the persisted BudgetModel (or the seeded DEFAULT when absent — D-018 fresh visitor);
//   - `commit` persists through `saveBudget` and survives a reload (the budget hard guarantee);
//   - a second `useBudget()` instance updates live on the `'budget:changed'` event (D-026), which
//     is the reactivity the panel gains from the migration;
//   - a blank leg budget (0) round-trips idempotently (0 → 0), so the panel's "cleared field shows
//     blank" UX is byte-identical for leg/category amounts.

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useBudget, type BudgetStore } from '@/hooks/use-budget';
import { loadBudget } from '@/core/budget/storage';
import { DEFAULT_BUDGET, SEED_RATES, type BudgetModel } from '@/core/budget/model';

interface Handle {
  current: BudgetStore;
  run: (fn: (s: BudgetStore) => void) => Promise<void>;
  remount: () => Promise<void>;
  unmount: () => void;
}

function render(): Handle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
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
    async remount() {
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

const sample: BudgetModel = {
  version: 1,
  homeCurrency: 'JPY',
  rates: { NPR: 140, JPY: 150 },
  legBudgets: { nepal: 13800, japan: 31000 },
  categoryBudgets: { nepal: { food: 2760 } },
};

describe('use-budget — factory-backed reactive budget store (S140, D-148)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('a fresh visitor hydrates the seeded DEFAULT budget (D-018)', async () => {
    const h = render();
    expect(h.current.hydrated).toBe(true);
    expect(h.current.model).toEqual(DEFAULT_BUDGET);
    expect(h.current.model.rates).toEqual(SEED_RATES);
    h.unmount();
  });

  it('commit persists through saveBudget and survives a reload (the budget hard guarantee)', async () => {
    const h = render();
    await h.run((s) => s.commit(() => sample));
    expect(loadBudget()).toEqual(sample);

    await h.remount(); // unmount + remount = a reload (re-reads localStorage)
    expect(h.current.model).toEqual(sample);
    h.unmount();
  });

  it('a second instance updates live on the budget:changed event (D-026 reactivity)', async () => {
    const a = render();
    const b = render();
    await a.run((s) => s.commit(() => sample));
    expect(a.current.model).toEqual(sample);
    expect(b.current.model).toEqual(sample); // b re-read on a's dispatched event
    a.unmount();
    b.unmount();
  });

  it('a blank (0) leg budget round-trips idempotently — the panel blank UX is preserved for amounts', async () => {
    const h = render();
    // Set a value, then clear it back to 0 (the panel's "blank field" state for a leg/category amount).
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 20000 } })));
    await h.run((s) => s.commit((cur) => ({ ...cur, legBudgets: { ...cur.legBudgets, nepal: 0 } })));
    // 0 survives the save→reread round-trip (idempotent), so the field stays blank (not snapped).
    expect(h.current.model.legBudgets.nepal).toBe(0);
    expect(loadBudget().legBudgets.nepal).toBe(0);
    h.unmount();
  });
});
