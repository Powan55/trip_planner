/**
 * Expense domain + the pure aggregator that feeds the budget rollup (expense LOGGING).
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no id generation, no storage. `import type` from `@/lib/trip-data`
 * (the `ItineraryCategory` union) and from `./model` (the `Leg` / `SpentInput` shapes) follows the
 * crud.ts/model.ts precedent — a type-only import drags no runtime in. Every function is TOTAL
 * (a bad / NaN / negative / missing input degrades to a safe value, never a throw), so the store
 * can never crash on a corrupt slot and the panel can never render `NaN`.
 *
 * ── The rollup seam (the whole point on the math side) ────────────────────────────────────
 * The budget model's `rollUp(model, spent?: SpentInput)` already returns spent/remaining on every
 * leg + category line + the grand total. This module's `expensesToSpent(expenses)` computes that
 * `SpentInput` by summing logged expenses per leg + per (leg, category). Amounts are stored in
 * each leg's LOCAL currency, mirroring the budget model, so the aggregator needs NO
 * currency conversion — it just sums. The rollup shape is unchanged; this module only consumes the seam.
 *
 * ── id / timestamp injection (the pure-core pattern) ──────────────────────────────────────
 * The CRUD transforms (`addExpense` / `updateExpense` / `removeExpense`) are pure `Expense[]`
 * functions: the CALLER (the React hook) supplies the new `id` + `createdAt` timestamp, so this
 * core stays deterministic and unit-testable without stubbing a clock or a random source.
 */

import type { ItineraryCategory } from '@/lib/trip-data';
import type { Leg, SpentInput } from '@/core/budget/model';
import { BUDGET_CATEGORIES, safeAmount } from '@/core/budget/model';

// ── The Expense shape (the store persists an `Expense[]`) ────────────────────────────────
/**
 * A single logged expense. Amounts are in the LEG's LOCAL currency (Nepal → NPR, Japan → JPY),
 * matching the budget model so `expensesToSpent` sums with no conversion. `id` + `createdAt` are
 * supplied by the caller (injection — keeps the pure transforms deterministic). `date` / `note`
 * are optional.
 */
export interface Expense {
  /** Stable unique id — injected by the caller (the hook uses a monotonic browser id). */
  id: string;
  /** 'nepal' | 'japan' — === the budget model's Leg. */
  leg: Leg;
  /** One of the 10 canonical ItineraryCategory values. */
  category: ItineraryCategory;
  /** Amount in the LEG's local currency (NPR / JPY). Sanitized non-negative finite. */
  amount: number;
  /** Optional 'YYYY-MM-DD' the expense is attributed to (the logged/selected day). */
  date?: string;
  /** Optional short label. */
  note?: string;
  /** ISO timestamp for ordering the list — injected by the caller. */
  createdAt: string;
}

// The two legs, in a stable order.
const LEGS: readonly Leg[] = ['nepal', 'japan'] as const;

/** Type guard: the value is one of the two legs. */
function isLeg(value: unknown): value is Leg {
  return value === 'nepal' || value === 'japan';
}

