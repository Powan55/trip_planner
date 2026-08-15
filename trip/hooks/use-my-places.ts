'use client';

import { useCallback, useMemo } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadMyPlaces, saveMyPlaces, myPlacesStoragePort } from '@/core/places/storage';
import { placesSyncPort } from '@/lib/places-ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import { isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { clock } from '@/lib/trip-now';
import { firstSyncStamp, nextSyncStamp } from '@/core/sync/stamp';
import { addPlace, removePlace, type MyPlace } from '@/core/places/model';

/**
 * Reactive my-places store. A THIN React adapter over the framework-free places core
 * (`core/places/model.ts`) + the load/save adapter (`core/places/storage.ts`, gateway key 31),
 * wiring `createReactiveStore` WITH the places `SyncPort` — the shared factory owns
 * hydrate/listen/commit; this file owns only the place-specific mutators, the id/timestamp
 * injection, and the sync stamping gate (all I/O concerns that stay out of the pure core).
 *
 * ── SYNC (issue #17, D-229 addendum) ──────────────────────────────────────────────────────────
 * Passing `sync` here is the whole wiring gap that made saved places per-device. The stamping is
 * gated on `isTripRemoteConfigured()` — the TRIP-scoped gate, because a place belongs to a leg of
 * the ACTIVE trip and the doc path is `trips/{tripId}/places/list`:
 * - LOCAL-ONLY (dormant build, or the default sample pack whose remote id is retired): no `rev`/
 *   `hlc` is written and a delete still PHYSICALLY removes the row — the slot stays byte-identical
 *   to a pre-#17 checklist and nothing errors on the empty trip id.
 * - SYNCED (custom trip + Firebase config): an add stamps `rev`/`hlc` and a delete writes a
 *   TOMBSTONE (`deleted:true` + an advanced `hlc`) instead of dropping the row, so the removal
 *   propagates instead of being resurrected by the peer's next snapshot. The exposed `places`
 *   filters tombstones out, so the UI is unchanged.
 *
 * Instantiated per-consumer (no provider): every `useMyPlaces()` stays in lockstep through the
 * CustomEvent. The remote subscribe is opened once at the app root (itinerary-provider).
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
  /** The LIVE places (tombstones filtered out). Newest-first. */
  places: MyPlace[];
  hydrated: boolean;
  /** Add an imported place (id + addedAt injected here unless the caller supplied them). Newest-first, capped at 200. */
  addPlace(input: NewPlaceInput): void;
  /** Remove a place by id (a tombstone under sync, a physical drop when local-only). */
  removePlace(id: string): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the my-places domain WITH its
// SyncPort. The factory's commit tail fires `placesSyncPort.push(prev, next)` fire-and-forget AFTER
// the local save + dispatch; the push self-gates on `isTripRemoteConfigured()` + an active traveler
// behind a dynamic import, so the dormant build pulls no firebase.
const useMyPlacesStore = createReactiveStore<MyPlace[]>({
  eventName: MY_PLACES_CHANGED_EVENT,
  storageKeys: () => [keyFor('myPlaces')],
  storage: myPlacesStoragePort,
  sync: placesSyncPort,
});

// Sync gate + actor (firebase-free, dormant-safe — mirrors use-docs, but on the TRIP-scoped gate).
function syncEnabled(): boolean {
  return isTripRemoteConfigured();
}
function actor(): string {
  return getActiveTraveler()?.name ?? getUserName() ?? '';
}

/** Generate a collision-resistant id without a new dependency (crypto.randomUUID when available). */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMyPlaces(): MyPlacesStore {
  const { value: rows, hydrated, commit } = useMyPlacesStore();

  // Tombstones are a transport concern; the UI only ever sees live places. Identity-stable when
  // nothing changed, so the card grid does not re-render on an unrelated commit.
  const places = useMemo(() => rows.filter((p) => p.deleted !== true), [rows]);

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
      if (!syncEnabled()) {
        commit((current) => addPlace(current, place));
        return;
      }
      const now = clock.now().getTime();
      const name = actor();
      commit((current) => {
        // Advance from ANY prior row with this id — including a TOMBSTONE. That is what makes
        // undo-of-delete work: `hlcSendOrLocal` guarantees the new stamp is STRICTLY greater than
        // the tombstone's, so the restored row wins the merge. A fresh id has no prior and starts
        // at rev 1. (Seeding a re-add with `firstSyncStamp` would tie the tombstone on a same-ms
        // undo, and a tie keeps the tombstone — the restore would silently bounce.)
        const prior = current.find((p) => p.id === place.id);
        const stamped: MyPlace = {
          ...place,
          ...(prior ? nextSyncStamp(prior, now, name) : firstSyncStamp(now, name)),
        };
        return addPlace(current, stamped);
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      if (!syncEnabled()) {
        commit((current) => removePlace(current, id));
        return;
      }
      const now = clock.now().getTime();
      const name = actor();
      // TOMBSTONE, not a physical filter: a removed row must stay removed after the next remote
      // snapshot. `deleted:true` + an advanced hlc is the itinerary's `stampSyncDeleted` discipline
      // applied to a `MyPlace` (that helper is `ItineraryItem`-typed; the rev/hlc math it uses is
      // the shared `nextSyncStamp` primitive called here).
      commit((current) =>
        current.map((p) => (p.id === id ? { ...p, deleted: true, ...nextSyncStamp(p, now, name) } : p)),
      );
    },
    [commit],
  );

  return { places, hydrated, addPlace: add, removePlace: remove };
}

// Re-exported so tests/callers can compare byte-transport values directly.
export { loadMyPlaces, saveMyPlaces };
