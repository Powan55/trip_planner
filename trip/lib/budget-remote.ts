// The budget remote-sync seam — the read/write directions for
// the BUDGET domain, mirroring `lib/expenses-remote.ts` but as a SINGLETON LWW-per-field doc.
//
// WRITE (local → remote): `pushBudgetMerged(localModel)` performs a merge-aware transactional
// read→merge→set of the ONE doc `trips/{TRIP_ID}/budget/model` — the `pushChunkMerged`
// analog over `mergeBudget` (field-LWW, NOT row merge). Invoked ONLY from the outbox
// decorator, which is driven from `commit()`. MUST REJECT on failure so the outbox
// keeps the 'model' chunk dirty (the decorator is the swallower).
// READ (remote → local): `subscribeRemoteBudget` opens `onSnapshot` on the single doc; the
// first-snapshot marker is DOC PRESENCE. Applies via `saveBudget()` + the
// `budget:changed` event DIRECTLY (never `commit()`) so the snapshot path can never re-push
// Present ⇒ per-field merge (field-LWW makes a stamped local edit
// win over a stale remote and a stamped-null clear propagate); absent ⇒ seed from local
//.
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy,
// gated). This module is itself imported only dynamically (from the outbox pushChunk + the provider's
// gated subscribe), so the dormant build pulls no firebase.
//
// GATED: the caller (outbox enqueue + provider subscribe) checks an active traveler
// before any push/subscribe — a guest never syncs the budget.

'use client';

import { saveBudget, loadBudget } from '@/core/budget/storage';
import type { BudgetModel } from '@/core/budget/model';
import { BUDGET_CHANGED_EVENT } from '@/hooks/use-budget';
import { isTripRemoteConfigured, getTripId } from './firebase-config';
import { getRemote, type FirestoreMod } from './itinerary-remote';
import { mergeBudget, type BudgetFields } from '@/core/sync/merge-budget';
import { modelToFields, fieldsToModel } from '@/core/budget/flatten';

/**
 * Map a raw Firestore budget doc into its `BudgetFields`.
 *
 * Per-ENTRY validation rather than a bare cast, because the cast was a LIE about untrusted bytes:
 * `mergeBudget` calls `parse(entry.hlc)` unguarded, so one entry with a missing or non-string `hlc`
 * throws a TypeError. Inside `pushBudgetMerged` that rejects the transaction, so the `'model'`
 * chunk stays dirty and retries FOREVER — a poison field that silently wedges this device's outbox;
 * in `subscribeRemoteBudget` it is swallowed to a warn and budget sync goes quietly dead. Every
 * sibling remote read already guards (`chunkDocToRows`, `docToRows`, `docToPlaceRows`,
 * `docToDayPlan`); budget is the one field-map-shaped domain that never got it. `fieldsToModel`
 * spells out the same rule but runs AFTER the merge, so it never sees the value.
 *
 * Unknown PATHS survive (a leaf a newer build added is passed through and written back, so #138's
 * erasure does not apply here); an entry that is not a well-formed `{v, hlc}` is dropped.
 */
export function budgetDocToFields(data: Record<string, unknown>): BudgetFields {
  const f = data?.fields;
  if (!f || typeof f !== 'object') return {};
  const out: BudgetFields = {};
  for (const [path, raw] of Object.entries(f as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const { v, hlc } = raw as { v?: unknown; hlc?: unknown };
    if (typeof hlc !== 'string') continue;
    if (v !== null && typeof v !== 'number' && typeof v !== 'string') continue;
    out[path] = { v, hlc };
  }
  return out;
}

/** Strip `undefined` before writing (Firestore rejects it) + defensive deep-clone. */
function sanitizeFieldsForWrite(fields: BudgetFields): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fields)) as Record<string, unknown>;
}

