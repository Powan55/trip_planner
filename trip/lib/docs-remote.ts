// The docs-checklist remote-sync seam — the read/write directions for the
// DOCS domain. HYBRID SHAPE: a SINGLE doc `trips/{tripId}/docs/checklist` (budget's singleton-doc
// chunking, Spark-quota-friendly —) whose payload is a ROW ARRAY merged with `mergeItems`
// The fixed template is 18 id-keyed rows; row-merge is
// what lets two travelers' concurrent offline toggles BOTH survive (a whole-doc LWW would clobber
// one), while staying one small doc + one onSnapshot.
//
// WRITE (local → remote): `pushChecklistMerged(local)` — a merge-aware transactional
// read→merge→set of the one doc. Invoked ONLY from the outbox decorator. MUST
// REJECT on failure so the outbox keeps the `'checklist'` chunk dirty (the decorator swallows).
// READ (remote → local): `subscribeRemoteDocs` opens `onSnapshot` on the single doc; first-
// snapshot marker = DOC PRESENCE. PRESENT ⇒ `mergeItems(local, remote)` (always —
// a fixed template means every id is present on both sides, so merge can never drop a
// template row AND it preserves an unpushed local toggle without a separate dirty-chunk
// exception); ABSENT ⇒ seed from local (push up; local untouched). Applied via `saveDocs()`
// + the `docs:changed` event DIRECTLY (never `commit()`) so the snapshot path never re-
// pushes.
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy,
// gated). This module is itself imported only dynamically (from the outbox pushChunk + the
// provider's gated subscribe), so the dormant build pulls no firebase.
//
// GATED: the caller (outbox enqueue + provider subscribe) checks an active traveler
// before any push/subscribe — a guest never syncs the checklist.

'use client';

import { saveDocs, loadDocs } from '@/core/docs/storage';
import type { DocItem } from '@/core/docs/model';
import { DOCS_CHANGED_EVENT } from '@/hooks/use-docs';
import { isRemoteConfigured, getTripId } from './firebase-config';
import { getRemote, type FirestoreMod } from './itinerary-remote';
import { mergeItems } from '@/core/sync/merge-items';

/** Map a raw Firestore checklist doc into its `DocItem[]` (defensive: tolerate a partial doc). */
export function docToRows(data: Record<string, unknown>): DocItem[] {
  return Array.isArray(data.items) ? (data.items as DocItem[]) : [];
}

/**
 * Strip `undefined`-valued fields before writing to Firestore (which rejects `undefined`). A
 * `DocItem` has many optional fields (note/rev/hlc/deleted/updatedAt/updatedBy) commonly undefined;
 * a JSON round-trip drops them cleanly and is also a defensive deep-clone.
 */
function sanitizeRowsForWrite(rows: DocItem[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
}

/**
 * Merge-aware transactional write of the SINGLETON checklist doc. Reads the current remote doc
 * inside a transaction, `mergeItems` the local rows on top, and writes the merged result — so a
 * concurrent peer's toggle to a DIFFERENT item is not clobbered (both survive) and a same-item edit
 * resolves by HLC. Exported for the wired-behavior unit test (fake Firestore). No tombstone GC:
 * the fixed template never produces tombstones (no remove path), so `gcTombstoneRows` is a no-op we
 * skip.
 */
export async function pushChecklistMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  localRows: DocItem[],
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', getTripId(), 'docs', 'checklist');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteRows: DocItem[] = snap.exists() ? docToRows(snap.data() as Record<string, unknown>) : [];
    const merged = mergeItems(remoteRows, localRows);
    tx.set(ref, { version: 1, items: sanitizeRowsForWrite(merged) });
  });
}

/**
 * Push the checklist from the CURRENT local state — the `ChunkSync.pushChunk` impl the offline
 * outbox drives. The only chunk is the singleton `'checklist'`. MUST REJECT on
 * failure (getRemote rejects when unreachable; pushChecklistMerged rejects on a transport error) so
 * the decorator keeps the chunk dirty. Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushDocsChunk(current: DocItem[], chunk: string): Promise<void> {
  if (chunk !== 'checklist') return; // unknown chunk → ack (never a bad write)
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushChecklistMerged(db, fs, current); // rejects on transport error → stays dirty
}

/**
 * Subscribe to remote checklist changes (remote → local). Opens ONE `onSnapshot` on the singleton
 * doc `trips/{tripId}/docs/checklist`. PRESENT ⇒ `mergeItems(local, remote)` (always merge — see the
 * header: a fixed-template single chunk can't drop rows, and merge preserves an unpushed local
 * toggle so no separate dirty-chunk exception is needed); ABSENT on first snapshot ⇒ seed from
 * local. Applied DIRECTLY via `saveDocs()`+dispatch (never `commit()`) so it can never re-push
 * Gated + lazy + self-degrading: no-op unsubscribe when dormant; any
 * failure → local-only via console.warn, never throws. Mirrors `subscribeRemoteBudget`.
 */
export function subscribeRemoteDocs(onApplied?: (rows: DocItem[]) => void): () => void {
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

  const persistAndDispatch = (rows: DocItem[]) => {
    saveDocs(rows);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DOCS_CHANGED_EVENT));
    onApplied?.(rows);
  };

  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;
      const { doc, onSnapshot } = fs;
      const ref = doc(db, 'trips', getTripId(), 'docs', 'checklist');

      firestoreUnsub = onSnapshot(
        ref,
        (snap) => {
          // Skip the echo of our OWN optimistic write (the authoritative server snapshot follows).
          if (snap.metadata.hasPendingWrites) return;
          // Defer until the first SERVER snapshot (a cache-sourced first event would wrongly look
          // like "never synced" — mirrors the itinerary/expenses/budget hardening).
          if (!firstSnapshotHandled && snap.metadata.fromCache) return;

          try {
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            const local = loadDocs();
            if (snap.exists()) {
              const remoteRows = docToRows(snap.data() as Record<string, unknown>);
              persistAndDispatch(mergeItems(local, remoteRows));
            } else if (first) {
              // Never synced → seed the doc from local. Best-effort; a failure
              // stays local-only (local is untouched, so nothing is lost).
              void pushChecklistMerged(db, fs, local).catch((err) =>
                console.warn('[docs-remote] doc seed failed, staying local-only:', err),
              );
            }
          } catch (err) {
            console.warn('[docs-remote] failed to apply remote snapshot:', err);
          }
        },
        (err) => {
          console.warn('[docs-remote] snapshot stream error:', err);
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
      console.warn('[docs-remote] remote sync unavailable, staying local-only:', err);
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
