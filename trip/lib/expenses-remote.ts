// The expenses remote-sync seam — the read/write
// directions for the EXPENSE domain, mirroring `lib/itinerary-remote.ts` but chunked BY LEG.
//
// The chunk set is `LEGS` from `core/budget/model.ts` — the ACTIVE pack's leg ids, resolved
// once at module load (default pack: `['nepal', 'japan']`; a custom trip: `['main']`). This
// module used to hardcode its own local `['nepal', 'japan']` copy instead of importing the real
// one, so a custom trip's chunk was never a chunk this module recognized: the write side dropped
// it silently (`pushExpenseChunk`'s guard) and the read side never iterated it when building the
// applied row-set (`applySnapshot`'s `for (const leg of LEGS)`), so a first (empty) remote
// snapshot on a custom trip wiped every local expense instead of leaving an unrecognized leg
// alone. D-340.
//
// WRITE (local → remote): `pushExpenseChunk(current, leg)` performs a merge-aware
// transactional read→merge→set of ONE leg doc `trips/{TRIP_ID}/expenses/{leg}` — the
// `pushDayMerged` analog over `mergeItems`. Invoked ONLY from the outbox
// decorator, which is driven from `commit()`. MUST REJECT on failure so the
// outbox keeps the chunk dirty (the decorator is the swallower).
// READ (remote → local): `subscribeRemoteExpenses` opens `onSnapshot` on the `LEGS.length`-doc
// `expenses` collection; each chunk's first-snapshot marker is DOC PRESENCE (, NOT
// the itinerary trip-doc marker — they coexist). Applies via `saveExpenses()` + the
// `expenses:changed` event DIRECTLY (never `commit()`) so the snapshot path can never
// re-push.
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy
// dynamic import, gated). This module is itself imported only dynamically (from the outbox
// pushChunk + the provider's gated subscribe), so the dormant build pulls no firebase.
//
// GATED: the caller (outbox enqueue + provider subscribe) checks an active
// traveler before any push/subscribe — a guest never syncs expenses.

'use client';

import { saveExpenses, loadExpenses } from '@/core/budget/storage';
import { sanitizeExpenses, type Expense } from '@/core/budget/expenses';
import { LEGS, isLeg, type Leg } from '@/core/budget/model';
import { EXPENSES_CHANGED_EVENT } from '@/core/storage/events';
import { isTripRemoteConfigured, getTripId } from './firebase-config';
import { getRemote, type FirestoreMod } from './firebase-remote';
import { mergeItems, gcTombstoneRows } from '@/core/sync/merge-items';
import { outboxDirty } from '@/core/sync/outbox';
import { isPermissionDenied } from '@/core/sync/denied';
import { setReadDenied } from '@/core/sync/read-denied';
import { realClock } from './trip-now';

/**
 * Map a raw Firestore expense chunk-doc into its `Expense[]` (defensive: tolerate a partial doc).
 *
 * `sanitizeExpenses` rather than a bare cast, because the cast was a LIE about untrusted bytes: one
 * `null` element written by a peer on an older build (or by anything else with write access) makes
 * `mergeItems` dereference `it.id` and throw. In the snapshot path that is caught and the update is
 * dropped; inside `pushChunkMerged` it rejects the transaction, so that leg's chunk stays dirty and
 * retries FOREVER — a poison row that silently wedges this device's outbox. Same read-boundary
 * discipline `docToPlaceRows` already applies, and the same one `core/budget/storage.ts` applies to
 * local bytes.
 */
export function chunkDocToRows(data: Record<string, unknown>): Expense[] {
  // `keepUnknownKeys` is set HERE and only here on this domain (#138). The merged result of this
  // read is written straight back up by `pushChunkMerged`, so the strict allowlist rebuild dropped
  // a newer client's forward fields before they could reach the write.
  // Retention alone does NOT finish the job: `saveExpenses` sanitizes STRICT on the way to disk, so
  // the row this device later re-reads and pushes is the STRIPPED one at the SAME hlc. What keeps
  // the forward keys is the equal-HLC superset tie-break in `resolvePair` (D-376) — without it the
  // strip wins that collision and erases them again on the next push.
  // The LOCAL entry points (`loadExpenses`/`saveExpenses`, backup, import) stay strict, which is
  // what keeps D-159's zero-egress guarantee structural — a photo ref can only originate locally.
  return Array.isArray(data.items) ? sanitizeExpenses(data.items, { keepUnknownKeys: true }) : [];
}

