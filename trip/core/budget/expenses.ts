/**
 * Expense domain + the pure aggregator that feeds budget rollup (slice —
 * expense LOGGING).
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no next,
 * no fetch, no clock, no id generation, no storage. `import type` from `@/lib/trip-data`
 * (the `ItineraryCategory` union) and from `./model` (the `Leg` / `SpentInput` shapes) is the
 * crud.ts/model.ts precedent — a type-only import drags no runtime in. Every function is TOTAL
 * (a bad / NaN / negative / missing input degrades to a safe value, never a throw), so the store
 * can never crash on a corrupt slot and the panel can never render `NaN`.
 *
 * ── The seam (the whole point on the math side) ──────────────────────────────────────
 * built `rollUp(model, spent?: SpentInput)` which already returns spent/remaining on every
 * leg + category line + the grand total. This module's `expensesToSpent(expenses)` computes that
 * `SpentInput` by summing logged expenses per leg + per (leg, category). Amounts are stored in
 * each leg's LOCAL currency, mirroring the budget model, so the aggregator needs NO
 * currency conversion — it just sums. The rollup shape is unchanged; only consumes the seam.
 *
 * ── id / timestamp injection ──────────────────────────────────
 * The CRUD transforms (`addExpense` / `updateExpense` / `removeExpense`) are pure `Expense[]`
 * functions: the CALLER (the React hook) supplies the new `id` + `createdAt` timestamp, so this
 * core stays deterministic and unit-testable without stubbing a clock or a random source.
 */

import type { ItineraryCategory } from '@/lib/trip-data';
import type { Leg, SpentInput } from '@/core/budget/model';
import { BUDGET_CATEGORIES, safeAmount } from '@/core/budget/model';

// ── The Expense shape (gateway key 11 stores an `Expense[]`) ─────────────────────────────
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

  // ── Split / settlement fields — ADDITIVE + OPTIONAL, dormant-absent ───────────────
  // Who owes whom. Both absent = the FAST PATH (paid by me, not split) = byte-identical to a pre-
  // expense. They ride the `mergeItems` row merge for free (just more row fields) and
  // are settlement-only: they do NOT affect `amount` or `expensesToSpent` — an expense's amount
  // still counts fully toward spend regardless of split.
  /** TRAVELERS id who fronted the money. Absent ⇒ the current traveler ("me"). */
  paidBy?: string;
  /** TRAVELERS ids the cost is shared EVENLY among. Absent ⇒ not split (no settlement row). */
  split?: string[];

  // ── Sync v2 fields — ALL additive + optional ──────────────
  // Written ONLY when remote sync is configured (the hook gates on `isRemoteConfigured()`);
  // a dormant expense carries NONE of these, so the dormant on-disk bytes stay byte-identical
  // Old clients ignore unknown fields. `sanitizeExpense` PASSES THEM THROUGH
  // (a load-bearing line — silently stripping `hlc` would break merge ordering).
  /** Monotonic per-row revision counter; starts at 1 on create (sync only). */
  rev?: number;
  /** Hybrid Logical Clock stamp (serialized) — the primary cross-client merge order key. */
  hlc?: string;
  /** Tombstone; true ⇒ deleted-but-retained so the delete can propagate + win (sync only). */
  deleted?: boolean;
  /** "Logged by" attribution — first author wins. Set only when a traveler is active. */
  createdBy?: string;
  /** Last editor's display name. Set only when a traveler is active. */
  updatedBy?: string;
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

  // ── Split passthrough — additive; absent on a fast-path expense ⇒ byte-identical ──
  // A non-empty string `paidBy`; a `split` reduced to its valid non-empty-string members (an empty
  // result drops the field, so `[]` never persists ⇒ a no-member split is just the fast path).
  if (typeof v.paidBy === 'string' && v.paidBy.length > 0) expense.paidBy = v.paidBy;
  if (Array.isArray(v.split)) {
    const members = v.split.filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (members.length > 0) expense.split = members;
  }

  // ── Sync v2 passthrough ──────────────────────────────
  // Pass the additive sync/attribution fields through UNCHANGED when present. Dropping `hlc`
  // here would break merge ordering and violate stamped-bytes expectation. A dormant
  // expense has none of these ⇒ nothing is added ⇒ byte-identical.
  if (typeof v.rev === 'number' && Number.isFinite(v.rev)) expense.rev = v.rev;
  if (typeof v.hlc === 'string') expense.hlc = v.hlc;
  if (typeof v.deleted === 'boolean') expense.deleted = v.deleted;
  if (typeof v.createdBy === 'string' && v.createdBy.length > 0) expense.createdBy = v.createdBy;
  if (typeof v.updatedBy === 'string' && v.updatedBy.length > 0) expense.updatedBy = v.updatedBy;

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

// ── The aggregator ─────────────────────────────────
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

// ── Pure CRUD transforms ─────────────────
/**
 * The fields the caller provides when logging a NEW expense — everything except the injected
 * `id` + `createdAt` (which the pure core must not generate). `amount` is sanitized on add.
 */
export type NewExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'rev' | 'hlc' | 'deleted' | 'createdBy' | 'updatedBy'>;

/**
 * A boundary stamper the caller injects to apply attribution (createdBy/updatedBy) + the Sync-v2
 * ordering fields (rev/hlc/deleted) to a row — the same seam pattern as the itinerary core's
 * `ItemStamper`. Absent ⇒ the row is returned as-is (dormant / no-name), so the
 * pure transforms stay deterministic and byte-identical when nothing is stamped.
 */
export type ExpenseStamper = (expense: Expense) => Expense;

const noStamp: ExpenseStamper = (e) => e;

/**
 * Append a sanitized new expense to the list. The caller injects `id` + `createdAt` (so the core
 * stays deterministic) and an optional `stamp`. Newest-first is
 * NOT imposed here — the list keeps insertion order; the UI sorts by `createdAt`. Returns a NEW
 * array (never mutates). TOTAL: a malformed input (invalid leg/category) is dropped, returning the
 * list unchanged.
 */
export function addExpense(
  expenses: readonly Expense[],
  input: NewExpenseInput,
  id: string,
  createdAt: string,
  stamp: ExpenseStamper = noStamp,
): Expense[] {
  const candidate = sanitizeExpense({ ...input, id, createdAt });
  if (candidate === null) return [...expenses];
  return [...expenses, stamp(candidate)];
}

/**
 * Update an existing expense by id with a partial patch (any of leg/category/amount/date/note),
 * then apply the optional `stamp` (attribution + sync fields —; a tombstone under sync is an
 * `updateExpense` with an empty patch + a delete stamper, mirroring the itinerary `removeItem`
 * sync path). The `id` + `createdAt` are preserved. Returns a NEW array; a non-matching id is a
 * no-op. TOTAL: if the patch would make the entry unsalvageable it is left unchanged.
 */
export function updateExpense(
  expenses: readonly Expense[],
  id: string,
  patch: Partial<NewExpenseInput>,
  stamp: ExpenseStamper = noStamp,
): Expense[] {
  return expenses.map((e) => {
    if (e.id !== id) return e;
    const merged = sanitizeExpense({ ...e, ...patch, id: e.id, createdAt: e.createdAt });
    return merged ? stamp(merged) : e;
  });
}

/** Remove an expense by id. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
export function removeExpense(expenses: readonly Expense[], id: string): Expense[] {
  return expenses.filter((e) => e.id !== id);
}
