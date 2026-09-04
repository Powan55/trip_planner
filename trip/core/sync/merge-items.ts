/**
 * Sync v2 — the PURE id-keyed row merge.
 *
 * This is the GENERALIZATION of `merge-day.ts`'s per-item fold: the
 * conflict resolver (`resolvePair`) and the union-by-id + deterministic ordering were already
 * item-generic — only the `DayPlan` wrapper + day-metadata handling were itinerary-specific.
 * EXTRACTS them here as `mergeItems<R>` over any id-keyed row carrying the Sync-v2 stamps,
 * so expenses (chunked by leg) reuse the exact same merge algebra the itinerary proved. The
 * `merge-day.ts` API is unchanged: `mergeDay` now DELEGATES to `mergeItems` (its suite passes
 * with ZERO assertion edits — that is the extraction's proof).
 *
 * ── PURITY ─────────────────────────────────────────────────────────────
 * No I/O, no clock, no `window`, no firebase, no React/Next. Imports only the pure HLC helpers.
 *
 * ── CONVERGENCE ──────────────────────────────────────
 * COMMUTATIVE (each id's winner is an HLC-determined total-order max, argument-order-independent)
 * and IDEMPOTENT (`mergeItems(x, mergeItems(x,y)) ≡ mergeItems(x,y)`) — a join over a lattice, so
 * all clients converge to the same row-set regardless of the order snapshots arrive.
 */

import { compareHlc, parse, seedHlcFromLegacy, type Hlc } from './hlc';

/** Structural row type — anything id-keyed carrying the Sync-v2 stamps. */
export interface SyncedRow {
  id: string;
  rev?: number;
  hlc?: string;
  /**
   * ORDER key, separate from the `hlc` CONFLICT key. Serialized-HLC shaped, so `ord ?? hlc`
   * is a type-compatible fallback: a row that carries none orders by `hlc` exactly as before.
   * Optional and unused by the domains that have no user-visible order (expenses, docs, places).
   */
  ord?: string;
  deleted?: boolean;
  /** Legacy HLC seed source when `hlc` is absent (seedHlcFromLegacy). */
  updatedAt?: string;
}

/**
 * Delete-vs-edit resolution policy, a single named flag so the choice is
 * reversible without touching the merge internals:
 * - `'hlc'` (DEFAULT) — tombstone-wins-BY-HLC: the deleted row stays deleted unless a
 * STRICTLY-later edit (higher HLC) resurrects it. Deterministic + convergent.
 * - `'always'`— any tombstone beats any concurrent edit regardless of HLC. Exposed + tested;
 * NOT the default.
 */
export interface MergePolicy {
  deleteWins: 'hlc' | 'always';
}

export const DEFAULT_POLICY: MergePolicy = { deleteWins: 'hlc' };

/**
 * The effective HLC of a row for ordering/tie-break. A row carrying no `hlc` (a legacy or
 * freshly-read v1 row) is SEEDED deterministically from its `updatedAt` so the merge
 * always has a total-order key. Pure: `seedHlcFromLegacy` reads no clock.
 */
function rowHlc(row: SyncedRow): Hlc {
  return parse(row.hlc ?? seedHlcFromLegacy(row.updatedAt));
}

/**
 * Resolve two rows with the SAME `id` (one local, one remote) to a single winner.
 *
 * The BODY winner is `resolveWinner` below — the whole per-row conflict decision, extracted
 * verbatim from `merge-day.ts`'s former `resolvePair` and unchanged since.
 *
 * `ord` is then joined SEPARATELY as a max over the two rows' `ord` FIELDS. It has to be
 * independent of the body winner: a drag writes `ord` and nothing else, so a peer's later
 * content edit wins the body — and would carry the row back to its old position if `ord` rode
 * along with it. Compare the fields ONLY, never the `ord ?? hlc` effective key: falling back to
 * `hlc` here would turn a peer's fresh EDIT stamp into a position and make the row jump, which
 * is the very coupling this split exists to break.
 *
 * Convergence is unaffected. A max over a total order is commutative, idempotent and
 * associative, and it is computed from the unordered pair, so the lattice-join argument in the
 * module header still holds. With neither row carrying `ord` this returns the winner object
 * itself, so every merge over pre-split data is byte-identical to before.
 */
export function resolvePair<R extends SyncedRow>(a: R, b: R, policy: MergePolicy): R {
  const win = resolveWinner(a, b, policy);
  const ord =
    a.ord === undefined ? b.ord : b.ord === undefined ? a.ord : a.ord > b.ord ? a.ord : b.ord;
  return ord === undefined || ord === win.ord ? win : { ...win, ord };
}

