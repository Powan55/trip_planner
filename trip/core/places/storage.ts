/**
 * My-places persistence adapter — the ONE load/save path for the `MyPlace[]`, over the
 * typed storage gateway's key-31 `myPlacesStore`. Kept tiny + framework-free: it
 * wires the byte-transport gateway to the domain's `sanitizePlaces`, so an absent/corrupt/oversized
 * on-disk slot always resolves to a safe, capped list. Mirrors `core/share/storage.ts` exactly (the
 * empty collection — `[]` — is the honest first-load state; no seeded template).
 *
 * `loadMyPlaces()` returns a sanitized `MyPlace[]` (`[]` when absent/SSR/corrupt).
 * `saveMyPlaces(places)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { hasKey, keyFor } from '@/core/storage/gateway';
import { myPlacesStore } from '@/core/storage/my-places-store';
import type { StoragePort } from '@/core/ports';
import { sanitizePlaces, type MyPlace } from '@/core/places/model';

/** Load + sanitize the persisted places (empty when absent/SSR/corrupt). Newest-first, capped. */
export function loadMyPlaces(): MyPlace[] {
  return sanitizePlaces(myPlacesStore.get<unknown>([]));
}

/** Sanitize + persist the whole collection as JSON. No-op / never-throws under SSR or storage failure. */
export function saveMyPlaces(places: MyPlace[]): void {
  myPlacesStore.set<MyPlace[]>(sanitizePlaces(places));
}

/**
 * The my-places `StoragePort<MyPlace[]>` for `createReactiveStore` — the same
 * load/save contract the hook uses, plus raw key-presence to satisfy the port.
 */
export const myPlacesStoragePort: StoragePort<MyPlace[]> = {
  load: loadMyPlaces,
  save: saveMyPlaces,
  has: () => hasKey('local', keyFor('myPlaces')),
};
