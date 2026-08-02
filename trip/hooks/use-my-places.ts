'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadMyPlaces, saveMyPlaces, myPlacesStoragePort } from '@/core/places/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { addPlace, removePlace, type MyPlace } from '@/core/places/model';

/**
 * Reactive my-places store. A THIN React adapter over the framework-free places core
 * (`core/places/model.ts`) + the load/save adapter (`core/places/storage.ts`, gateway key 31).
 * Local-only, wiring `createReactiveStore`
 * exactly like `hooks/use-share.ts` — the shared factory owns hydrate/listen/commit;
 * this file owns only the place-specific mutators + the id/timestamp injection (an I/O concern that
 * stays out of the pure core).
 */

export const MY_PLACES_CHANGED_EVENT = 'myplaces:changed';

export interface NewPlaceInput {
  /** Caller-provided id — used verbatim when present (the import sheet mints it up-front so it can
   * stamp the matching `sourceId: 'myplace-'+id` on an "also add to plan" item), else minted here. */
  id?: string;
  name: string;
  legId: string;
  sourceUrl?: string;
  resolvedUrl?: string;
  lat?: number;
  lng?: number;
  note?: string;
  /** Caller-provided ISO instant — used verbatim when present (undo-of-delete restores the original
   * place identically), else stamped `new Date().toISOString()` here. */
  addedAt?: string;
}

export interface MyPlacesStore {
  places: MyPlace[];
  hydrated: boolean;
  /** Add an imported place (id + addedAt injected here unless the caller supplied them). Newest-first, capped at 200. */
  addPlace(input: NewPlaceInput): void;
  /** Remove a place by id. */
  removePlace(id: string): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the my-places domain.
const useMyPlacesStore = createReactiveStore<MyPlace[]>({
  eventName: MY_PLACES_CHANGED_EVENT,
  storageKeys: () => [keyFor('myPlaces')],
  storage: myPlacesStoragePort,
});

/** Generate a collision-resistant id without a new dependency (crypto.randomUUID when available). */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMyPlaces(): MyPlacesStore {
  const { value: places, hydrated, commit } = useMyPlacesStore();

  const add = useCallback(
    (input: NewPlaceInput) => {
      const place: MyPlace = {
        id: input.id ?? newId(),
        name: input.name,
        legId: input.legId,
        addedAt: input.addedAt ?? new Date().toISOString(),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        ...(input.resolvedUrl ? { resolvedUrl: input.resolvedUrl } : {}),
        ...(typeof input.lat === 'number' ? { lat: input.lat } : {}),
        ...(typeof input.lng === 'number' ? { lng: input.lng } : {}),
        ...(input.note ? { note: input.note } : {}),
      };
      commit((current) => addPlace(current, place));
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit((current) => removePlace(current, id));
    },
    [commit],
  );

  return { places, hydrated, addPlace: add, removePlace: remove };
}

// Re-exported so tests/callers can compare byte-transport values directly.
export { loadMyPlaces, saveMyPlaces };
