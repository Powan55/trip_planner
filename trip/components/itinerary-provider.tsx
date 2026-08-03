'use client';

import { createContext, useContext, useEffect } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';
import { getActiveTripId, DEFAULT_TRIP_ID, tripMetaSelfHealGuard, getSyncCode } from '@/core/storage/gateway';
import { getKnownTrip, renameKnownTrip, setTripConfig, SHARED_NAME } from '@/core/trips/registry';
import { itineraryStoragePort, itineraryOutboxSync, itinerarySyncPort } from '@/lib/itinerary-ports';
import { expensesSyncPort, expensesOutboxSync, expensesStoragePort } from '@/lib/expenses-ports';
import { budgetSyncPort, budgetOutboxSync, budgetStoragePort } from '@/lib/budget-ports';
import { docsSyncPort, docsOutboxSync, docsStoragePort } from '@/lib/docs-ports';
import { flushOutbox } from '@/core/sync/outbox';
import { withBasePath } from '@/lib/utils';
import { toast } from 'sonner';
import TokenGate from '@/components/token-gate';
import PresenceBar from '@/components/presence-bar';
import FirstRunTour from '@/components/first-run-tour';
import dynamic from 'next/dynamic';

// the relaunch bounce + arrival toast (combined in TravelModeMounts) ride ONE
// `dynamic(ssr:false)` to stay OUT of the app-wide First Load chunk — the route
// budgets sit AT the 106/107 kB line. Both are non-blocking (a boot-once null-render bounce and a
// deferred suggestion), so a post-hydration mount is exactly right; no loading placeholder needed.
const TravelModeMounts = dynamic(() => import('@/components/travel-mode-mounts'), { ssr: false });

/**
 * React Context that instantiates the shared itinerary store ONCE at the app root
 * Consumers read
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

/**
 * A5: consume the one-shot `name-hint` flag that `token-gate`'s token-only login leaves
 * when the display name silently defaulted to "Traveler". Cleared BEFORE the toast so a reload
 * can never double-fire. Exported so the behavior has a runnable unit check without mounting the
 * whole provider tree. SSR-safe (no-op without `window`).
 */
export function consumeNameHint(): void {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('name-hint') !== '1') return;
  sessionStorage.removeItem('name-hint');
  toast("You're signed in as Traveler — rename yourself in Settings.", {
    action: {
      label: 'Settings',
      onClick: () => window.location.assign(withBasePath('/settings/')),
    },
  });
}

/**
 * the sync-code trip-list subscription lifecycle, extracted so its
 * identity-change teardown/re-arm has a runnable unit check without mounting the whole provider.
 * Returns `{ activate, teardown }`; the provider effect wires them to mount + `identity:changed`,
 * matching the four sibling domain sync effects (which inline the same shape via their SyncPorts).
 *
 * `signOut()` fires `identity:changed` WITHOUT a reload, so a mount-once subscription would keep
 * merging remote trip-list changes into a signed-out session — violating the "guest/signed-
 * out never syncs" posture. `activate()` re-checks all gates each call (`isRemoteConfigured()` AND
 * a stored Sync Code AND an active traveler); `teardown()` closes any open subscription.
 * Firebase-gated: `activate()` short-circuits before the lazy `import('@/lib/trips-remote')` on the
 * dormant build, so the shipped build is byte-identical — latent-correctness only. A
 * `loadToken` invalidates a late import resolve across teardown/re-arm.
 */