/** Type guard: the value is one of the 10 canonical categories. */
function isCategory(value: unknown): value is ItineraryCategory {
  return typeof value === 'string' && (BUDGET_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Coerce any parsed-from-storage / caller-supplied value into a valid `Expense`, or `null` when
 * it is too malformed to salvage (missing/invalid id, leg, or category — those have no safe
 * default). A bad amount degrades to 0 (via `safeAmount`); `date` / `note` drop when not usable;
 * `createdAt` falls back to `''` (kept sortable-last, never a throw). TOTAL.
 */
export function sanitizeExpense(value: unknown): Expense | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof Expense, unknown>>;

  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : null;
  if (id === null) return null;
  if (!isLeg(v.leg)) return null;
  if (!isCategory(v.category)) return null;

  const expense: Expense = {
    id,
    leg: v.leg,
    category: v.category,
    amount: safeAmount(v.amount),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };

  // `date` must look like 'YYYY-MM-DD'; anything else is dropped (optional field).
  if (typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
    expense.date = v.date;
  }
  // `note` is a trimmed non-empty string or dropped.
  if (typeof v.note === 'string' && v.note.trim().length > 0) {
    expense.note = v.note.trim();
  }

  return expense;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `Expense[]`: drop anything that is
 * not an array, and drop each entry that `sanitizeExpense` cannot salvage. TOTAL — never throws.
 */
export function sanitizeExpenses(value: unknown): Expense[] {
  if (!Array.isArray(value)) return [];
  const out: Expense[] = [];
  for (const entry of value) {
    const e = sanitizeExpense(entry);
    if (e !== null) out.push(e);
  }
  return out;
}

// ── The aggregator (the `SpentInput` seam consumer) ──────────────────────────────────────
/**
 * Sum logged expenses into the `SpentInput` shape `rollUp(model, spent?)` already accepts:
 * `byLeg[leg]` = total spent on that leg, `byCategory[leg][category]` = total on that (leg,
 * category). Amounts are already leg-local, so this is a plain sum — no conversion.
 * Malformed entries are ignored (each amount goes through `safeAmount`; an entry with an invalid
 * leg/category is skipped). Empty input → `{}` (matches the "nothing spent" state exactly,
 * so `remaining === budget`). PURE + TOTAL.
 */
export function expensesToSpent(expenses: readonly Expense[] | null | undefined): SpentInput {
  if (!Array.isArray(expenses) || expenses.length === 0) return {};

  const byLeg: Partial<Record<Leg, number>> = {};
  const byCategory: Partial<Record<Leg, Partial<Record<ItineraryCategory, number>>>> = {};

  for (const e of expenses) {
    // Defensive on a runtime-untyped list (a corrupt slot could smuggle a bad entry past the
    // `Expense[]` type). A non-object / invalid leg / invalid category contributes nothing.
    if (e === null || typeof e !== 'object') continue;
    const leg = e.leg;
    const category = e.category;
    if (!isLeg(leg)) continue;
    if (!isCategory(category)) continue;
    const amount = safeAmount(e.amount);
    if (amount <= 0) continue; // a 0/negative/bad amount contributes nothing

    byLeg[leg] = (byLeg[leg] ?? 0) + amount;

    const legCats = byCategory[leg] ?? (byCategory[leg] = {});
    legCats[category] = (legCats[category] ?? 0) + amount;
  }

  const spent: SpentInput = {};
  if (Object.keys(byLeg).length > 0) spent.byLeg = byLeg;
  if (Object.keys(byCategory).length > 0) spent.byCategory = byCategory;
  return spent;
}

// ── Pure CRUD transforms (id + timestamp INJECTED by the caller) ─────────────────────────
/**
 * The fields the caller provides when logging a NEW expense — everything except the injected
 * `id` + `createdAt` (which the pure core must not generate). `amount` is sanitized on add.
 */
export type NewExpenseInput = Omit<Expense, 'id' | 'createdAt'>;

/**
 * Append a sanitized new expense to the list. The caller injects `id` + `createdAt` (so the core
 * stays deterministic). Newest-first is NOT imposed here — the list keeps insertion order; the UI
 * sorts by `createdAt` when it wants recency. Returns a NEW array (never mutates). TOTAL: a
 * malformed input (invalid leg/category) is dropped, returning the list unchanged.
 */
export function addExpense(
  expenses: readonly Expense[],
  input: NewExpenseInput,
  id: string,
  createdAt: string,
): Expense[] {
  const candidate = sanitizeExpense({ ...input, id, createdAt });
  if (candidate === null) return [...expenses];
  return [...expenses, candidate];
}

/**
 * Update an existing expense by id with a partial patch (any of leg/category/amount/date/note).
 * The `id` + `createdAt` are preserved (an edit never re-times or re-ids the entry). Returns a NEW
 * array; a non-matching id is a no-op (list returned unchanged). TOTAL: if the patch would make
 * the entry unsalvageable it is left unchanged.
 */
export function updateExpense(
  expenses: readonly Expense[],
  id: string,
  patch: Partial<NewExpenseInput>,
): Expense[] {
  return expenses.map((e) => {
    if (e.id !== id) return e;
    const merged = sanitizeExpense({ ...e, ...patch, id: e.id, createdAt: e.createdAt });
    return merged ?? e;
  });
}

/** Remove an expense by id. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
export function removeExpense(expenses: readonly Expense[], id: string): Expense[] {
  return expenses.filter((e) => e.id !== id);
}
