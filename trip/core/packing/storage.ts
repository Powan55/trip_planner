/**
 * Packing checklist persistence adapter — the ONE load/save path for the
 * `PackingItem[]`, over the typed storage gateway's key-21 `packingStore`. Kept tiny +
 * framework-free: it wires the byte-transport gateway to the domain's `sanitizeItems`, so
 * an absent/corrupt/empty on-disk slot always resolves to the built-in template (: no
 * empty state — the value of this feature IS the pre-populated template). Mirrors
 * `core/journal/storage.ts` exactly.
 *
 * `loadPacking()` returns a sanitized `PackingItem[]` (the template when absent/SSR/corrupt).
 * `savePacking(items)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { packingStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeItems, DEFAULT_TEMPLATE, type PackingItem } from '@/core/packing/model';
import { isDefaultTrip } from '@/core/trips';

/** Load + sanitize the persisted packing list (the built-in template when absent/SSR/corrupt/empty
 * on the default trip; just the `universal`-category items on a custom trip — A-15/#102). */
export function loadPacking(): PackingItem[] {
  const fallback = isDefaultTrip() ? DEFAULT_TEMPLATE : DEFAULT_TEMPLATE.filter((i) => i.category === 'universal');
  const raw = packingStore.get<unknown>(fallback);
  return sanitizeItems(raw, fallback);
}

/** Sanitize + persist the whole packing list as JSON. No-op / never-throws under SSR or storage failure. */
export function savePacking(items: PackingItem[]): void {
  packingStore.set<PackingItem[]>(sanitizeItems(items));
}

/**
 * The packing `StoragePort<PackingItem[]>` for `createReactiveStore` — the same
 * load/save contract the hook uses, plus raw key-presence to satisfy the port.
 */
export const packingStoragePort: StoragePort<PackingItem[]> = {
  load: loadPacking,
  save: savePacking,
  has: () => hasKey('local', keyFor('packing')),
};
