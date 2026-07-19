/**
 * Photo-metadata persistence adapter — the ONE load/save path for the `PhotoMeta[]`, over
 * the typed storage gateway's key-16 `photosStore`. Framework-free; wires the
 * byte-transport gateway to the domain's `sanitizePhotos`, so a corrupt/partial slot always resolves
 * to a valid list. Mirrors `core/journal/storage.ts` exactly. Blob BYTES are NOT here (IndexedDB).
 */

import { photosStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizePhotos, type PhotoMeta } from '@/core/photos/model';

/** Load + sanitize the persisted photo-metadata list (empty list when absent / SSR / corrupt). */
export function loadPhotos(): PhotoMeta[] {
  return sanitizePhotos(photosStore.get<unknown>([]));
}

/** Sanitize + persist the whole photo-metadata list as JSON. No-op / never-throws under SSR/failure. */
export function savePhotos(metas: PhotoMeta[]): void {
  photosStore.set<PhotoMeta[]>(sanitizePhotos(metas));
}

/** The photo `StoragePort<PhotoMeta[]>` for `createReactiveStore` — local-only, no sync. */
export const photosStoragePort: StoragePort<PhotoMeta[]> = {
  load: loadPhotos,
  save: savePhotos,
  has: () => hasKey('local', keyFor('photos')),
};
