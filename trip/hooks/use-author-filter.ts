'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  type AuthorFilter,
  ALL_FILTER,
  getAuthorFilter,
  setAuthorFilter,
  subscribeAuthorFilter,
} from '@/lib/author-filter';
import { getUserName } from '@/lib/identity';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';

/**
 * React binding for the shared, presentational author filter.
 *
 * Reads the module-level selection from `lib/author-filter` and re-renders on the
 * same-tab `author-filter:changed` CustomEvent — the SAME lightweight pattern the
 * itinerary store uses for `itinerary:changed`, kept in a separate module so it
 * never entangles the itinerary store or `itinerary-provider.tsx`. Because both the
 * calendar and the timeline use this hook against the one module-level value, ONE
 * selection narrows BOTH surfaces.
 *
 * READ-ONLY: nothing here writes localStorage or calls an itinerary mutator.
 *
 * SSR-safe: `useSyncExternalStore`'s server snapshot returns the inert ALL_FILTER, and
 * the display name is resolved post-mount (localStorage is client-only) so first paint is
 * stable and unfiltered.
 */
export function useAuthorFilter() {
  // Subscribe to the shared selection. The server snapshot is the inert "All" so SSR /
  // static export render every item (matches first client paint before any selection).
  const filter = useSyncExternalStore<AuthorFilter>(
    subscribeAuthorFilter,
    getAuthorFilter,
    () => ALL_FILTER,
  );

  // The current display name ("My edits" resolves to this — the SAME source attribution
  // stamps with, lib/identity). Resolved after mount (localStorage is client-only) and
  // refreshed on the itinerary store's change event, so a name set during this session
  // (e.g. via the token gate / name prompt) is picked up without a reload.
  const [myName, setMyName] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setMyName(getUserName());
    sync();
    // The display name can change when identity is (re)set; the itinerary store fires
    // `itinerary:changed` on edits, and the name prompt writes the name then. Re-reading
    // here on that event keeps "My edits" correct without coupling to identity internals.
    window.addEventListener(ITINERARY_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ITINERARY_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setFilter = useCallback((next: AuthorFilter) => setAuthorFilter(next), []);

  return { filter, setFilter, myName };
}
