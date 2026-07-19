/**
 * Docs-checklist persistence adapter — the ONE load/save path for the `DocItem[]`,
 * over the typed storage gateway's key-25 `docsStore`. Kept tiny + framework-free:
 * it wires the byte-transport gateway to the domain's `sanitizeItems`, so an absent/corrupt/empty
 * on-disk slot always resolves to the built-in template ( precedent: no empty state — the value
 * of this feature IS the pre-populated template). Mirrors `core/packing/storage.ts` exactly.
 *
 * `loadDocs()` returns a sanitized `DocItem[]` (the template when absent/SSR/corrupt).
 * `saveDocs(items)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { docsStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeItems, DEFAULT_TEMPLATE, type DocItem } from '@/core/docs/model';

/** Load + sanitize the persisted docs checklist (the built-in template when absent/SSR/corrupt/empty). */
export function loadDocs(): DocItem[] {
  const raw = docsStore.get<unknown>(DEFAULT_TEMPLATE);
  return sanitizeItems(raw);
}

/** Sanitize + persist the whole docs checklist as JSON. No-op / never-throws under SSR or storage failure. */
export function saveDocs(items: DocItem[]): void {
  docsStore.set<DocItem[]>(sanitizeItems(items));
}

/**
 * The docs `StoragePort<DocItem[]>` for `createReactiveStore` + `flushOutbox` — the
 * same load/save contract the hook uses, plus raw key-presence to satisfy the port.
 */
export const docsStoragePort: StoragePort<DocItem[]> = {
  load: loadDocs,
  save: saveDocs,
  has: () => hasKey('local', keyFor('docsChecklist')),
};
