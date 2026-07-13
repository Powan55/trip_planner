// The expenses remote-sync seam — the read/write
// directions for the EXPENSE domain, mirroring `lib/itinerary-remote.ts` but chunked BY LEG.
//
//   WRITE (local → remote): `pushExpenseChunk(current, leg)` performs a merge-aware
//         transactional read→merge→set of ONE leg doc `trips/{TRIP_ID}/expenses/{leg}` — the
//         `pushDayMerged` analog over `mergeItems`. Invoked ONLY from the outbox
//         decorator, which is driven from `commit()`. MUST REJECT on failure so the
//         outbox keeps the chunk dirty (the decorator is the swallower).
//   READ  (remote → local): `subscribeRemoteExpenses` opens `onSnapshot` on the 2-doc
//         `expenses` collection; each chunk's first-snapshot marker is DOC PRESENCE (NOT
//         the itinerary trip-doc marker — they coexist). Applies via `saveExpenses()` + the
//         `expenses:changed` event DIRECTLY (never `commit()`) so the snapshot path can never
//         re-push (echo-suppression).
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy
// dynamic import, gated). This module is itself imported only dynamically (from the outbox
// pushChunk + the provider's gated subscribe), so the dormant build pulls no firebase.
//
// GATED: the caller (outbox enqueue + provider subscribe) checks an active
// traveler before any push/subscribe — a guest never syncs expenses.

'use client';

import { saveExpenses, loadExpenses } from '@/core/budget/storage';
import { type Expense } from '@/core/budget/expenses';
import type { Leg } from '@/core/budget/model';
import { EXPENSES_CHANGED_EVENT } from '@/hooks/use-expenses';
import { isRemoteConfigured, TRIP_ID } from './firebase-config';
import { getRemote, type FirestoreMod } from './itinerary-remote';
import { mergeItems, gcTombstoneRows } from '@/core/sync/merge-items';
import { outboxDirty } from '@/core/sync/outbox';
import { clock } from './trip-now';

// The two leg chunks, in a stable order (chunk key = `expense.leg`).
const LEGS: readonly Leg[] = ['nepal', 'japan'] as const;

/** Map a raw Firestore expense chunk-doc into its `Expense[]` (defensive: tolerate a partial doc). */
export function chunkDocToRows(data: Record<string, unknown>): Expense[] {
  return Array.isArray(data.items) ? (data.items as Expense[]) : [];
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
 * Merge-aware transactional write of ONE leg chunk (the `pushDayMerged` analog).
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
  const ref = doc(db, 'trips', TRIP_ID, 'expenses', leg);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteRows: Expense[] = snap.exists() ? chunkDocToRows(snap.data() as Record<string, unknown>) : [];
    // GC BOUNDARY ① (the id-keyed analog): prune past-horizon, unreferenced tombstone rows
    // from the MERGED leg before writing — the `pushDayMerged` gc analog over `gcTombstoneRows`.
    const merged = gcTombstoneRows(mergeItems(remoteRows, localRows), clock.now().getTime());
    tx.set(ref, { leg, items: sanitizeRowsForWrite(merged) });
  });
}

/**
 * Push ONE expense leg chunk from the CURRENT local state — the `ChunkSync.pushChunk` impl the
 * offline outbox drives. MUST REJECT on failure (getRemote rejects when
 * unreachable; pushChunkMerged rejects on a transport error) so the decorator keeps the chunk
 * dirty. Unlike a day, an EMPTIED leg still writes `items:[]` (parity — a deliberately
 * emptied leg is a real state, not a skip). Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushExpenseChunk(current: Expense[], leg: string): Promise<void> {
  if (leg !== 'nepal' && leg !== 'japan') return; // unknown chunk → ack (never a bad write)
  const legRows = current.filter((e) => e.leg === leg);
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushChunkMerged(db, fs, leg, legRows); // rejects on transport error → stays dirty
}

/**
 * Subscribe to remote expense changes (remote → local). Opens ONE `onSnapshot` on
 * `trips/{TRIP_ID}/expenses` (2 docs). Per-chunk first-snapshot marker = DOC PRESENCE:
 *   - chunk PRESENT → first snapshot authoritative for that leg (verbatim incl. empty —
 *     parity), EXCEPT an outbox-dirty leg (which steady-state merges instead).
 *   - chunk ABSENT → never synced → seed that leg from local rows (push up; local untouched).
 *   - steady state → `mergeItems(localLeg, remoteLeg)`, applied via `saveExpenses()`+dispatch.
 *
 * Applied DIRECTLY (never `commit()`) so it can never re-push (echo-suppression). Gated +
 * lazy + self-degrading: no-op unsubscribe when dormant; any failure → local-only via console.warn,
 * never throws. Returns an unsubscribe fn.
 */
export function subscribeRemoteExpenses(onApplied?: (rows: Expense[]) => void): () => void {
  if (!isRemoteConfigured()) return () => {};

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
    onApplied?.(rows);
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
        result.push(...gcTombstoneRows(mergeItems(localLeg, remoteLeg), clock.now().getTime()));
      }
    }
    persistAndDispatch(result);
  };

  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;
      const { collection, onSnapshot } = fs;
      const expensesCol = collection(db, 'trips', TRIP_ID, 'expenses');

      firestoreUnsub = onSnapshot(
        expensesCol,
        (snapshot) => {
          // Skip the echo of our OWN optimistic write (the authoritative server snapshot follows).
          if (snapshot.metadata.hasPendingWrites) return;
          // Defer reconciliation until the first SERVER snapshot (a cache-sourced empty first
          // event would wrongly look like "never synced" — mirrors the itinerary hardening).
          if (!firstSnapshotHandled && snapshot.metadata.fromCache) return;

          try {
            const remoteByLeg = new Map<Leg, Expense[]>();
            const presentLegs = new Set<Leg>();
            for (const d of snapshot.docs) {
              if (d.id !== 'nepal' && d.id !== 'japan') continue;
              presentLegs.add(d.id);
              remoteByLeg.set(d.id, chunkDocToRows(d.data() as Record<string, unknown>));
            }
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            applySnapshot(remoteByLeg, presentLegs, first, (leg, rows) => {
              // Seed an absent chunk up (the initial handshake, per chunk). Best-effort; a failure
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
