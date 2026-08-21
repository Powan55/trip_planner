/**
 * Photo-metadata persistence adapter — the ONE load/save path for the `PhotoMeta[]`, over
 * the typed storage gateway's key-16 `photosStore`. Framework-free; wires the
 * byte-transport gateway to the domain's `sanitizePhotos`, so a corrupt/partial slot always resolves
 * to a valid list. Mirrors `core/journal/storage.ts` exactly. Blob BYTES are NOT here (IndexedDB).
 */

import { photosStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizePhotos, type PhotoMeta } from '@/core/photos/model';
import { defaultBlobStore, type BlobStorePort } from '@/core/photos/blob-store';

/** Load + sanitize the persisted photo-metadata list (empty list when absent / SSR / corrupt). */
export function loadPhotos(): PhotoMeta[] {
  return sanitizePhotos(photosStore.get<unknown>([]));
}

/** Sanitize + persist the whole photo-metadata list as JSON. No-op / never-throws under SSR/failure. */
export function savePhotos(metas: PhotoMeta[]): void {
  photosStore.set<PhotoMeta[]>(sanitizePhotos(metas));
}

/**
 * Delete every blob named by a photo-meta index — the "meta gone ⇒ blob gone" step.
 *
 * Photo META is trip-scoped (key 16); photo BYTES live in ONE app-scoped IndexedDB with no trip
 * dimension, so destroying a trip's index without this orphans its blobs forever: nothing can
 * enumerate them back to a trip, nothing GCs them, and they keep counting against the origin quota
 * until captures start failing with `reason:'quota'`. Takes the meta value (unsanitized) rather
 * than a trip id so the caller can read the index BEFORE it wipes it. Total: a malformed index
 * deletes nothing; `store.delete` never rejects.
 */
export function deletePhotoBlobs(meta: unknown, store: BlobStorePort = defaultBlobStore): Promise<void> {
  return Promise.all(sanitizePhotos(meta).map((m) => store.delete(m.id))).then(() => undefined);
}

/** The photo `StoragePort<PhotoMeta[]>` for `createReactiveStore` — local-only, no sync. */
export const photosStoragePort: StoragePort<PhotoMeta[]> = {
  load: loadPhotos,
  save: savePhotos,
  has: () => hasKey('local', keyFor('photos')),
};
