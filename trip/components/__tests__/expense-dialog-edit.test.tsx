// @vitest-environment jsdom
//
// #785: the amount bound applies to what the user TYPES. An imported expense the bound would
// reject (huge, fractional JPY) must still save a note-only edit with its amount untouched.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const updateExpense = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/use-expenses', () => ({
  useExpenses: () => ({ addExpense: vi.fn(), updateExpense, expenses: [] }),
}));
vi.mock('@/hooks/use-active-traveler', () => ({ useActiveTraveler: () => ({ traveler: null }) }));
vi.mock('@/components/photo-attach', () => ({ default: () => null }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileTap, transition, layout, ...rest } = p;
    return rest;
  };
  return { m: { div: (p: any) => React.createElement('div', strip(p)) } };
});

import ExpenseDialog from '@/components/expense-dialog';
import type { Expense } from '@/core/budget/expenses';

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

function type(el: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  updateExpense.mockClear();
});

function open(amount: number, leg: Expense['leg']) {
  const expense: Expense = { id: 'e1', leg, category: 'food', amount, createdAt: '2026-12-10T10:00:00.000Z' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(ExpenseDialog, { open: true, presetLeg: leg, expense, onClose: vi.fn() }));
  });
}

describe('ExpenseDialog edit keeps an untouched amount (#785)', () => {
  it.each([
    ['1e15 (over the input max)', 1e15, 'nepal'],
    ['1500.5 JPY (would round to 1501)', 1500.5, 'japan'],
  ] as const)('note-only edit saves %s unchanged', (_n, amount, leg) => {
    open(amount, leg);
    type(q('expense-note-input'), 'lunch');
    const save = q('expense-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    act(() => save.click());
    expect(updateExpense).toHaveBeenCalledTimes(1);
    expect(updateExpense.mock.calls[0][1].amount).toBe(amount);
  });

  it('a retyped oversized amount is blocked with a visible hint', () => {
    open(500, 'nepal');
    type(q('expense-amount-input'), '1e20');
    expect((q('expense-save') as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('up to');
  });
});
