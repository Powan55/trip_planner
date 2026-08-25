// @vitest-environment jsdom
//
// #260 — `TravelExpenseQuickAdd` mounted for real (createRoot + act, the
// `visited-places-panel.test.tsx` harness) and driven through its own inline form, asserted on
// the DOM and on the REAL `useExpenses` store underneath it (localStorage under the gateway's
// `expenses` key — the same slot the budget panel and `ExpenseDialog` read).
//
// Also pins the TM-9 contract this component exists to satisfy: no `ExpenseDialog` import and no
// `document.body` portal anywhere in this file or the component under test.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import TravelExpenseQuickAdd from '@/components/travel-expense-quickadd';
import { useExpenses } from '@/hooks/use-expenses';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import type { Expense } from '@/core/budget/expenses';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEPAL_DAY = '2026-12-10'; // a Nepal day on the default date backbone
const JAPAN_DAY = '2026-12-25'; // a Japan day on the default date backbone

let container: HTMLDivElement;
let root: Root;

/**
 * The component is write-only — it renders no expense list of its own — so a remount cannot be
 * read back through its DOM. This inline reader renders the SAME `useExpenses` store the form
 * writes to, which is what turns the reload proof below into an assertion about production code
 * (hydrate-from-localStorage) rather than a second `localStorage.getItem`. Inline, no portal — the
 * TM-9 contract this file pins is untouched.
 */
function ExpenseReader() {
  const { expenses } = useExpenses();
  return (
    <ul data-testid="expense-reader">
      {expenses.map((e) => (
        <li key={e.id} data-testid={`expense-row-${e.id}`}>{`${e.leg}:${e.amount}`}</li>
      ))}
    </ul>
  );
}

async function mount(date: string): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <>
        <TravelExpenseQuickAdd date={date} />
        <ExpenseReader />
      </>,
    );
  });
  return container;
}

const at = <T extends HTMLElement>(id: string): T | null =>
  container.querySelector<T>(`[data-testid="${id}"]`);

/** Set a controlled input's value the way a user would — through React's own value tracker. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function rawOnDisk(): Expense[] {
  const blob = window.localStorage.getItem(STORAGE_KEYS.expenses);
  return blob ? (JSON.parse(blob) as Expense[]) : [];
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TravelExpenseQuickAdd (#260)', () => {
  it('collapsed by default, reveals an inline form on trigger — no dialog, no portal', async () => {
    await mount(NEPAL_DAY);

    expect(at('travel-expense-quickadd-trigger')).not.toBeNull();
    expect(at('travel-expense-quickadd-amount')).toBeNull();
    // Never mounts a body-level dialog: no [role="dialog"] anywhere in the document for this slot.
    expect(document.querySelector('[data-testid="expense-dialog"]')).toBeNull();

    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-trigger')!.click();
    });
    expect(at('travel-expense-quickadd-amount')).not.toBeNull();
    expect(document.querySelector('[data-testid="expense-dialog"]')).toBeNull();
  });

  it('logs an amount + category to the REAL expense store, leg auto-derived from the viewed day', async () => {
    await mount(NEPAL_DAY);
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-trigger')!.click();
    });

    await act(async () => setValue(at<HTMLInputElement>('travel-expense-quickadd-amount')!, '450'));
    await act(async () =>
      setValue(at<HTMLSelectElement>('travel-expense-quickadd-category')!, 'food'),
    );
    await act(async () => setValue(at<HTMLInputElement>('travel-expense-quickadd-note')!, 'Dal bhat'));
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-save')!.click();
    });

    const rows = rawOnDisk();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      leg: 'nepal',
      category: 'food',
      amount: 450,
      date: NEPAL_DAY,
      note: 'Dal bhat',
    });

    // Stays open and clears its fields, ready for the next one (mirrors TravelLogDifferent).
    expect(at<HTMLInputElement>('travel-expense-quickadd-amount')!.value).toBe('');
    expect(at<HTMLInputElement>('travel-expense-quickadd-note')!.value).toBe('');
  });

  it('derives the Japan leg for a Japan-phase day, with no leg picker to get wrong', async () => {
    await mount(JAPAN_DAY);
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-trigger')!.click();
    });
    await act(async () => setValue(at<HTMLInputElement>('travel-expense-quickadd-amount')!, '1200'));
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-save')!.click();
    });

    const rows = rawOnDisk();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leg: 'japan', amount: 1200, date: JAPAN_DAY });
  });

  it('Save stays disabled with no amount, and a zero/blank amount writes nothing', async () => {
    await mount(NEPAL_DAY);
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-trigger')!.click();
    });

    const save = at<HTMLButtonElement>('travel-expense-quickadd-save')!;
    expect(save.disabled).toBe(true);

    await act(async () => setValue(at<HTMLInputElement>('travel-expense-quickadd-amount')!, '0'));
    expect(save.disabled).toBe(true);
    await act(async () => {
      save.click();
    });
    expect(rawOnDisk()).toHaveLength(0);
  });

  it('survives a remount (the localStorage reload proof)', async () => {
    await mount(NEPAL_DAY);
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-trigger')!.click();
    });
    await act(async () => setValue(at<HTMLInputElement>('travel-expense-quickadd-amount')!, '99'));
    await act(async () => {
      at<HTMLButtonElement>('travel-expense-quickadd-save')!.click();
    });
    expect(rawOnDisk()).toHaveLength(1);
    const addedId = rawOnDisk()[0].id;
    expect(at(`expense-row-${addedId}`)).not.toBeNull();

    // Unmount + remount fresh (simulates a reload): the store re-hydrates from the same slot.
    act(() => root.unmount());
    container.remove();
    await mount(NEPAL_DAY);

    // Read back through the FRESH mount's DOM, the way packing-checklist.test.tsx does. Asserting
    // `rawOnDisk()` on both sides of the remount runs no production code between the write and the
    // check, so it stays green with the remount deleted — which is the whole thing being proven.
    const row = at(`expense-row-${addedId}`);
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('nepal:99');
    // And the mount really is fresh: the form is collapsed again, not the one left open above.
    expect(at('travel-expense-quickadd-trigger')).not.toBeNull();
    expect(at('travel-expense-quickadd-amount')).toBeNull();

    expect(rawOnDisk()[0]).toMatchObject({ amount: 99, leg: 'nepal' });
  });
});
