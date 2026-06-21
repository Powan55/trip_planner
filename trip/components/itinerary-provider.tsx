'use client';

import { createContext, useContext } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';

/**
 * React Context that instantiates the shared itinerary store ONCE at the app root.
 * Consumers (calendar, dashboard, and every place card) read the one shared
 * instance via `useItineraryContext()` rather than each holding an independent
 * copy of the state.
 *
 * Mounted inside `<ThemeProvider>` in `app/layout.tsx` (the layout is a server
 * component; this client provider nests fine).
 */

const ItineraryContext = createContext<ItineraryStore | null>(null);

export function ItineraryProvider({ children }: { children: React.ReactNode }) {
  const store = useItinerary();
  return <ItineraryContext.Provider value={store}>{children}</ItineraryContext.Provider>;
}

export function useItineraryContext(): ItineraryStore {
  const ctx = useContext(ItineraryContext);
  if (ctx === null) {
    throw new Error('useItineraryContext must be used within an <ItineraryProvider>');
  }
  return ctx;
}
