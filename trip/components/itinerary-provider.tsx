'use client';

import { createContext, useContext, useEffect } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';
import { itineraryStoragePort, itineraryOutboxSync, itinerarySyncPort } from '@/lib/itinerary-ports';
import { expensesSyncPort, expensesOutboxSync, expensesStoragePort } from '@/lib/expenses-ports';
import { budgetSyncPort, budgetOutboxSync, budgetStoragePort } from '@/lib/budget-ports';
import { flushOutbox } from '@/core/sync/outbox';
import TokenGate from '@/components/token-gate';
import PresenceBar from '@/components/presence-bar';
import FirstRunTour from '@/components/first-run-tour';

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
  // The subscribe routes through `itinerarySyncPort.subscribe`, which import()s
  // firebase lazily so the SDK stays off the dormant bundle's hot path.
  //
  // Also gate on an active traveler. Guests (and signed-out users) browse
  // LOCAL-ONLY and must never open the Firestore subscription — only a token sign-in
  // (getActiveTraveler() truthy) activates remote sync. `getActiveTraveler` is pure
  // (token-auth, firebase-free) so the dormant build still imports no firebase.
  //
  // The subscription is driven REACTIVELY by the
  // `identity:changed` signal, not only by mount. `activate()` opens the gated subscribe
  // (re-checking both gates each time); `teardown()` closes any open one. On a sign-in we
  // teardown→activate (opening sync LIVE, no reload); on sign-out we teardown (sync stops
  // immediately). The dormant-safe property is unchanged: `activate()` short-circuits
  // before any firebase import unless `isRemoteConfigured()` AND an active traveler.
  //
  // The subscribe routes through `itinerarySyncPort.subscribe` (which owns the
  // gated dynamic `import('@/lib/itinerary-remote')` + the cancel-proxy unsub), so this
  // effect matches the expense/budget effects below exactly. The port returns a synchronous
  // proxy unsub, dormant-gates to a no-op, and swaps in `subscribeRemote()`'s real unsub
  // once the import resolves.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    // FLUSH-THEN-SUBSCRIBE (the reload fix). Flush the offline outbox
    // FIRST so an edit made offline last session is re-pushed exactly once, THEN open the
    // subscribe. flushOutbox self-gates + never throws; if the first server snapshot still races
    // ahead of the flush, subscribeRemote's dirty-chunk merge exception keeps the unpushed edit.
    const flush = () => {
      void flushOutbox(itineraryOutboxSync, itineraryStoragePort);
    };

    const activate = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      flush(); // ① flush the outbox before ② opening the subscribe (push-before-subscribe)
      unsubscribe = itinerarySyncPort.subscribe();
    };

    // Flush triggers: reconnect (`online`) and tab-return (`visibilitychange` →
    // visible). flushOutbox no-ops when dormant/guest or the set is clean, so these are harmless
    // on the dormant build (no slot write, byte-identical).
    const onOnline = () => flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    // Open it on mount for a returning signed-in traveler (today's behavior)...
    activate();

    // ...and re-evaluate whenever identity changes: sign-in opens it live,
    // sign-out tears it down at once.
    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      teardown();
    };
  }, []);

  // Gated EXPENSE remote sync. Mirrors the itinerary effect above and its
  // dormant/guest gates: flush-then-subscribe on mount + reactively on
  // `identity:changed`, driven through the expense SyncPort's own `subscribe`
  // (one subscribe surface). `expensesSyncPort.subscribe` self-gates on
  // `isRemoteConfigured()` (a no-op unsub when dormant, pulling NO firebase); we add the traveler
  // gate here to match the itinerary (a guest never opens the expense subscription). Flush no-ops
  // when dormant/guest or the outbox is clean, so `online`/visible are harmless on the dormant
  // build (no slot write, byte-identical).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const flush = () => {
      void flushOutbox(expensesOutboxSync, expensesStoragePort);
    };

    const activate = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      flush(); // ① flush the outbox before ② opening the subscribe (push-before-subscribe)
      unsubscribe = expensesSyncPort.subscribe();
    };

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const onOnline = () => flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    activate();

    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      teardown();
    };
  }, []);

  // Gated BUDGET remote sync. Mirrors the expense effect above and its
  // dormant/guest gates: flush-then-subscribe on mount + reactively on
  // `identity:changed`, driven through the budget SyncPort's own `subscribe` (one subscribe surface).
  // `budgetSyncPort.subscribe` self-gates on `isRemoteConfigured()` (a no-op unsub when dormant,
  // pulling NO firebase); the traveler gate here matches the itinerary (a guest never opens the
  // budget subscription). Flush no-ops when dormant/guest or the outbox is clean, so `online`/visible
  // are harmless on the dormant build (no slot write, byte-identical).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const flush = () => {
      void flushOutbox(budgetOutboxSync, budgetStoragePort);
    };

    const activate = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      flush(); // ① flush the outbox before ② opening the subscribe (push-before-subscribe)
      unsubscribe = budgetSyncPort.subscribe();
    };

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const onOnline = () => flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    activate();

    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      teardown();
    };
  }, []);

  // Gated presence HEARTBEAT. Mirrors the remote-subscribe effect above and
  // its dormant/guest gate: start the per-traveler heartbeat ONLY when
  // `isRemoteConfigured()` AND an active token traveler is present; dormant or guest pulls
  // NO firebase (`startPresence` short-circuits before any `import('@/lib/presence')` — it
  // imports the pure, firebase-free `lib/presence.ts` gate, and firebase itself only loads
  // behind that gate). The heartbeat is driven reactively by `identity:changed`:
  // sign-in starts it live (immediate beat + >=30s interval, paused when the tab is hidden),
  // sign-out stops it (clears the interval + best-effort deletes the presence doc so the
  // traveler drops off the bar at once). The `<PresenceBar/>` below renders the READ side.
  useEffect(() => {
    let cancelled = false;

    // Start/stop are imported lazily so the dormant bundle pulls neither this module nor,
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
      {/* Trip Token landing gate (two modes). The app's front-door WALL when there's no
          active traveler and the user isn't a guest, AND the guest-route wall confining
          guests to Home (every non-Home pathname is gated). Mounted UNCONDITIONALLY — the
          component derives its own mode from useActiveTraveler() + usePathname() and renders
          null when neither triggers. This is the SINGLE gate mount in the app. Content stays
          mounted BEHIND it so localStorage hydration / first paint happen normally.
          z-[70] sits above name-prompt's z-[60]. Dormant-safe: imports only pure modules,
          never firebase. */}
      <TokenGate />
      {/* First-run guided tour. A sibling of <TokenGate />, so it is present on
          every route behind the gate. Renders nothing until the gate has passed AND the
          tour hasn't been seen yet (`tourStore`) — post-mount gated
          exactly like TokenGate so it never flashes during SSR/first paint. z-[65] sits
          below the gate (z-[70], mutually exclusive with this dialog since the tour only
          shows once the gate has resolved) and above the other z-[60] dialogs/scroll
          progress bar. */}
      <FirstRunTour />
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
