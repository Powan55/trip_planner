/**
 * Sync v2 — the PURE LWW-per-field budget merge.
 *
 * Budget is a small STRUCT (`BudgetModel`: homeCurrency, rates.{NPR,JPY}, legBudgets.{nepal,japan},
 * categoryBudgets.<leg>.<category> — ≤ ~25 leaf scalars), NOT an id-keyed list. So the correct
 * merge granularity is the LEAF FIELD, and there are NO tombstones and NO row machinery — this is
 * deliberately NOT `mergeItems`. Each leaf path carries an HLC of its last edit; two peers editing
 * DIFFERENT fields both keep their edits (each path is independent), same-field is higher-HLC-wins,
 * and a CLEARED field is a stamped `null` (so a deletion propagates without a tombstone list).
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React/Next. Imports only the pure HLC helpers.
 *
 * ── CONVERGENCE ──────────────────────────────────
 * Each path's winner is an HLC-determined total-order max (argument-order-independent), with a
 * canonical-JSON tie-break on the protocol-impossible equal-HLC/different-value case — so the merge
 * is COMMUTATIVE + IDEMPOTENT: every client converges to the same field map regardless of the order
 * snapshots arrive. The map is bounded (≤ ~25 entries incl. stamped-null clears), so nothing GCs.
 */

import { compareHlc, parse } from './hlc';

/** One leaf field: its value (`null` = a cleared field) + the HLC of its last edit. */
export interface BudgetFieldEntry {
  v: number | string | null;
  hlc: string;
}

/** The Firestore/merge shape: a dotted leaf path → its stamped value. */
export type BudgetFields = Record<string, BudgetFieldEntry>;

/**
 * A stable, canonical string of a field's VALUE for the (protocol-impossible) equal-HLC tie-break.
 * `JSON.stringify` of a scalar/`null` is already canonical and argument-order-independent, so the
 * higher string wins deterministically. Used ONLY as a last-resort determinism guard.
 */
function valueFingerprint(entry: BudgetFieldEntry): string {
  return JSON.stringify(entry.v);
}

/**
 * Merge the local view of the budget field-map with the remote view. Union by
 * path; on a same-path collision the HIGHER HLC wins; a path present on only one side survives
 * unchanged; an exact-HLC tie is broken by the value's canonical JSON (deterministic). A side's
 * missing stamp is not special-cased here — a seeded default is written with an oldest-possible
 * HLC upstream (`seedHlcFromLegacy(undefined)` ⇒ pt 0) so it always loses to any real edit.
 */
export function mergeBudget(local: BudgetFields, remote: BudgetFields): BudgetFields {
  const out: BudgetFields = {};
  const paths = new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})]);
  for (const path of paths) {
    const a = local?.[path];
    const b = remote?.[path];
    if (!a) {
      out[path] = b!;
      continue;
    }
    if (!b) {
      out[path] = a;
      continue;
    }
    const cmp = compareHlc(parse(a.hlc), parse(b.hlc));
    if (cmp > 0) out[path] = a;
    else if (cmp < 0) out[path] = b;
    else out[path] = valueFingerprint(a) >= valueFingerprint(b) ? a : b; // equal-HLC canonical tie-break
  }
  return out;
}