/** The per-row CONTENT winner: tombstone policy, then HLC, then the equal-HLC tie-breaks. */
function resolveWinner<R extends SyncedRow>(a: R, b: R, policy: MergePolicy): R {
  const aDel = a.deleted === true;
  const bDel = b.deleted === true;

  // Tombstone vs live edit — policy 'always': any tombstone beats any concurrent edit.
  if (policy.deleteWins === 'always' && aDel !== bDel) {
    return aDel ? a : b;
  }

  // All other cases (live-vs-live, tombstone-vs-tombstone, and 'hlc' tombstone-vs-edit):
  // higher HLC wins. For 'hlc' delete-vs-edit this is exactly "tombstone stays unless a
  // strictly-later edit resurrects"; ties keep the tombstone (compareHlc returns 0 and we bias
  // the tombstone on a tie below).
  const cmp = compareHlc(rowHlc(a), rowHlc(b));
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  // Exact HLC tie (same pt/ct/actor). The protocol reaches it on a genuine ECHO (a===b by value)
  // and on one REAL asymmetry: a row read from a peer keeps forward keys this build cannot name
  // (#138), while the copy this device re-reads from its own strict-sanitized storage has been
  // stripped of them — same id, same hlc, different key set. Deterministic and UNCONDITIONALLY
  // commutative:
  // 1. bias the tombstone (a delete is not spuriously resurrected by an equal-HLC live copy);
  // 2. else prefer a strict key-set SUPERSET — the stripped copy can never erase the richer one;
  // 3. else break by a stable content fingerprint (higher wins) — argument-order-independent.
  //
  // KNOWN CEILING (#152): step 2 is commutative and idempotent but NOT associative — three-plus
  // rows sharing one exact HLC, mutually incomparable by key set, can resolve to different winners
  // depending on fold order. REACHABLE AND ACCEPTED. The old text here called it unreachable
  // because "`actor` is unique per device"; that premise is false and has been for as long as it
  // was written — `actor` is the traveller's display NAME in all five hooks, so two devices signed
  // in as the same traveller mint the same one. What keeps the ceiling effectively unreachable is
  // the conjunction it actually needs: three same-name devices minting one identical
  // `{pt, ct, actor}` stamp whose key sets are mutually incomparable. A key-COUNT total order would
  // restore associativity but would let a row with more keys beat one holding keys it lacks — real
  // data loss traded for tidiness, not worth it. A device-scoped actor (`deviceStore.getId()`,
  // synchronous and firebase-free) would restore the premise, at the cost of the human-readable
  // attribution the same field carries. That trade is what to revisit — not the retired trigger.
  if (aDel !== bDel) return aDel ? a : b;
  const richer = supersetRow(a, b);
  if (richer) return richer;
  return contentFingerprint(a) >= contentFingerprint(b) ? a : b;
}

/**
 * The row whose key set STRICTLY CONTAINS the other's, or `null` when neither does (equal key
 * sets, or each holding a key the other lacks).
 *
 * Needed because `contentFingerprint` cannot express "same row, fewer keys": inserting a key
 * always makes the sorted-entries JSON diverge DOWNWARD — at the new key's own name, or at `,`
 * (0x2C) vs the closing `]` (0x5D) when it sorts last — so the RICHER row always compared lower
 * and the stripped copy won every equal-HLC tie, erasing a peer's forward fields on the next push.
 *
 * Commutative by construction: strict containment is antisymmetric, so at most one of the two
 * rows can satisfy it and the answer depends on the unordered pair, never on argument order.
 */
function supersetRow<R extends SyncedRow>(a: R, b: R): R | null {
  const na = Object.keys(a).length;
  const nb = Object.keys(b).length;
  if (na === nb) return null; // equal size ⇒ containment can only be equality, not strict
  const [more, fewer] = na > nb ? [a, b] : [b, a];
  const moreKeys = new Set(Object.keys(more));
  return Object.keys(fewer).every((k) => moreKeys.has(k)) ? more : null;
}

/**
 * A stable, canonical string fingerprint of a row for the equal-HLC/different-content tie-break
 * above, once neither row is a strict superset of the other. Keys are sorted so the fingerprint is
 * argument-order-independent. Used ONLY as a last-resort determinism guard — never in the normal
 * HLC path.
 */
function contentFingerprint(row: SyncedRow): string {
  const entries = Object.entries(row as unknown as Record<string, unknown>).sort(([x], [y]) =>
    x < y ? -1 : x > y ? 1 : 0,
  );
  return JSON.stringify(entries);
}

/**
 * Merge the local view of an id-keyed row-set with the remote view of the SAME set (
 *). Union by `id`; on a same-`id` collision, `resolvePair` picks the winner. Result rows
 * INCLUDE tombstones; the caller's exposed
 * selector filters `deleted` out downstream.
 *
 * ORDERING: live rows sorted by
 * their winning `ord ?? hlc` ASCENDING (oldest first), with `id` as a final deterministic
 * tie-break; tombstones appended after the live rows (same sort). Both keys are fixed-width
 * serialized HLCs, so a set where only SOME rows carry `ord` still compares totally and a row
 * without one sits exactly where its `hlc` alone used to put it. Stable + fully convergent —
 * independent of argument order.
 */
