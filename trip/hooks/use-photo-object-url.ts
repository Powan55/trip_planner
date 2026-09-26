'use client';

import { useEffect, useState } from 'react';
import { defaultBlobStore } from '@/core/photos/blob-store';

/**
 * Resolves a stored photo id (`BlobStorePort`) to a render-ready object URL. Extracted from
 * `PhotoAttach` `PhotoThumb` idiom so both the editable capture grid and the read-only
 * story strip share one blob→objectURL→revoke lifecycle instead of two copies.
 *
 * `missing` is true when `get(id)` resolves `null` (evicted / absent / IndexedDB unavailable) — the
 * caller renders the placeholder tile in that case, never a broken `<img>`.
 *
 * `skip` (default false) defers the blob read entirely — callers rendering many thumbnails at
 * once (journal/recap strips) gate it on `useLazyInView` so photos decode near the viewport
 * instead of all at mount; `PhotoAttach`'s own edit grid doesn't pass it and stays eager.
 */
export function usePhotoObjectUrl(
  id: string,
  options?: { skip?: boolean },
): { url: string | null; missing: boolean } {
  const skip = options?.skip ?? false;
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (skip) return;
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setMissing(false);
    void defaultBlobStore.get(id).then((blob) => {
      if (!active) return;
      if (!blob) {
        setMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, skip]);

  return { url, missing };
}
