/**
 * Docs-checklist persistence adapter — the ONE load/save path for the `DocItem[]`,
 * over the typed storage gateway's key-25 `docsStore`. Kept tiny + framework-free:
 * it wires the byte-transport gateway to the domain's `sanitizeItems`, so an absent or corrupt
 * on-disk slot resolves to the built-in template. Mirrors `core/packing/storage.ts` exactly.
 *
 * ABSENT ≠ EMPTY (#335, mirrors packing's #328). `loadDocs`/`saveDocs` round-trip an empty list
 * verbatim via `hasKey` + an explicit `[]` write fallback, so a merge or write that legitimately
 * empties the checklist doesn't get reseeded to the full template on next read.
 *
 * `loadDocs()` returns a sanitized `DocItem[]` (the template when absent/SSR/corrupt).
 * `saveDocs(items)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { docsStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeItems, DEFAULT_TEMPLATE, UNIVERSAL_TEMPLATE, type DocItem } from '@/core/docs/model';
import { isDefaultTrip } from '@/core/trips';

/** Load + sanitize the persisted docs checklist (the built-in template when absent/SSR/corrupt
 * on the default trip; the country-neutral `UNIVERSAL_TEMPLATE` on a custom trip — A-15/#102). An
 * empty stored list is a real (if currently unreachable — no remove control) value and is returned
 * as-is rather than reseeded, matching packing's #328 fix. */
export function loadDocs(): DocItem[] {
  const fallback = isDefaultTrip() ? DEFAULT_TEMPLATE : UNIVERSAL_TEMPLATE;
  if (!hasKey('local', keyFor('docsChecklist'))) return [...fallback];
  const raw = docsStore.get<unknown>(fallback);
  if (Array.isArray(raw) && raw.length === 0) return [];
  return sanitizeItems(raw, fallback);
}

/** Sanitize + persist the whole docs checklist as JSON. No-op / never-throws under SSR or storage failure. */
export function saveDocs(items: DocItem[]): void {
  // fallback=[]: a write persists what the caller passed, not sanitizeItems' seeded-template
  // default (#335, mirrors packing's #328) — an emptied list must stay empty across reload.
  docsStore.set<DocItem[]>(sanitizeItems(items, []));
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
