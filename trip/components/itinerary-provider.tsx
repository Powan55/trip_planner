'use client';

import { createContext, useContext, useEffect } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { isRemoteConfigured } from '@/lib/firebase-config';
import NamePrompt from '@/components/name-prompt';

/**
 * React Context that instantiates the shared itinerary store ONCE at the app root.
 * Consumers (calendar, dashboard, and every place card) read
 * the one shared instance via `useItineraryContext()` rather than each holding an
 * independent copy of the state.
 *
 * Mounted inside `<ThemeProvider>` in `app/layout.tsx` (the layout is a server
 * component; this client provider nests fine).
 *
 * Remote sync: this provider is also the single home for the gated
 * remote subscribe. The effect below opens the Firestore `onSnapshot` (remote → local)
 * ONLY when `isRemoteConfigured()` is true; dormant, it never imports firebase. The
 * subscribe fans remote changes into the SAME store via `savePlans()` + the
 * `itinerary:changed` event, so no consumer component changes. `useItineraryContext()`'s
 * shape is unchanged.
 */

const ItineraryContext = createContext<ItineraryStore | null>(null);

export function ItineraryProvider({ children }: { children: React.ReactNode }) {
  const store = useItinerary();

  // Gated remote READ subscription. Mounts once at app root; the
  // gate keeps the dormant build byte-for-byte today's app (no firebase import runs).
  // `subscribeRemote` is itself import()'d lazily so the firebase SDK stays off the
  // dormant bundle's hot path. Effect runs client-side only.
  useEffect(() => {
    if (!isRemoteConfigured()) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    import('@/lib/itinerary-remote')
      .then(({ subscribeRemote }) => {
        if (cancelled) return;
        unsubscribe = subscribeRemote();
      })
      .catch((err) => {
        // Degrade to local-only; never crash.
        console.warn('[itinerary-provider] remote sync unavailable:', err);
      });
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return (
    <ItineraryContext.Provider value={store}>
      {children}
      {/* Name-on-first-use prompt. Self-gated: renders NOTHING when
          remote sync is off (dormant build unchanged) or a name is already set.
          Mounted once at the app root, alongside the gated remote subscribe. */}
      <NamePrompt />
    </ItineraryContext.Provider>
  );
}

export function useItineraryContext(): ItineraryStore {
  const ctx = useContext(ItineraryContext);
  if (ctx === null) {
    throw new Error('useItineraryContext must be used within an <ItineraryProvider>');
  }
  return ctx;
}
