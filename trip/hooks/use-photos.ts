'use client';

import { useCallback, useMemo } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { photosStoragePort } from '@/core/photos/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { defaultBlobStore } from '@/core/photos/blob-store';
import { preparePhoto } from '@/core/photos/downscale';
import {
  photosForOwner,
  addPhotoMeta,
  removePhotoMeta,
  repointExpenseOwner,
  type PhotoMeta,
  type PhotoOwner,
} from '@/core/photos/model';

/**
 * Reactive photo-metadata store. A THIN React adapter over the pure
 * `core/photos/model.ts` + the key-16 `photosStoragePort`, wired through `createReactiveStore` (
 *) WITHOUT a `sync` port — photos are LOCAL-ONLY, forever. The shared factory owns the
 * hydrate/listen/commit skeleton; this file owns the capture pipeline coupling (downscale → blob-store
 * put → meta append) + the delete + the sync-on Undo re-point.
 *
 * ZERO EGRESS: this hook writes ONLY the key-16 metadata index and the local `BlobStorePort`.
 * There is no `SyncPort`, no Firestore, no export path — the metadata never leaves the device and the
 * blob bytes never leave IndexedDB. The photo↔owner link lives only in the meta rows here.
 */

export const PHOTOS_CHANGED_EVENT = 'photos:changed';

/** Result of an attach: the minted id on success, or the user-visible reason it didn't store. */
export type AddPhotoResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'quota' | 'unavailable' | 'decode' };

export interface PhotosStore {
  photos: PhotoMeta[];
  hydrated: boolean;
  /** The photos belonging to `owner`, in stored order. */
  photosFor(owner: PhotoOwner): PhotoMeta[];
  /**
   * Downscale + store a captured file and append its meta to `owner`. Non-destructive: on a decode
   * failure or a full/unavailable device store NOTHING is written and the reason is returned, so the
   * host journal entry / expense is unaffected. `altText` is required (a11y); `caption` optional.
   */
  addPhoto(owner: PhotoOwner, file: File | Blob, altText: string, caption?: string): Promise<AddPhotoResult>;
  /** Remove a photo: delete the blob first (fail-safe order), then drop its meta. */
  removePhoto(id: string): Promise<void>;
  /**
   * Re-point expense-owned photos `oldId → newId`: the sync-on expense Undo re-adds a
   * FRESH-ID copy, so the receipt meta must follow. No-op when the id is unchanged (dormant restore).
   */
  repointExpense(oldId: string, newId: string): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the photos domain.
// LOCAL-ONLY: no `sync` port.
const usePhotosStore = createReactiveStore<PhotoMeta[]>({
  eventName: PHOTOS_CHANGED_EVENT,
  storageKeys: () => [keyFor('photos')],
  storage: photosStoragePort,
});

export function usePhotos(): PhotosStore {
  const { value: photos, hydrated, commit } = usePhotosStore();

  const photosFor = useCallback(
    (owner: PhotoOwner) => photosForOwner(photos, owner),
    [photos],
  );

  const addPhoto = useCallback(
    async (owner: PhotoOwner, file: File | Blob, altText: string, caption?: string): Promise<AddPhotoResult> => {
      // 1. Downscale BEFORE any store write — original full-size bytes are never persisted.
      const prepared = await preparePhoto(file);
      if (!prepared.ok) return { ok: false, reason: 'decode' };

      // 2. Store the blob; a full/unavailable device surfaces its reason and writes NO meta.
      const put = await defaultBlobStore.put(prepared.blob);
      if (!put.ok) return { ok: false, reason: put.reason };

      // 3. Append the meta (timestamp injected at the adapter boundary — the core stays deterministic).
      const trimmedCaption = caption?.trim() ? caption.trim() : undefined;
      const trimmedAlt = altText.trim();
      const meta: PhotoMeta = {
        id: put.id,
        owner,
        altText: trimmedAlt || (trimmedCaption ?? ''),
        w: prepared.w,
        h: prepared.h,
        bytes: prepared.blob.size,
        createdAt: new Date().toISOString(),
      };
      if (trimmedCaption !== undefined) meta.caption = trimmedCaption;
      commit((current) => addPhotoMeta(current, meta));
      return { ok: true, id: put.id };
    },
    [commit],
  );

  const removePhoto = useCallback(
    async (id: string) => {
      // Blob first, then meta: a meta without a blob renders as a placeholder (harmless); a blob
      // without a meta is invisible+orphaned — so delete in the order that fails safe.
      await defaultBlobStore.delete(id);
      commit((current) => removePhotoMeta(current, id));
    },
    [commit],
  );

  const repointExpense = useCallback(
    (oldId: string, newId: string) => {
      if (oldId === newId) return; // dormant restore keeps the id — nothing to move
      commit((current) => repointExpenseOwner(current, oldId, newId));
    },
    [commit],
  );

  return useMemo(
    () => ({ photos, hydrated, photosFor, addPhoto, removePhoto, repointExpense }),
    [photos, hydrated, photosFor, addPhoto, removePhoto, repointExpense],
  );
}
