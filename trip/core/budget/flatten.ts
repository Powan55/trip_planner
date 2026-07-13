/**
 * Budget ⇄ leaf-field bridge. PURE + framework-free.
 *
 * The budget syncs as a SINGLETON LWW-per-field doc, so this module is the ONE place that:
 *   - `flattenBudget` — turns a `BudgetModel` into its CLOSED set of canonical dotted leaf paths
 *     (`homeCurrency`, `rates.{NPR,JPY}`, `legBudgets.{nepal,japan}`, and each PRESENT
 *     `categoryBudgets.{leg}.{category}`). No dynamic keys — the path set is derived from the fixed
 *     scalars + `BUDGET_CATEGORIES` × legs.
 *   - `unflattenBudget` — rebuilds a `BudgetModel` from a leaf-path map (inverse of flatten).
 *   - `modelToFields` / `fieldsToModel` — convert between a model (+ its per-field HLC map) and the
 *     Firestore field-doc shape (`BudgetFields`, `core/sync/merge-budget.ts`). A CLEARED field
 *     (stamped in `sync.fieldHlc` but with no live value) round-trips as a stamped `null`.
 *   - `stampBudgetChanges` — the edit stamper: diff prev vs next flatten, advance the HLC of exactly
 *     the CHANGED leaf paths (via `nextSyncStamp`). Gated on `isRemoteConfigured()` by the CALLER
 *     (`use-budget`) — dormant never calls it (byte-identity is preserved when sync is off).
 */

import {
  BUDGET_CATEGORIES,
  normalizeModel,
  type BudgetModel,
  type CurrencyCode,
  type Leg,
} from './model';
import type { ItineraryCategory } from '@/lib/trip-data';
import { seedHlcFromLegacy } from '@/core/sync/hlc';
import { nextSyncStamp } from '@/core/sync/stamp';
import type { BudgetFields } from '@/core/sync/merge-budget';

const LEGS: readonly Leg[] = ['nepal', 'japan'] as const;

/** A leaf value carried in the flattened map. */
type FieldValue = number | string;

/**
 * Flatten a model to its CLOSED set of canonical leaf paths → value. The fixed scalars are always
 * present; a category budget is included ONLY when set (> 0), matching `normalizeModel` (which
 * drops 0-value categories) so flatten/normalize agree on which paths exist.
 */
export function flattenBudget(model: BudgetModel): Record<string, FieldValue> {
  const flat: Record<string, FieldValue> = {
    homeCurrency: model.homeCurrency,
    'rates.NPR': model.rates.NPR,
    'rates.JPY': model.rates.JPY,
    'legBudgets.nepal': model.legBudgets.nepal,
    'legBudgets.japan': model.legBudgets.japan,
  };
  for (const leg of LEGS) {
    const cats = model.categoryBudgets[leg];
    if (!cats) continue;
    for (const cat of BUDGET_CATEGORIES) {
      const amt = cats[cat];
      if (typeof amt === 'number' && amt > 0) flat[`categoryBudgets.${leg}.${cat}`] = amt;
    }
  }
  return flat;
}

const CATEGORY_PATH = /^categoryBudgets\.(nepal|japan)\.(.+)$/;

/** Rebuild a `BudgetModel` from a leaf-path map (inverse of `flattenBudget`; NOT normalized). */
export function unflattenBudget(flat: Record<string, FieldValue>): BudgetModel {
  const model: BudgetModel = {
    version: 1,
    homeCurrency: (flat.homeCurrency as CurrencyCode) ?? 'USD',
    rates: { NPR: Number(flat['rates.NPR']), JPY: Number(flat['rates.JPY']) },
    legBudgets: { nepal: Number(flat['legBudgets.nepal'] ?? 0), japan: Number(flat['legBudgets.japan'] ?? 0) },
    categoryBudgets: {},
  };
  for (const [path, v] of Object.entries(flat)) {
    const m = CATEGORY_PATH.exec(path);
    if (!m) continue;
    const leg = m[1] as Leg;
    const cat = m[2] as ItineraryCategory;
    (model.categoryBudgets[leg] ??= {})[cat] = Number(v);
  }
  return model;
}

/**
 * Convert a model (+ its per-field HLC map) into the Firestore field-doc. Every live leaf gets its
 * stamped HLC (or an oldest-possible seed HLC when unstamped, so a seeded default always loses to a
 * real edit). A path stamped in `sync.fieldHlc` but with NO live value is a CLEARED field → written
 * as a stamped `null`, so the deletion propagates without a tombstone list.
 */
export function modelToFields(model: BudgetModel): BudgetFields {
  const flat = flattenBudget(model);
  const fieldHlc = model.sync?.fieldHlc ?? {};
  const fields: BudgetFields = {};
  for (const [path, v] of Object.entries(flat)) {
    fields[path] = { v, hlc: fieldHlc[path] ?? seedHlcFromLegacy(undefined) };
  }
  for (const [path, hlc] of Object.entries(fieldHlc)) {
    if (!(path in flat)) fields[path] = { v: null, hlc }; // stamped-null = cleared field
  }
  return fields;
}

/** Rebuild a normalized `BudgetModel` (with its `sync.fieldHlc`) from a merged field-doc. */
export function fieldsToModel(fields: BudgetFields): BudgetModel {
  const flat: Record<string, FieldValue> = {};
  const fieldHlc: Record<string, string> = {};
  for (const [path, entry] of Object.entries(fields ?? {})) {
    if (!entry || typeof entry.hlc !== 'string') continue;
    fieldHlc[path] = entry.hlc;
    if (entry.v !== null && entry.v !== undefined) flat[path] = entry.v as FieldValue;
  }
  const model = unflattenBudget(flat);
  model.sync = { fieldHlc };
  return normalizeModel(model); // normalizeModel PRESERVES sync.fieldHlc
}

/**
 * Stamp the CHANGED leaf paths of an edit with a fresh HLC. Diffs prev vs next
 * flatten; for each path whose value changed (added / edited / cleared), advances the HLC from that
 * path's previous stamp (monotonic, via `nextSyncStamp`). Unchanged paths keep their prior HLC.
 * The CALLER gates this on `isRemoteConfigured()` — dormant never stamps.
 */
export function stampBudgetChanges(
  prev: BudgetModel,
  next: BudgetModel,
  physicalNow: number,
  actor: string,
): BudgetModel {
  const prevFlat = flattenBudget(prev);
  const nextFlat = flattenBudget(next);
  const prevHlc = prev.sync?.fieldHlc ?? {};
  const fieldHlc: Record<string, string> = { ...prevHlc };
  const paths = new Set([...Object.keys(prevFlat), ...Object.keys(nextFlat)]);
  for (const path of paths) {
    if (prevFlat[path] !== nextFlat[path]) {
      fieldHlc[path] = nextSyncStamp({ hlc: prevHlc[path] }, physicalNow, actor).hlc;
    }
  }
  return { ...next, sync: { fieldHlc } };
}
