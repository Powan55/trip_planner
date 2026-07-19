'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { keyFor, favoritesStore } from '@/core/storage/gateway';

/**
 * Reactive favorites store. A THIN React adapter over
 * the gateway's key-14 `favoritesStore`, mirroring `hooks/use-expenses.ts` /
 * `hooks/use-journal.ts` exactly — SIMPLER still: the persisted value is just a `string[]` of
 * `Recommendation` ids, so there is no separate framework-free domain module (: local-only,
 * no sync fan-out, no attribution).
 *
 * Reactivity:
 * - `toggle` writes via `favoritesStore.set()` AND dispatches a same-tab CustomEvent
 * (`FAVORITES_CHANGED_EVENT`) on `window`, so every card + the "Saved" chip (both read this
 * hook, one instance per `RecommendationSection`) update live.
 * - The hook listens for that CustomEvent (same-tab liveness) AND the cross-tab `storage`
 * event, re-reading from storage on either — via the exported key constant, never a literal.
 *
 * SSR-safe + hydrated gate (mirrors `use-expenses.ts`): the list starts `[]` (matching the
 * server render), hydrates from storage in a mount effect, and `toggle` reads the FRESHEST
 * persisted state as its base (not a stale React closure). `hydrated` is exposed so a consumer
 * (the favorite toggle button) can defer rendering until post-hydration — no SSR/first-paint
 * mismatch.
 */

export const FAVORITES_CHANGED_EVENT = 'favorites:changed';

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

export interface FavoritesStoreApi {
  favorites: string[];
  hydrated: boolean;
  isFavorite(id: string): boolean;
  toggle(id: string): void;
}

export function useFavorites(): FavoritesStoreApi {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Load from localStorage on mount. SSR-safe: matches the server's [] first paint; the real
  // read happens here after mount.
  useEffect(() => {
    setFavorites(loadFavorites());
    setHydrated(true);
    hydratedRef.current = true;
  }, []);

  // Re-read on a same-tab CustomEvent OR a cross-tab `storage` event, so every store instance
  // (every RecommendationSection on the page) stays in sync within and across tabs.
  useEffect(() => {
    const reread = () => {
      if (!hydratedRef.current) return;
      setFavorites(loadFavorites());
    };
    const onCustom = () => reread();
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor('favorites') || e.key === null) reread();
    };
    window.addEventListener(FAVORITES_CHANGED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FAVORITES_CHANGED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Single commit path: derive `next` from the freshest persisted state, write through
  // `saveFavorites`, update React state, then dispatch the same-tab CustomEvent so other store
  // instances re-read. Gated on `hydrated` so the first-render [] can't clobber a saved list.
  const commit = useCallback((compute: (current: string[]) => string[]) => {
    if (!hydratedRef.current) return;
    const prev = loadFavorites();
    const next = compute(prev);
    saveFavorites(next);
    setFavorites(next);
    window.dispatchEvent(new CustomEvent(FAVORITES_CHANGED_EVENT));
  }, []);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  const toggle = useCallback(
    (id: string) => {
      commit((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    },
    [commit],
  );

  return { favorites, hydrated, isFavorite, toggle };
}
