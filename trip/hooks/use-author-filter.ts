'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  type AuthorFilter,
  ALL_FILTER,
  getAuthorFilter,
  setAuthorFilter,
  subscribeAuthorFilter,
} from '@/lib/author-filter';
import { getPriorUserNames, getUserName } from '@/lib/identity';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

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
  //-C: the names this same user went by BEFORE a rename. Read from the same source, on the
  // same events, as `myName` — a rename fires IDENTITY_CHANGED_EVENT, and that is exactly the
  // moment the list grows, so the two can never be read one rename apart.
  const [myPriorNames, setMyPriorNames] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => {
      setMyName(getUserName());
      // Keep the ARRAY IDENTITY stable when the content is unchanged. `sync` runs on every
      // `itinerary:changed`, and a fresh array each time would defeat React's bail-out and
      // re-run the planner's `useMemo` on every single edit — `myName` (a string) bails out
      // for free, this has to earn it.
      setMyPriorNames((prev) => {
        const next = getPriorUserNames();
        return prev.length === next.length && prev.every((n, i) => n === next[i]) ? prev : next;
      });
    };
    sync();
    // The display name can change when identity is (re)set; the itinerary store fires
    // `itinerary:changed` on edits, and the name prompt writes the name then. Re-reading
    // here on that event keeps "My edits" correct without coupling to identity internals.
    window.addEventListener(ITINERARY_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    // identity itself can change without any itinerary edit — a Settings rename, or
    // the account-identity reconciler ADOPTING the account's name on mount. Without this listener
    // "My edits" keeps resolving against the old name until an unrelated edit happens to fire.
    window.addEventListener(IDENTITY_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(ITINERARY_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener(IDENTITY_CHANGED_EVENT, sync);
    };
  }, []);

  const setFilter = useCallback((next: AuthorFilter) => setAuthorFilter(next), []);

  return { filter, setFilter, myName, myPriorNames };
}
