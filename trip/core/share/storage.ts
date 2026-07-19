/**
 * Share-inbox persistence adapter — the ONE load/save path for the `ShareItem[]`,
 * over the typed storage gateway's key-23 `shareInboxStore`. Kept tiny + framework-free
 * it wires the byte-transport gateway to the domain's `sanitizeItems`, so an
 * absent/corrupt/oversized on-disk slot always resolves to a safe, capped list. Mirrors
 * `core/packing/storage.ts` exactly (the empty inbox — `[]` — is the honest first-load state, so
 * unlike packing there is no seeded template).
 *
 * `loadShareInbox()` returns a sanitized `ShareItem[]` (`[]` when absent/SSR/corrupt).
 * `saveShareInbox(items)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { shareInboxStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeItems, type ShareItem } from '@/core/share/model';

/** Load + sanitize the persisted inbox (empty when absent/SSR/corrupt). Newest-first, capped. */
export function loadShareInbox(): ShareItem[] {
  return sanitizeItems(shareInboxStore.get<unknown>([]));
}

/** Sanitize + persist the whole inbox as JSON. No-op / never-throws under SSR or storage failure. */
export function saveShareInbox(items: ShareItem[]): void {
  shareInboxStore.set<ShareItem[]>(sanitizeItems(items));
}

/**
 * The share-inbox `StoragePort<ShareItem[]>` for `createReactiveStore` — the same
 * load/save contract the hook uses, plus raw key-presence to satisfy the port.
 */
export const shareInboxStoragePort: StoragePort<ShareItem[]> = {
  load: loadShareInbox,
  save: saveShareInbox,
  has: () => hasKey('local', keyFor('shareInbox')),
};
