'use client';

import { useCallback } from 'react';
import { keyFor, favoritesStore, hasKey } from '@/core/storage/gateway';
import { createReactiveStore } from '@/hooks/create-reactive-store';

/**
 * Reactive favorites store. A THIN React adapter over
 * the gateway's key-14 `favoritesStore`, mirroring `hooks/use-expenses.ts` /
 * `hooks/use-journal.ts` exactly — SIMPLER still: the persisted value is just a `string[]` of
 * `Recommendation` ids, so there is no separate framework-free domain module (: local-only,
 * no sync fan-out, no attribution).
 *
 * Reactivity:
 * - `createReactiveStore` owns hydration, same-tab and cross-tab listeners, and the one commit
 * path, exactly as it does for expenses and journal.
 *
 * SSR-safe + hydrated gate (mirrors `use-expenses.ts`): the shared factory seeds from its
 * storage port (`[]` under SSR), re-reads storage on mount, and makes `toggle` use the FRESHEST
 * persisted state as its base (not a stale React closure). `hydrated` is exposed so a consumer
 * (the favorite toggle button) can defer rendering until post-hydration — no SSR/first-paint
 * mismatch.
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

const useFavoritesStore = createReactiveStore<string[]>({
  eventName: FAVORITES_CHANGED_EVENT,
  storageKeys: () => [keyFor('favorites')],
  storage: {
    load: loadFavorites,
    save: saveFavorites,
    has: () => hasKey('local', keyFor('favorites')),
  },
});

export interface FavoritesStoreApi {
  favorites: string[];
  hydrated: boolean;
  isFavorite(id: string): boolean;
  toggle(id: string): void;
}

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
