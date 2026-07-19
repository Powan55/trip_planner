'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadPacking, savePacking, packingStoragePort } from '@/core/packing/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { toggleItem as toggleItemCore, packingProgress, type PackingItem } from '@/core/packing/model';

/**
 * Reactive packing-checklist store. A THIN React adapter over the framework-free
 * packing core (`core/packing/model.ts`) + the load/save adapter (`core/packing/storage.ts`,
 * gateway key 21). Local-only (no sync port), wiring `createReactiveStore` exactly
 * like `hooks/use-journal.ts` — the shared factory owns hydrate/listen/commit; this file owns
 * only the packing-specific mutator (`toggleItem`) + the derived progress count.
 */

export const PACKING_CHANGED_EVENT = 'packing:changed';

export interface PackingStore {
  items: PackingItem[];
  hydrated: boolean;
  progress: { checked: number; total: number };
  toggleItem(id: string): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the packing domain.
const usePackingStore = createReactiveStore<PackingItem[]>({
  eventName: PACKING_CHANGED_EVENT,
  storageKeys: () => [keyFor('packing')],
  storage: packingStoragePort,
});

export function usePacking(): PackingStore {
  const { value: items, hydrated, commit } = usePackingStore();

  const toggleItem = useCallback(
    (id: string) => {
      commit((current) => toggleItemCore(current, id));
    },
    [commit],
  );

  return { items, hydrated, progress: packingProgress(items), toggleItem };
}

// Re-exported so tests/callers can compare byte-transport values directly without importing the
// core module twice.
export { loadPacking, savePacking };