/**
 * Strip `undefined`-valued fields before writing to Firestore (which rejects `undefined`). Our
 * `Expense` has many optional fields (date/note/rev/hlc/deleted/createdBy/updatedBy) commonly
 * undefined; a JSON round-trip drops them cleanly and is also a defensive deep-clone.
 */
function sanitizeRowsForWrite(rows: Expense[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
}

/**
 * Merge-aware transactional write of ONE leg chunk.
 * Reads the current remote leg-doc inside a transaction, `mergeItems` the local leg rows on top,
 * and writes the merged result — so a concurrent same-leg peer write forces a retry that re-merges
 * rather than clobbering. Exported for the wired-behavior unit test (fake Firestore).
 */
export async function pushChunkMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  leg: Leg,
  localRows: Expense[],
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', getTripId(), 'expenses', leg);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteRows: Expense[] = snap.exists() ? chunkDocToRows(snap.data() as Record<string, unknown>) : [];
    // GC BOUNDARY ①: prune past-horizon, unreferenced tombstone rows
    // from the MERGED leg before writing — the `pushDayMerged` gc analog over `gcTombstoneRows`.
    const merged = gcTombstoneRows(mergeItems(remoteRows, localRows), realClock.now().getTime());
    tx.set(ref, { leg, items: sanitizeRowsForWrite(merged) });
  });
}

/**
 * Push ONE expense leg chunk from the CURRENT local state — the `ChunkSync.pushChunk` impl the
 * offline outbox drives. MUST REJECT on failure (getRemote rejects when
 * unreachable; pushChunkMerged rejects on a transport error) so the decorator keeps the chunk
 * dirty. Unlike a day, an EMPTIED leg still writes `items:[]` ( parity — a deliberately
 * emptied leg is a real state, not a skip). Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushExpenseChunk(current: Expense[], leg: string): Promise<void> {
  if (!LEGS.includes(leg)) return; // not a chunk of the ACTIVE pack → ack (never a bad write)
  const legRows = current.filter((e) => e.leg === leg);
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushChunkMerged(db, fs, leg, legRows); // rejects on transport error → stays dirty
}

/**
 * Subscribe to remote expense changes (remote → local). Opens ONE `onSnapshot` on
 * `trips/{TRIP_ID}/expenses` (2 docs). Per-chunk first-snapshot marker = DOC PRESENCE:
 * - chunk PRESENT → first snapshot authoritative for that leg (verbatim incl. empty —/
 * parity), EXCEPT an outbox-dirty leg.
 * - chunk ABSENT → never synced → seed that leg from local rows (push up; local untouched).
 * - steady state → `mergeItems(localLeg, remoteLeg)`, applied via `saveExpenses()`+dispatch.
 *
 * Applied DIRECTLY (never `commit()`) so it can never re-push. Gated +
 * lazy + self-degrading: no-op unsubscribe when dormant; any failure → local-only via console.warn,
 * never throws. Returns an unsubscribe fn.
 */
