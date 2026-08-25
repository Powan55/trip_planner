'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadPacking, savePacking, packingStoragePort } from '@/core/packing/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import {
  toggleItem as toggleItemCore,
  addItem as addItemCore,
  removeItem as removeItemCore,
  packingProgress,
  type PackingItem,
} from '@/core/packing/model';

/**
 * Reactive packing-checklist store. A THIN React adapter over the framework-free
 * packing core (`core/packing/model.ts`) + the load/save adapter (`core/packing/storage.ts`,
 * gateway key 21). Local-only (no sync port), wiring `createReactiveStore` exactly
 * like `hooks/use-journal.ts` — the shared factory owns hydrate/listen/commit; this file owns
 * only the packing-specific mutators (`toggleItem`/`addItem`/`removeItem`, #227) + the derived
 * progress count.
 */

/** Mint a stable, collision-free custom-item id at the ADAPTER boundary (the pure core stays
 * id-agnostic — mirrors `use-expenses.ts`'s `generateExpenseId`). `custom-` prefix never collides
 * with the template's `nepal-`/`japan-`/`universal-` ids. */
function generateItemId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

import { PACKING_CHANGED_EVENT } from '@/core/storage/events';
export { PACKING_CHANGED_EVENT };

export interface PackingStore {
  items: PackingItem[];
  hydrated: boolean;
  progress: { checked: number; total: number };
  toggleItem(id: string): void;
  addItem(label: string): void;
  removeItem(id: string): void;
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

  const addItem = useCallback(
    (label: string) => {
      commit((current) => addItemCore(current, label, generateItemId()));
    },
    [commit],
  );

  const removeItem = useCallback(
    (id: string) => {
      commit((current) => removeItemCore(current, id));
    },
    [commit],
  );

  return { items, hydrated, progress: packingProgress(items), toggleItem, addItem, removeItem };
}

// Re-exported so tests/callers can compare byte-transport values directly without importing the
// core module twice.
export { loadPacking, savePacking };