export function createSyncCodeTripListSync(): { activate: () => void; teardown: () => void } {
  let unsubscribe: (() => void) | null = null;
  let loadToken = 0;

  const teardown = () => {
    loadToken++; // ignore any import() still in flight for the prior identity
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const activate = () => {
    if (!isRemoteConfigured()) return;
    const code = getSyncCode();
    if (!code || !getActiveTraveler()) return;
    if (unsubscribe) return; // already subscribed for the current identity
    const token = ++loadToken;
    void import('@/lib/trips-remote')
      .then(({ subscribeTripList }) => {
        if (token !== loadToken) return; // torn down / re-armed since this import began
        unsubscribe = subscribeTripList(code);
      })
      .catch((err) => {
        console.warn('[itinerary-provider] sync-code subscribe unavailable:', err);
      });
  };

  return { activate, teardown };
}

/**
 * TRIP-META SELF-HEAL. A joiner who switched to a non-default trip
 * (the `?trip=` handshake or the trips-hub "Join" form) but has NO local config for it — a fresh
 * browser, or a `pushTripMeta` write that never landed — fetches the trip's remote name/config and
 * applies it, then reloads exactly once so every config-reading surface (countdown target,
 * dashboard dates, destinations) picks it up. Unlike the domain subscribes it does NOT gate on an
 * active traveler: it is a single READ of public trip identity (the whole point is to orient a
 * brand-new joiner who has nothing local yet), not a continuous sync channel. Dynamically imports
 * `lib/trips-remote` so the dormant/default-pack build pulls no firebase — every gate is
 * checked before that import. Returns the effect cleanup (cancels a late resolve).
 *
 * — WHAT THE GUARD MEANS, AND WHY IT MOVED. `tripMetaSelfHealGuard` is sessionStorage-backed
 * and is now set only when the fetch actually FOUND a doc. It previously ran before the existence
 * check, which turned "the creator's write hasn't landed yet" into a PERMANENT dead trip for the
 * whole session: no day cells, and a reload could not recover because the guard outlives it. The
 * guard's real job is narrower — stop a reload LOOP when the found doc has a name but no config
 * (nothing is written locally, so the `?.config` gate below stays open on the next load) — and
 * that still holds, because every reload path is downstream of `markRun`.
 *
 * RETRY CADENCE this creates: the provider mounts in the root layout, so this runs ONCE PER FULL
 * DOCUMENT LOAD (client-side route changes do not remount it). A trip still missing its meta doc
 * therefore costs at most one `getDoc` per page load, and stops entirely the moment either gate
 * closes (config present, or a doc found). No timer, no interval, no listener — it cannot storm.
 * in-session recovery needs a reload; deliberately no poll/visibilitychange retry, which
 * is exactly the unbounded request path this fix must not introduce.
 */
export function runTripMetaSelfHeal(): () => void {
  const noop = () => {};
  if (!isRemoteConfigured()) return noop;
  const activeId = getActiveTripId();
  if (activeId === DEFAULT_TRIP_ID) return noop; // default pack has no remote TripConfigBlock flow
  if (getKnownTrip(activeId)?.config) return noop; // already has a local config — nothing to heal
  if (tripMetaSelfHealGuard.hasRun(activeId)) return noop; // already healed this trip this session

  let cancelled = false;
  void import('@/lib/trips-remote')
    .then(({ fetchTripMeta }) => fetchTripMeta(activeId))
    .then((remote) => {
      if (cancelled) return;
      if (!remote) return; // not there YET (or unreachable) — leave the guard unset so a later load retries
      tripMetaSelfHealGuard.markRun(activeId); // found it: caps the reload below to one per session
      const current = getKnownTrip(activeId);
      // Only overwrite the local name if it's still the join-time placeholder — never clobber
      // a name the user (or a peer's own rename push) already set.
      if (current?.name === SHARED_NAME) renameKnownTrip(activeId, remote.name);
      if (remote.config) setTripConfig(activeId, remote.config);
      window.location.reload(); // one guarded reload so every config-reading surface re-hydrates
    })
    .catch((err) => {
      console.warn('[itinerary-provider] trip meta self-heal failed:', err);
    });

  return () => {
    cancelled = true;
  };
}

export function ItineraryProvider({ children }: { children: React.ReactNode }) {
  const store = useItinerary();

  // Gated remote READ subscription. Mounts once at app root; the
  // gate keeps the dormant build byte-for-byte today's app (no firebase import runs).
  // The subscribe routes through `itinerarySyncPort.subscribe`, which import()s
  // firebase lazily so the SDK stays off the dormant bundle's hot path.
  //
  // /: also gate on an active traveler. Guests (and signed-out users) browse
  // LOCAL-ONLY and must never open the Firestore subscription — only a token sign-in
  // (getActiveTraveler() truthy) activates remote sync. `getActiveTraveler` is pure
  // (token-auth, firebase-free) so the dormant build still imports no firebase.
  //
  // the subscription is now driven REACTIVELY by the
  // `identity:changed` signal, not only by mount. `activate()` opens the gated subscribe
  // (re-checking both gates each time); `teardown()` closes any open one. On a sign-in we
  // teardown→activate (opening sync LIVE, no reload); on sign-out we teardown (sync stops
  // immediately). The dormant-safe property is unchanged: `activate()` short-circuits
  // before any firebase import unless `isRemoteConfigured()` AND an active traveler.
  //
  // the subscribe now routes through `itinerarySyncPort.subscribe` (which already owns the
  // gated dynamic `import('@/lib/itinerary-remote')` + the cancel-proxy unsub), so the port's
  // subscribe surface is LIVE and its dead twin is gone — this effect matches the expense/budget
  // effects below exactly. Behavior is byte-identical: the port returns a synchronous proxy unsub,
  // dormant-gates to a no-op, and swaps in `subscribeRemote()`'s real unsub once the import resolves.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    // FLUSH-THEN-SUBSCRIBE. Flush the offline outbox
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
    // on the dormant build.
    const onOnline = () => flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    // Open it on mount for a returning signed-in traveler (today's behavior)...
    activate();

    // ..and re-evaluate whenever identity changes: sign-in opens it live,
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
  // `identity:changed`, driven through the expense SyncPort's own `subscribe` ( —
  // one subscribe surface, no dead twin). `expensesSyncPort.subscribe` self-gates on
  // `isRemoteConfigured()` (a no-op unsub when dormant, pulling NO firebase); we add the traveler
  // gate here to match the itinerary (a guest never opens the expense subscription). Flush no-ops
  // when dormant/guest or the outbox is clean, so `online`/visible are harmless on the dormant
  // build.
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
  // are harmless on the dormant build.
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

  // Gated DOCS-CHECKLIST remote sync. Mirrors the budget effect above and its
  // dormant/guest gates: flush-then-subscribe on mount + reactively on
  // `identity:changed`, driven through the docs SyncPort's own `subscribe` (one subscribe surface).
  // `docsSyncPort.subscribe` self-gates on `isRemoteConfigured()` (a no-op unsub when dormant,
  // pulling NO firebase); the traveler gate here matches the others (a guest never opens the docs
  // subscription). Flush no-ops when dormant/guest or the outbox is clean, so `online`/visible are
  // harmless on the dormant build.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const flush = () => {
      void flushOutbox(docsOutboxSync, docsStoragePort);
    };

    const activate = () => {
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      flush(); // ① flush the outbox before ② opening the subscribe (push-before-subscribe)
      unsubscribe = docsSyncPort.subscribe();
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

  // TRIP-META SELF-HEAL — see `runTripMetaSelfHeal` (extracted so it has a runnable unit check
  // without mounting the whole provider tree, same as `createSyncCodeTripListSync` above).
  useEffect(() => runTripMetaSelfHeal(), []);

  // SYNC-CODE trip-list subscription. Mirrors the self-heal effect's
  // gating shape, but opens a LIVE `onSnapshot` on `trips/{syncCode}/profile/tripList` instead of a
  // one-shot read: it merges the owner's known-trips list across their devices (a trip created on
  // one device shows up on all of them). Gated on `isRemoteConfigured()` AND a stored Sync Code AND
  // an active traveler.
  // Dynamically imports `lib/trips-remote` so the dormant/no-code build pulls no firebase;
  // the gate check runs before the import.
  //
  // driven REACTIVELY by `identity:changed`, like the four domain sync effects + the presence
  // heartbeat above (see `createSyncCodeTripListSync` for the why — sign-out fires identity:changed
  // without a reload, so a mount-once subscription would outlive the session).
  useEffect(() => {
    const { activate, teardown } = createSyncCodeTripListSync();
    activate();
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

  // A5: consume the post-login "Traveler" name hint once, after the login reload.
  useEffect(() => {
    consumeNameHint();
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

    // ..and re-evaluate on identity change: sign-in starts the heartbeat live, sign-out
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
      {/* Trip Token landing gate. No guest mode since
          — every logged-out visitor sees this wall. Mounted UNCONDITIONALLY —
          the component derives its state from useActiveTraveler() alone (`show = mounted &&
          (held || !traveler)`), with NO pathname term, so it already covers /travel exactly
          like every other route — which is why travel-date-picker.tsx deliberately carries
          no identity redirect of its own. This is the SINGLE gate mount in the app.
          Content stays mounted BEHIND it so localStorage hydration / first paint happen
          normally. z-[70] sits above name-prompt's z-[60]. Dormant-safe:
          imports only pure modules, never firebase. */}
      <TokenGate />
      {/* First-run guided tour. A sibling of <TokenGate />, so it is present on
          every route behind the gate. Renders nothing until the gate has passed AND the
          tour hasn't been seen yet (gateway key 17, `tourStore`) — post-mount gated
          exactly like TokenGate so it never flashes during SSR/first paint. z-[65] sits
          below the gate (z-[70], mutually exclusive with this dialog since the tour only
          shows once the gate has resolved) and above the other z-[60] dialogs/scroll
          progress bar. */}
      <FirstRunTour />
      {/* PWA-relaunch re-enter (behavioral, renders null) + the on-trip arrival
          auto-suggest toast, behind one lazy boundary. Siblings of the tour so they ride every
          route behind the gate; both are guest-blocked and self-suppress on /travel. */}
      <TravelModeMounts />
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
