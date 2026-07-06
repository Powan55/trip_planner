/**
 * Budget persistence adapter — the ONE load/save path for the `BudgetModel`,
 * over the typed storage gateway's key-10 `budgetStore`. Kept tiny + framework-free:
 * it wires the byte-transport gateway to the domain's `normalizeModel`, so a corrupt
 * or partially-valid on-disk slot always resolves to a valid model (the "make it safe" policy
 * lives in the domain, not the transport). The panel + the unit round-trip both go through here.
 *
 * `loadBudget()` returns a fully-normalized `BudgetModel`:
 *   - key absent / SSR / corrupt JSON → the gateway hands back `DEFAULT_BUDGET`, which is
 *     already valid (a fresh visitor sees the seeded defaults);
 *   - key present but partially valid → `normalizeModel` keeps good fields, seed-defaults the rest.
 * `saveBudget(model)` normalizes then writes the whole model as JSON. Never throws (the gateway
 * swallows quota / disabled-storage / cyclic-value failures).
 */

import { budgetStore, expensesStore } from '@/core/storage/gateway';
import { DEFAULT_BUDGET, normalizeModel, type BudgetModel } from '@/core/budget/model';
import { sanitizeExpenses, type Expense } from '@/core/budget/expenses';

/** Load + normalize the persisted budget model (seeded default when absent / SSR / corrupt). */
export function loadBudget(): BudgetModel {
  const raw = budgetStore.get<unknown>(DEFAULT_BUDGET);
  return normalizeModel(raw);
}

/** Normalize + persist the whole budget model. No-op / never-throws under SSR or storage failure. */
export function saveBudget(model: BudgetModel): void {
  budgetStore.set<BudgetModel>(normalizeModel(model));
}

// ── Expenses (gateway key 11) — mirrors the budget adapter exactly ────────────

/**
 * Load + sanitize the persisted `Expense[]` (empty list when absent / SSR / corrupt). The
 * gateway hands back the raw parsed slot (or `[]` on any failure); `sanitizeExpenses` drops any
 * entry too malformed to salvage, so the caller always receives a valid list. Never throws.
 */
export function loadExpenses(): Expense[] {
  const raw = expensesStore.get<unknown>([]);
  return sanitizeExpenses(raw);
}

/**
 * Sanitize + persist the whole expense list as JSON. No-op / never-throws under SSR or storage
 * failure (the gateway swallows quota / disabled-storage). Sanitizing on write keeps a corrupt
 * caller value from ever reaching disk.
 */
export function saveExpenses(expenses: Expense[]): void {
  expensesStore.set<Expense[]>(sanitizeExpenses(expenses));
}