/**
 * Merge-aware transactional write of the SINGLETON budget doc ( — the `pushChunkMerged`
 * analog). Reads the current remote doc inside a transaction, `mergeBudget`s the local field-map on
 * top, and writes the merged result — so a concurrent peer edit to a DIFFERENT field is not clobbered
 * (both survive) and a same-field edit resolves by HLC. Exported for the wired-behavior unit test.
 */
export async function pushBudgetMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  localModel: BudgetModel,
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', getTripId(), 'budget', 'model');
  const localFields = modelToFields(localModel);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteFields = snap.exists() ? budgetDocToFields(snap.data() as Record<string, unknown>) : {};
    const merged = mergeBudget(localFields, remoteFields);
    tx.set(ref, { version: 1, fields: sanitizeFieldsForWrite(merged) });
  });
}

/**
 * Push the budget from the CURRENT local model — the `ChunkSync.pushChunk` impl the offline outbox
 * drives. The only chunk is the singleton `'model'`. MUST REJECT on failure
 * (getRemote rejects when unreachable; pushBudgetMerged rejects on a transport error) so the
 * decorator keeps the chunk dirty. Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushBudgetChunk(current: BudgetModel, chunk: string): Promise<void> {
  if (chunk !== 'model') return; // unknown chunk → ack (never a bad write)
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushBudgetMerged(db, fs, current); // rejects on transport error → stays dirty
}

/**
 * Subscribe to remote budget changes (remote → local). Opens ONE `onSnapshot` on the singleton doc
 * `trips/{TRIP_ID}/budget/model`. First-snapshot marker = DOC PRESENCE:
 * - PRESENT → per-field merge of local + remote (a stamped local edit wins over a stale remote via
 * HLC; a stamped-null clear propagates; a seeded default loses — field-LWW is the authoritative
 * op for a struct, so "verbatim vs merge" is moot and merge preserves an unpushed local edit).
 * - ABSENT → never synced → seed from local (push up; local untouched), even if local is the seed.
 *
 * Applied DIRECTLY (never `commit()`) so it can never re-push. Gated +
 * lazy + self-degrading: no-op unsubscribe when dormant; any failure → local-only via console.warn,
 * never throws. Returns an unsubscribe fn. Mirrors `subscribeRemoteExpenses`.
 */
export function subscribeRemoteBudget(onApplied?: (model: BudgetModel) => void): () => void {
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

  // Persist + dispatch the resolved model to the local store (the shared write tail) — DIRECTLY,
  // never via commit(), so the snapshot path never re-pushes.
  const persistAndDispatch = (model: BudgetModel) => {
    saveBudget(model);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BUDGET_CHANGED_EVENT));
    onApplied?.(model);
  };

  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;
      const { doc, onSnapshot } = fs;
      const ref = doc(db, 'trips', getTripId(), 'budget', 'model');

      firestoreUnsub = onSnapshot(
        ref,
        (snap) => {
          // Skip the echo of our OWN optimistic write (the authoritative server snapshot follows).
          if (snap.metadata.hasPendingWrites) return;
          // Defer until the first SERVER snapshot (a cache-sourced first event would wrongly look
          // like "never synced" — mirrors the itinerary/expenses hardening).
          if (!firstSnapshotHandled && snap.metadata.fromCache) return;

          try {
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            const localFields = modelToFields(loadBudget());
            if (snap.exists()) {
              const remoteFields = budgetDocToFields(snap.data() as Record<string, unknown>);
              persistAndDispatch(fieldsToModel(mergeBudget(localFields, remoteFields)));
            } else if (first) {
              // Never synced → seed the doc from local. Best-effort; a failure
              // stays local-only (local is untouched, so nothing is lost).
              void pushBudgetMerged(db, fs, loadBudget()).catch((err) =>
                console.warn('[budget-remote] doc seed failed, staying local-only:', err),
              );
            }
          } catch (err) {
            console.warn('[budget-remote] failed to apply remote snapshot:', err);
          }
        },
        (err) => {
          console.warn('[budget-remote] snapshot stream error:', err);
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
      console.warn('[budget-remote] remote sync unavailable, staying local-only:', err);
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
