/**
 * Expense domain + the pure aggregator that feeds budget rollup ( —
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
import { BUDGET_CATEGORIES, isLeg, safeAmount } from '@/core/budget/model';

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
  /**
   * === the budget model's `Leg` (a `string`; 'nepal' | 'japan' for the default pack, 'main' for a
   * custom single-leg trip). Kept VERBATIM by `sanitizeExpense` even when the active pack does not
   * know it — see that function for why, and where such a row is excluded instead.
   */
  leg: Leg;
  /**
   * One of the 10 canonical `ItineraryCategory` values in the common case, but RETAINED VERBATIM
   * when it is not (#150) — a forward category from a newer build is not corruption, the same
   * reasoning `leg` already gets below. Consumers that index a category-keyed map (e.g.
   * `CATEGORY_COLORS`) must fall back for a value outside the known 10; `isCategory` (below)
   * is the guard, but it now gates AGGREGATION only, not sanitize-time retention.
   */
  category: string;
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
  /**
   * TRAVELERS id who fronted the money. Absent ⇒ UNKNOWN, not "me": `settle()` skips a split row
   * that has no payer rather than attributing it to whoever is signed in (D-333). The expense
   * dialog prefills the picker with the active traveller, but that is an editing default the user
   * can see and change — it is not what an absent field means once stored.
   */
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

/**
 * Type guard: the value is one of the 10 canonical categories. Used ONLY by the aggregator
 * (`expensesToSpent`) to keep a foreign category out of a `BUDGET_CATEGORIES`-shaped total —
 * `sanitizeExpense` no longer calls this to reject a row (#150).
 */
function isCategory(value: unknown): value is ItineraryCategory {
  return typeof value === 'string' && (BUDGET_CATEGORIES as readonly string[]).includes(value);
}

/** Read-boundary options. Absent ⇒ STRICT: a caller that does not ask gets the allowlist rebuild. */
export interface SanitizeOptions {
  /**
   * Retain keys this build does not declare (#138). Set ONLY on the REMOTE read, where the
   * sanitized row is merged and written straight back to Firestore. Never on a LOCAL path — the
   * rebuild is what makes D-159's zero-egress guarantee structural rather than a discipline.
   */
  keepUnknownKeys?: boolean;
}


/**
 * Coerce any parsed-from-storage / caller-supplied value into a valid `Expense`, or `null` when it
 * is too malformed to salvage — that is now exactly a missing/non-string `id`, `leg`, or
 * `category`. Unlike `leg`/`category`, `id` has no verbatim-retention path: an id is how a row is
 * addressed (update/delete/dedupe), so a missing one is not a value to keep, it is the row having
 * no identity.
 *
 * ── `leg` and `category` are RETAINED VERBATIM, not validated against a known set ─────────────
 * Any non-empty string is kept as-is. This used to be `if (!isLeg(v.leg)) return null`, and that
 * was a data-loss bug, not a guard: `LEGS` is resolved ONCE at module load from whatever pack the
 * active-trip pointer names, while the storage slot OUTLIVES that resolution. A joiner who logs
 * expenses before the trip's meta doc arrives, a whole-trip backup restored under a different
 * pack, and an expenses-only import all hand this function rows whose leg this build does not
 * recognise. Rejecting them was not "hiding a row" — `saveExpenses` sanitizes on WRITE as well as
 * read, so the very next commit or remote snapshot deleted them permanently, silently, and the
 * restore path still reported success because a fully-emptied `[]` is not `null`.
 *
 * An unknown leg is INERT, not fatal. It is excluded exactly where it would otherwise corrupt a
 * number — in the AGGREGATES: `expensesToSpent` and `expensesByDate` skip a row whose leg fails
 * `isLeg`, and `settle` excludes it structurally by iterating `LEGS`. So a foreign-leg row survives
 * to be re-homed later without ever inflating a total, a per-day bucket, or a settlement balance.
 *
 * `category` gets the identical treatment for the identical reason (#150, deferred out of #138):
 * `BUDGET_CATEGORIES` is a fixed 10-value list this build ships with, but a peer running a newer
 * build can log a category this build has never heard of — most concretely over remote sync, where
 * `chunkDocToRows` (`lib/expenses-remote.ts`) runs this same sanitizer on every snapshot and the
 * merged result is written straight back up (see `keepUnknownKeys` below). Hard-rejecting dropped
 * the WHOLE row, amount included, not just the category label. `expensesToSpent` keeps its own
 * `isCategory` gate (below) so a foreign category is excluded from the per-category rollup — same
 * "INERT, not fatal" shape as an unknown leg, and unlike leg it costs nothing structural: category
 * is a display/rollup grouping only, never a currency or identity key. Unlike the leg case, category
 * has no remote-partition caveat below — `chunkDocToRows` partitions by LEG only, so a foreign
 * category inside a recognised leg round-trips through remote sync same as any other field.
 *
 * ── The retention is LOCAL, and that boundary is exact ────────────────────────────────────
 * It holds for `loadExpenses` / `saveExpenses`, and therefore for a whole-trip restore and an
 * expenses-only import. It does NOT survive remote sync: `subscribeRemoteExpenses`' `applySnapshot`
 * rebuilds the entire local slot by partitioning on its own hardcoded leg list
 * (`lib/expenses-remote.ts:35`) and persists that result, so on a remote-synced trip a foreign-leg
 * row is absent from the rebuilt list and erased from the slot on the first snapshot. (This applies
 * to `leg` only — see the `category` paragraph above.)
 *
 * A bad amount degrades to 0 (via `safeAmount`); `date` / `note` drop when not usable;
 * `createdAt` falls back to `''` (kept sortable-last, never a throw). TOTAL.
 *
 * ── UNDECLARED keys: DROPPED by default, kept only for `keepUnknownKeys` (#138) ────────────
 * The default is the field-by-field rebuild this has always been — an allowlist, and D-159's
 * zero-egress guarantee is structural precisely because of it (a rogue or legacy row carrying a
 * `photoIds`/`photo`/`receipt` cannot survive a rebuild that never copies it). Every LOCAL caller
 * takes this default: `loadExpenses`/`saveExpenses`, `lib/trip-backup.ts`, `lib/expense-export.ts`.
 *
 * `keepUnknownKeys` is set at exactly ONE call site — `chunkDocToRows` (lib/expenses-remote.ts),
 * the REMOTE read. That is where #138's data loss lives: the sanitized row is merged and written
 * straight back up by `pushChunkMerged`, so an allowlist there let an older client erase a newer
 * client's fields from the server, permanently, on every sync. Under the flag the row is built by
 * spreading the source and then normalizing each DECLARED field on top, so validation is identical
 * either way (a malformed declared field still gets the SAME per-field rule — retained verbatim for
 * `leg`/`category`, coerced for `amount`/`date`/`note`, unsalvageable only for `id` — regardless of
 * `keepUnknownKeys`) — only undeclared keys differ. Matches `itineraryItemSchema`'s `.passthrough()`.
 *
 * Default-strict is the load-bearing part: a new caller that does not know to ask gets the safe
 * behaviour, and the two directions stay disjoint.
 */