export function mergeItems<R extends SyncedRow>(
  local: readonly R[],
  remote: readonly R[],
  policy: MergePolicy = DEFAULT_POLICY,
): R[] {
  const byId = new Map<string, R>();

  // Seed with local rows.
  for (const it of local ?? []) {
    byId.set(it.id, it);
  }
  // Fold in remote rows, resolving collisions per-`id`.
  for (const rit of remote ?? []) {
    const existing = byId.get(rit.id);
    byId.set(rit.id, existing ? resolvePair(existing, rit, policy) : rit);
  }

  const winners = Array.from(byId.values());
  const live = winners.filter((it) => it.deleted !== true);
  const tombstones = winners.filter((it) => it.deleted === true);

  const orderKey = (it: R) => it.ord ?? it.hlc ?? seedHlcFromLegacy(it.updatedAt);
  const stableSort = (arr: R[]) =>
    arr.sort((x, y) => {
      const kx = orderKey(x);
      const ky = orderKey(y);
      if (kx !== ky) return kx < ky ? -1 : 1;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });

  return [...stableSort(live), ...stableSort(tombstones)];
}

/**
 * Default tombstone GC horizon: a tombstone may drop once its `hlc.pt` is
 * older than 30 days — comfortably past any realistic offline window. Lives here (the id-keyed
 * layer) so BOTH the itinerary `gcTombstones` (day-shaped) and the expenses `gcTombstoneRows`
 * (chunk-shaped) share ONE horizon; `merge-day.ts` re-exports it for its existing public API.
 */
export const DEFAULT_GC_HORIZON_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Garbage-collect old, unreferenced tombstones from ONE id-keyed row-set —
 * the expenses analog of `merge-day.ts`'s day-shaped `gcTombstones`, which now DELEGATES here so
 * there is ONE GC predicate. A SEPARATE pure pass the adapter runs on a MERGED result at the two
 * merge boundaries only (never in the hot merge path, never as its own write). PURE: `nowPt` is
 * INJECTED.
 *
 * Drop a row iff BOTH:
 * - it is a tombstone (`deleted === true`), AND
 * - its `hlc.pt` is older than `cutoff = min(nowPt, dataNow) - horizonMs`, AND
 * - no LIVE row shares its `id` (nothing references/supersedes it).
 * Structurally unable to drop a live row (the first guard returns it untouched) or a recent
 * tombstone (still inside the horizon). Conservative + convergent: every client GCs the same row
 * at the same logical point; cross-client `nowPt` skew only delays a drop, never loses data.
 *
 * `dataNow` — the newest `hlc.pt` among the LIVE rows in `rows` — CAPS the injected `nowPt` (#238).
 * A device whose real clock has run far ahead of its own data would otherwise blow the horizon open
 * on ITS OWN read of `Date.now()`, alone, with no row anywhere near the cutoff, and prune every
 * tombstone in the set on the next push. Capping to the data's own newest LIVE stamp means the
 * horizon can only advance as far as some row's OWN timestamp already vouches for; a correct-clock
 * device's data is never ahead of `nowPt`, so `min` is a no-op there. Deliberately LIVE rows only,
 * never tombstones: anchoring on another tombstone would let two co-existing ancient, unrelated
 * ghosts shield EACH OTHER forever (each is "recent" relative to the other), even under a perfectly
 * correct clock. No live row at all → nothing in the set can vouch for "recent" independently of the
 * clock → falls back to `nowPt` unchanged (today's behavior). Still a heuristic, not a trusted-clock
 * redesign: a LIVE row minted just now BY the fast device itself (`hlcSendOrLocal` does not clamp
 * physical time, D-228) raises `dataNow` right along with it — this closes the ambient-clock-with-
 * no-bad-data case, not a device that mints a bad stamp into the very set being GC'd.
 */
export function gcTombstoneRows<R extends SyncedRow>(
  rows: readonly R[],
  nowPt: number,
  horizonMs: number = DEFAULT_GC_HORIZON_MS,
): R[] {
  const liveRows = (rows ?? []).filter((r) => r.deleted !== true);
  const liveIds = new Set(liveRows.map((r) => r.id));
  const dataNow = liveRows.length > 0 ? Math.max(...liveRows.map((r) => rowHlc(r).pt)) : nowPt;
  const cutoff = Math.min(nowPt, dataNow) - horizonMs;
  return (rows ?? []).filter((r) => {
    if (r.deleted !== true) return true; // never drop a live row
    const tooOld = rowHlc(r).pt < cutoff;
    const referenced = liveIds.has(r.id); // a live row resurrected this id → keep the ghost paired
    return !(tooOld && !referenced);
  });
}
