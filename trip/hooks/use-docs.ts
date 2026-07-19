'use client';

import { useCallback, useMemo } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadDocs, saveDocs, docsStoragePort } from '@/core/docs/storage';
import { docsSyncPort } from '@/lib/docs-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { clock } from '@/lib/trip-now';
import { nextSyncStamp } from '@/core/sync/stamp';
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
 * The rev/hlc + attribution stamping is GATED on `isRemoteConfigured()` (mirrors use-expenses):
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

export const DOCS_CHANGED_EVENT = 'docs:changed';

export interface DocsStore {
  items: DocItem[];
  hydrated: boolean;
  completion: DocsCompletion;
  toggleItem(id: string): void;
  setNote(id: string, note: string): void;
}

// Sync gate + actor (firebase-free, dormant-safe — mirrors use-expenses).
function syncEnabled(): boolean {
  return isRemoteConfigured();
}
function actor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

// A stamper for an EDIT (bump rev + advance hlc from prev + attribution), used only under sync.
function editStamp(): DocStamper {
  return (item) => {
    const name = actor();
    const attributed: DocItem = name ? { ...item, updatedBy: name } : item;
    return { ...attributed, ...nextSyncStamp(item, clock.now().getTime(), name) };
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

  const completion = useMemo(() => docsCompletion(items), [items]);

  return { items, hydrated, completion, toggleItem, setNote };
}

// Re-exported so tests/callers can compare byte-transport values directly.
export { loadDocs, saveDocs };
