'use client';

import { useCallback, useMemo } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadDocs, saveDocs, docsStoragePort } from '@/core/docs/storage';
import { docsSyncPort } from '@/lib/docs-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { realClock } from '@/lib/trip-now';
import { nextSyncStamp } from '@/core/sync/stamp';
import { mergeItems } from '@/core/sync/merge-items';
import {
  toggleItem as toggleItemCore,
  setNote as setNoteCore,
  docsCompletion,
  type DocItem,
  type DocStamper,
  type DocsCompletion,
} from '@/core/docs/model';

/**
 * Reactive docs-checklist store. A THIN React adapter over the framework-free docs core
 * (`core/docs/model.ts`) + the load/save adapter (`core/docs/storage.ts`, gateway key 25). It wires
 * `createReactiveStore` WITH the docs `SyncPort` — the shared factory
 * owns the hydrate/listen/commit skeleton; this file owns the docs-specific
 * mutators + the sync/attribution stamping gate + the derived completion selector.
 *
 * ── DORMANT BYTE-IDENTITY ─────────────────────────────────────────────────────────────
 * The rev/hlc + attribution stamping is GATED on `isTripRemoteConfigured()` — the TRIP-scoped
 * gate (#10), so the local-only default pack never stamps (mirrors use-expenses/use-my-places):
 * - DORMANT: `toggleItem`/`setNote` write NO sync field — the slot is byte-identical to a local-
 * only checklist. The remote subscribe/push are never opened (the provider gates on the same).
 * - SYNC ON: each edit advances `rev`/`hlc` (nextSyncStamp) + stamps `updatedBy`, so a peer's
 * concurrent offline toggle converges via `mergeItems` (lib/docs-remote.ts).
 *
 * The fixed template has NO add/remove/tombstone path, so — unlike expenses — there
 * is no deleted-row filter and no fresh-id restore; `toggleItem`/`setNote` are the only mutators.
 *
 * Instantiated per-consumer (no provider): every `useDocs()` stays in lockstep through the
 * CustomEvent. The remote subscribe is opened once at the app root (itinerary-provider).
 */

import { DOCS_CHANGED_EVENT } from '@/core/storage/events';
export { DOCS_CHANGED_EVENT };

export interface DocsStore {
  items: DocItem[];
  hydrated: boolean;
  completion: DocsCompletion;
  toggleItem(id: string): void;
  setNote(id: string, note: string): void;
  /**
   * Restore the checklist from a validated backup (issue #295 — a same-id UPSERT, not a
   * tombstone-replace: docsChecklist's 18 ids are a FIXED template with no add/remove path, so
   * there is no extra row to tombstone and no id to mint fresh). For each id, the row with the
   * WINNING stamp applies — `mergeItems(current, backup)`, the exact same row-merge algebra
   * `pushChecklistMerged`/`subscribeRemoteDocs` already use remotely, run once locally so the
   * live store reflects the winner immediately rather than waiting on the next round trip. A row
   * edited AFTER the backup was taken is NOT reverted by the older backup row; a backup row that
   * is genuinely newer than the current live row DOES win. DORMANT: a plain local overwrite (no
   * stamps exist to compare, byte-identical to the old behavior).
   */
  restoreDocsChecklist(backup: DocItem[]): void;
  /**
   * — reclaim the attribution stamps left under a name the traveler used to go by (the docs
   * half of the itinerary's owner-initiated `claimAuthorship`,/Q3). `updatedBy` is the ONLY
   * identity field on a `DocItem`, so it is the only one rewritten. Returns how many rows changed
   * (0 = nothing written at all).
   *
   * `updatedAt` is NOT re-stamped: it is the SyncedRow legacy HLC seed AND the itinerary claim set
   * the precedent (re-stamping a timestamp to "fix" a name dates an old edit to now). Under sync
   * `rev`/`hlc` DO advance (`nextSyncStamp`) — without that bump a peer's un-rewritten copy wins
   * the LWW resolve in `mergeItems` and the next remote snapshot unwinds the claim.
   */
  claimAuthorship(fromName: string): number;
}

// Sync gate + actor (firebase-free, dormant-safe — mirrors use-expenses).
function syncEnabled(): boolean {
  return isTripRemoteConfigured();
}
function actor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// A stamper for an EDIT (bump rev + advance hlc from prev + attribution), used only under sync.
function editStamp(): DocStamper {
  return (item) => {
    const name = actor();
    const attributed: DocItem = name ? { ...item, updatedBy: name } : item;
    return { ...attributed, ...nextSyncStamp(item, realClock.now().getTime(), name) };
  };
}

// The shared hydrate/listen/commit skeleton, instantiated once for the docs domain
// WITH its SyncPort. The factory's commit tail fires `docsSyncPort.push(prev, next)` fire-and-forget
// AFTER the local save + dispatch; the push self-gates on `isRemoteConfigured()` + an active
// traveler behind a dynamic import, so the dormant build pulls no firebase.
const useDocsStore = createReactiveStore<DocItem[]>({
  eventName: DOCS_CHANGED_EVENT,
  storageKeys: () => [keyFor('docsChecklist')],
  storage: docsStoragePort,
  sync: docsSyncPort,
});

export function useDocs(): DocsStore {
  const { value: items, hydrated, commit } = useDocsStore();

  const toggleItem = useCallback(
    (id: string) => {
      const stamp = syncEnabled() ? editStamp() : undefined;
      commit((current) => toggleItemCore(current, id, stamp));
    },
    [commit],
  );

  const setNote = useCallback(
    (id: string, note: string) => {
      const stamp = syncEnabled() ? editStamp() : undefined;
      commit((current) => setNoteCore(current, id, note, stamp));
    },
    [commit],
  );

  // — see the `claimAuthorship` doc on DocsStore.
  const claimAuthorship = useCallback(
    (fromName: string): number => {
      const from = fromName.trim();
      const to = getUserName();
      if (!from || !to || from === to) return 0;
      // Never reach commit() on a zero-match claim — it would save + push an identical array.
      if (!items.some((i) => i.deleted !== true && i.updatedBy === from)) return 0;
      const sync = syncEnabled();
      const name = actor();
      const now = realClock.now().getTime();
      let claimed = 0;
      commit((current) => {
        claimed = 0;
        return current.map((i) => {
          if (i.deleted === true || i.updatedBy !== from) return i;
          claimed++;
          const renamed: DocItem = { ...i, updatedBy: to };
          return sync ? { ...renamed, ...nextSyncStamp(i, now, name) } : renamed;
        });
      });
      return claimed;
    },
    [commit, items],
  );

  const restoreDocsChecklist = useCallback(
    (backup: DocItem[]) => {
      // DORMANT: a plain local overwrite — no sync to unwind, byte-identical to the old behavior.
      // SYNC ON: same-id upsert via the shared merge algebra — whichever side's stamp is newer
      // wins per id; a fixed 18-id template means every id is present on both sides already, so
      // there is nothing to tombstone and no id to mint.
      if (!syncEnabled()) {
        commit(() => backup);
        return;
      }
      commit((current) => mergeItems(current, backup));
    },
    [commit],
  );

  const completion = useMemo(() => docsCompletion(items), [items]);

  return { items, hydrated, completion, toggleItem, setNote, claimAuthorship, restoreDocsChecklist };
}

// Re-exported so tests/callers can compare byte-transport values directly.
export { loadDocs, saveDocs };
