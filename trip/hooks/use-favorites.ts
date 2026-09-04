'use client';

import { useCallback } from 'react';
import { keyFor, hasKey, favoritesStore } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { createReactiveStore } from '@/hooks/create-reactive-store';

/**
 * Reactive favorites store. A THIN React adapter over
 * the gateway's key-14 `favoritesStore`, wiring `createReactiveStore` exactly like
 * `hooks/use-journal.ts` — SIMPLER still: the persisted value is just a `string[]` of
 * `Recommendation` ids, so there is no separate framework-free domain module (: local-only,
 * no sync fan-out, no attribution), and this file owns only `sanitizeIds` + the two mutators.
 *
 * Reactivity (all of it inside the shared factory):
 * - `toggle` writes through the StoragePort AND dispatches a same-tab CustomEvent
 * (`FAVORITES_CHANGED_EVENT`) on `window`, so every card + the "Saved" chip (both read this
 * hook, one instance per `RecommendationSection`) update live.
 * - The hook listens for that CustomEvent (same-tab liveness) AND the cross-tab `storage`
 * event, re-reading from storage on either — via the exported key constant, never a literal.
 *
 * SSR-safe + hydrated gate: every consumer (`recommendation-section`, `map-section`,
 * `trip-map`) is a `dynamic({ssr:false})` island, so the factory's `storage.load()` seed
 * produces no server DOM to mismatch; `toggle` reads the FRESHEST persisted state as its base
 * (not a stale React closure). `hydrated` is exposed so a consumer (the favorite toggle button)
 * can defer rendering until post-hydration.
 */

import { FAVORITES_CHANGED_EVENT } from '@/core/storage/events';
export { FAVORITES_CHANGED_EVENT };

/** Coerce any parsed-from-storage value into a valid `string[]` of ids: non-empty strings only, deduped, order preserved. Never throws. */
function sanitizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function loadFavorites(): string[] {
  return sanitizeIds(favoritesStore.get<unknown>([]));
}

function saveFavorites(ids: string[]): void {
  favoritesStore.set<string[]>(sanitizeIds(ids));
}

/** The favorites `StoragePort<string[]>` for `createReactiveStore` — local-only, no sync. */
const favoritesStoragePort: StoragePort<string[]> = {
  load: loadFavorites,
  save: saveFavorites,
  has: () => hasKey('local', keyFor('favorites')),
};

export interface FavoritesStoreApi {
  favorites: string[];
  hydrated: boolean;
  isFavorite(id: string): boolean;
  toggle(id: string): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the favorites domain.
// Local-only: no `sync` port (key 14 is deliberately not synced — the D-229 addendum).
const useFavoritesStore = createReactiveStore<string[]>({
  eventName: FAVORITES_CHANGED_EVENT,
  storageKeys: () => [keyFor('favorites')],
  storage: favoritesStoragePort,
});

export function useFavorites(): FavoritesStoreApi {
  const { value: favorites, hydrated, commit } = useFavoritesStore();

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  const toggle = useCallback(
    (id: string) => {
      commit((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    },
    [commit],
  );

  return { favorites, hydrated, isFavorite, toggle };
}