export function subscribeRemoteExpenses(): () => void {
  // #10: trip-scoped gate — the default pack is a local-only sample and never opens this.
  if (!isTripRemoteConfigured()) return () => {};

  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;
  let established = false;
  let settingUp = false;
  let firstSnapshotHandled = false;

  let onlineHandler: (() => void) | null = null;
  const removeOnlineHandler = () => {
    if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  };
  const armOnlineRetry = () => {
    if (onlineHandler || cancelled || established || typeof window === 'undefined') return;
    onlineHandler = () => {
      removeOnlineHandler();
      if (cancelled || established) return;
      void attemptSetup();
    };
    window.addEventListener('online', onlineHandler);
  };

  // Persist + dispatch the resolved rows to the local store (the shared write tail). Writes
  // through the EXISTING persistence and dispatches the EXISTING event DIRECTLY — NOT via
  // commit() — so the snapshot path never re-pushes.
  const persistAndDispatch = (rows: Expense[]) => {
    saveExpenses(rows);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT));
  };

  // Resolve one snapshot into the new local row-set (per-leg), seeding any absent chunk up.
  const applySnapshot = (
    remoteByLeg: Map<Leg, Expense[]>,
    presentLegs: Set<Leg>,
    first: boolean,
    seedUp: (leg: Leg, rows: Expense[]) => void,
  ) => {
    const local = loadExpenses();
    const dirty = new Set(outboxDirty('expenses'));
    // A row whose leg this build's pack does not declare is RETAINED verbatim by `sanitizeExpense`
    // on purpose; the per-leg rebuild below would delete it on the first snapshot. Carried across
    // untouched — never merged into a leg, never pushed up.
    const foreign = local.filter((e) => !isLeg(e.leg));
    const result: Expense[] = [];
    for (const leg of LEGS) {
      const localLeg = local.filter((e) => e.leg === leg);
      const remoteLeg = remoteByLeg.get(leg) ?? [];
      if (first && !dirty.has(leg)) {
        if (presentLegs.has(leg)) {
          // Authoritative: remote verbatim incl. empty (a deliberately-emptied leg is a real
          // state, not a reseed trigger — across devices).
          result.push(...remoteLeg);
        } else {
          // Never synced for this leg → seed from local (push up), keep local as-is.
          result.push(...localLeg);
          seedUp(leg, localLeg);
        }
      } else {
        // Steady-state (or a dirty leg on first snapshot): item-level merge so an unpushed local
        // edit and a peer's edits both survive. GC BOUNDARY ②: prune
        // past-horizon, unreferenced tombstone rows from the MERGED leg before persist.
        result.push(...gcTombstoneRows(mergeItems(localLeg, remoteLeg), realClock.now().getTime()));
      }
    }
    persistAndDispatch([...result, ...foreign]);
  };

  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;
      const { collection, onSnapshot } = fs;
      const expensesCol = collection(db, 'trips', getTripId(), 'expenses');

      firestoreUnsub = onSnapshot(
        expensesCol,
        (snapshot) => {
          // #345: any snapshot event reaching here proves this device's read is no longer
          // denied — clear whatever the error path below set (membership granted mid-session,
          // no reload needed). Mirrors itinerary-remote.ts's #271 handling.
          setReadDenied('expenses', false);

          // Skip the echo of our OWN optimistic write (the authoritative server snapshot follows).
          if (snapshot.metadata.hasPendingWrites) return;
          // Defer reconciliation until the first SERVER snapshot (a cache-sourced empty first
          // event would wrongly look like "never synced" — mirrors itinerary hardening).
          if (!firstSnapshotHandled && snapshot.metadata.fromCache) return;

          try {
            const remoteByLeg = new Map<Leg, Expense[]>();
            const presentLegs = new Set<Leg>();
            for (const d of snapshot.docs) {
              if (!LEGS.includes(d.id)) continue; // a doc id not in the ACTIVE pack's legs
              presentLegs.add(d.id);
              remoteByLeg.set(d.id, chunkDocToRows(d.data() as Record<string, unknown>));
            }
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            applySnapshot(remoteByLeg, presentLegs, first, (leg, rows) => {
              // Seed an absent chunk up. Best-effort; a failure
              // stays local-only (the local rows are untouched, so nothing is lost).
              void pushChunkMerged(db, fs, leg, rows).catch((err) =>
                console.warn('[expenses-remote] chunk seed failed, staying local-only:', err),
              );
            });
          } catch (err) {
            console.warn('[expenses-remote] failed to apply remote snapshot:', err);
          }
        },
        (err) => {
          console.warn('[expenses-remote] snapshot stream error:', err);
          established = false;
          firestoreUnsub = null;
          // #345: a permission-denied read answers IDENTICALLY on every retry — arming the
          // `online` retry here is the forever-loop, not resilience. Record it and stop; the
          // snapshot handler above clears the flag itself on a later working reconnect.
          if (isPermissionDenied(err)) {
            setReadDenied('expenses', true);
            return;
          }
          if (!cancelled) armOnlineRetry();
        },
      );

      established = true;
      removeOnlineHandler();
      if (cancelled && firestoreUnsub) {
        firestoreUnsub();
        firestoreUnsub = null;
        established = false;
      }
    } catch (err) {
      console.warn('[expenses-remote] remote sync unavailable, staying local-only:', err);
      if (!cancelled) armOnlineRetry();
    } finally {
      settingUp = false;
    }
  };

  void attemptSetup();

  return () => {
    cancelled = true;
    removeOnlineHandler();
    if (firestoreUnsub) {
      firestoreUnsub();
      firestoreUnsub = null;
    }
    established = false;
  };
}