export function sanitizeExpense(value: unknown, opts: SanitizeOptions = {}): Expense | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof Expense, unknown>>;

  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : null;
  if (id === null) return null;
  // `Leg` is already `string` (model.ts), so keeping an unrecognised id needs no cast.
  const leg = typeof v.leg === 'string' && v.leg.length > 0 ? v.leg : null;
  if (leg === null) return null;
  // Retained verbatim, same rule as `leg` — a forward category is not corruption (#150).
  const category = typeof v.category === 'string' && v.category.length > 0 ? v.category : null;
  if (category === null) return null;

  const expense: Expense = {
    ...(opts.keepUnknownKeys ? (value as Expense) : ({} as Partial<Expense>)),
    id,
    leg,
    category,
    amount: safeAmount(v.amount),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };

  // `date` must look like 'YYYY-MM-DD'; anything else is dropped (optional field).
  if (typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) expense.date = v.date;
  else delete expense.date;
  // `note` is a trimmed non-empty string or dropped.
  if (typeof v.note === 'string' && v.note.trim().length > 0) expense.note = v.note.trim();
  else delete expense.note;

  // ── Split — additive; absent on a fast-path expense ⇒ byte-identical ──
  // A non-empty string `paidBy`; a `split` reduced to its valid non-empty-string members (an empty
  // result drops the field, so `[]` never persists ⇒ a no-member split is just the fast path).
  if (typeof v.paidBy === 'string' && v.paidBy.length > 0) expense.paidBy = v.paidBy;
  else delete expense.paidBy;
  const members = Array.isArray(v.split)
    ? v.split.filter((m): m is string => typeof m === 'string' && m.length > 0)
    : [];
  if (members.length > 0) expense.split = members;
  else delete expense.split;

  // ── Sync v2 ──────────────────────────────
  // Keep the additive sync/attribution fields UNCHANGED when present and well-typed. Dropping
  // `hlc` here would break merge ordering and violate stamped-bytes expectation. A
  // dormant expense has none of these ⇒ nothing is added ⇒ byte-identical.
  if (typeof v.rev === 'number' && Number.isFinite(v.rev)) expense.rev = v.rev;
  else delete expense.rev;
  if (typeof v.hlc === 'string') expense.hlc = v.hlc;
  else delete expense.hlc;
  if (typeof v.deleted === 'boolean') expense.deleted = v.deleted;
  else delete expense.deleted;
  if (typeof v.createdBy === 'string' && v.createdBy.length > 0) expense.createdBy = v.createdBy;
  else delete expense.createdBy;
  if (typeof v.updatedBy === 'string' && v.updatedBy.length > 0) expense.updatedBy = v.updatedBy;
  else delete expense.updatedBy;

  return expense;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `Expense[]`: drop anything that is
 * not an array, and drop each entry that `sanitizeExpense` cannot salvage. `opts` is threaded
 * through unchanged; absent ⇒ strict (see `sanitizeExpense`). TOTAL — never throws.
 */
export function sanitizeExpenses(value: unknown, opts: SanitizeOptions = {}): Expense[] {
  if (!Array.isArray(value)) return [];
  const out: Expense[] = [];
  for (const entry of value) {
    const e = sanitizeExpense(entry, opts);
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
 * array (never mutates). TOTAL: an unsalvageable input (missing or non-string id, or
 * non-string/empty category) is dropped, returning the list unchanged. An unrecognised leg
 * or an unrecognised-but-valid-string category are not unsalvageable — they are accepted and kept
 * verbatim (`sanitizeExpense`, #150).
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
