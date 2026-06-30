'use client';

import { createContext, useContext, useEffect } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';
import TokenGate from '@/components/token-gate';
import PresenceBar from '@/components/presence-bar';

/**
 * React Context that instantiates the shared itinerary store ONCE at the app root
 *. Consumers (calendar, dashboard, and — — every place card) read
 * the one shared instance via `useItineraryContext` rather than each holding an
 * independent copy of the state.
 *
 * Mounted inside `<ThemeProvider>` in `app/layout.tsx` (the layout is a server
 * component; this client provider nests fine).
 *
 * Remote sync (M9, /): this provider is also the single home for the gated
 * remote subscribe. The effect below opens the Firestore `onSnapshot` (remote → local)
 * ONLY when `isRemoteConfigured` is true; dormant, it never imports firebase. The
 * subscribe fans remote changes into the SAME store via `savePlans` + the
 * `itinerary:changed` event, so no consumer component changes. `useItineraryContext`'s
 * shape is unchanged.
 */

const ItineraryContext = createContext<ItineraryStore | null>(null);

export function ItineraryProvider({ children }: { children: React.ReactNode }) {
  const store = useItinerary();

  // Gated remote READ subscription. Mounts once at app root; the
  // gate keeps the dormant build byte-for-byte today's app (no firebase import runs).
  // `subscribeRemote` is itself import'd lazily so the firebase SDK stays off the
  // dormant bundle's hot path. Effect runs client-side only.
  
  // / also gate on an active traveler. Guests (and signed-out users) browse
  // LOCAL-ONLY and must never open the Firestore subscription — only a token sign-in
  // (getActiveTraveler truthy) activates remote sync. `getActiveTraveler` is pure
  // (token-auth, firebase-free) so the dormant build still imports no firebase.
  
  // (resolves the seam): the subscription is now driven REACTIVELY by the
  // `identity:changed` signal, not only by mount. `activate` opens the gated subscribe
  // (re-checking both gates each time); `teardown` closes any open one. On a sign-in we
  // teardown→activate (opening sync LIVE, no reload); on sign-out we teardown (sync stops
  // immediately). The dormant-safe property is unchanged: `activate` short-circuits
  // before any `import('@/lib/itinerary-remote')` unless `isRemoteConfigured` AND an
  // active traveler, so the dormant bundle still pulls no firebase.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let token = 0; // guards against a stale async import resolving after a teardown

    const teardown = () => {
      token++;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const activate = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      const mine = ++token;
      import('@/lib/itinerary-remote')
        .then(({ subscribeRemote }) => {
          // A teardown (sign-out / unmount) that happened during the import wins.
          if (mine !== token) return;
          unsubscribe = subscribeRemote();
        })
        .catch((err) => {
          // Degrade to local-only; never crash.
          console.warn('[itinerary-provider] remote sync unavailable:', err);
        });
    };

    // Open it on mount for a returning signed-in traveler (today's behavior)...
    activate();

    // ...and re-evaluate whenever identity changes: sign-in opens it live (the seam)
    // sign-out tears it down at once.
    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      teardown();
    };
  }, []);

  // Gated presence HEARTBEAT. Mirrors the remote-subscribe effect above and
  // its dormant/guest gate: start the per-traveler heartbeat ONLY when
  // `isRemoteConfigured` AND an active token traveler is present; dormant or guest pulls
  // NO firebase (`startPresence` short-circuits before any `import('@/lib/presence')` — it
  // imports the pure, firebase-free `lib/presence.ts` gate, and firebase itself only loads
  // behind that gate). The heartbeat is driven reactively by `identity:changed`
  // sign-in starts it live (immediate beat + >=30s interval, paused when the tab is hidden)
  // sign-out stops it (clears the interval + best-effort deletes the presence doc so the
  // traveler drops off the bar at once). The `<PresenceBar/>` below renders the READ side.
  useEffect(() => {
    let cancelled = false;

    // Start/stop are imported lazily so the dormant bundle pulls neither this module nor
    // through it, firebase (the firebase SDK only loads inside startPresence's gated path).
    const start = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      import('@/lib/presence')
        .then(({ startPresence }) => {
          if (cancelled) return;
          startPresence();
        })
        .catch((err) => {
          console.warn('[itinerary-provider] presence heartbeat unavailable:', err);
        });
    };

    const stop = () => {
      if (!isRemoteConfigured()) return; // dormant ⇒ nothing was ever started
      import('@/lib/presence')
        .then(({ stopPresence }) => stopPresence())
        .catch(() => {
          /* best-effort teardown; never throw */
        });
    };

    // Start on mount for a returning signed-in traveler...
    start();

    // ...and re-evaluate on identity change: sign-in starts the heartbeat live, sign-out
    // stops it (and clears the doc). Mirrors the remote-subscribe teardown→activate.
    const onIdentityChanged = () => {
      stop();
      start();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      stop();
    };
  }, []);

  return (
    <ItineraryContext.Provider value={store}>
      {children}
      {/* Trip Token landing gate (, M10 / ··). The app's front-door
          WALL: shows in EVERY build (always-on client feature) when there's no active
          traveler and the user isn't a guest, and dissolves on a valid token or the
          guest bypass. Content stays mounted BEHIND it so localStorage hydration / first
          paint happen normally (preserves ). z-[70] sits above name-prompt's
          z-[60]. Dormant-safe: imports only pure modules, never firebase. */}
      <TokenGate />
      {/* Active-traveler presence bar. Renders nothing — and pulls no
          firebase — when dormant or guest (usePresence short-circuits on the same gate as
          the remote subscribe). A small fixed bottom-left cluster at z-40, clear of the
          navbar (z-50), gate (z-[70]) and bottom-right toasts. The heartbeat WRITE side is
          driven by the effect above; this is the READ side. */}
      <PresenceBar />
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
