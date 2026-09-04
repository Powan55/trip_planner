'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { useDomainSync } from '@/hooks/use-domain-sync';
import { isRemoteConfigured } from '@/lib/firebase-config';
import {
  getActiveTraveler,
  signIn,
  IDENTITY_CHANGED_EVENT,
  DEFAULT_TRAVELER_NAME,
} from '@/lib/token-auth';
import {
  getActiveTripId,
  DEFAULT_TRIP_ID,
  tripMetaSelfHealGuard,
  getSyncCode,
  nameHintFlag,
} from '@/core/storage/gateway';
import { getKnownTrip, renameKnownTrip, setTripConfig, SHARED_NAME } from '@/core/trips/registry';
import { itineraryStoragePort, itineraryOutboxSync, itinerarySyncPort } from '@/lib/itinerary-ports';
import { expensesSyncPort, expensesOutboxSync, expensesStoragePort } from '@/lib/expenses-ports';
import { budgetSyncPort, budgetOutboxSync, budgetStoragePort } from '@/lib/budget-ports';
import { docsSyncPort, docsOutboxSync, docsStoragePort } from '@/lib/docs-ports';
import { placesSyncPort, placesOutboxSync, myPlacesStoragePort } from '@/lib/places-ports';
import { withBasePath } from '@/lib/utils';
import { toast } from 'sonner';
import TokenGate from '@/components/token-gate';
import PresenceBar from '@/components/presence-bar';
import FirstRunTour from '@/components/first-run-tour';
import dynamic from 'next/dynamic';

// the relaunch bounce + arrival toast + #30's visit autocount (combined in TravelModeMounts) ride
// ONE `dynamic(ssr:false)` to stay OUT of the app-wide First Load chunk — the route
// budgets sit AT the 106/107 kB line. All three are non-blocking (two boot-once null-render islands
// and a deferred suggestion), so a post-hydration mount is exactly right; no loading placeholder
// needed. Add a fourth island to that file rather than a second `dynamic()` here.
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
  if (!nameHintFlag.consume()) return;
  toast("You're signed in as Traveler — rename yourself in Settings.", {
    action: {
      label: 'Settings',
      onClick: () => window.location.assign(withBasePath('/settings/')),
    },
  });
}

/**
 * ACCOUNT-IDENTITY RECONCILER — the display name is an attribute of the ACCOUNT.
 *
 * THE DEFECT IT FIXES: `signIn` writes two localStorage slots and nothing else, and the token-only
 * door falls back to `DEFAULT_TRAVELER_NAME`, so a rename never left the device — log in from a
 * private window or a second device and you were "Traveler" again. Nothing read a remote name
 * because nothing wrote one.
 *
 * A ONE-SHOT `getDoc` on provider mount (not a subscribe — nobody asked for a name to change live
 * on a second device mid-session), same gates / lazy import / `cancelled` shape as
 * `runTripMetaSelfHeal` above.'s ordered rule:
 * 1. remote present ∧ ≠ local ⇒ ADOPT via `signIn(remote)`. REMOTE WINS on conflict — the account
 * is the source of truth, and a device that disagrees is either stale or the login default.
 * 🔴 It must be `signIn`, NEVER a bare `setUserName`: `getActiveTraveler()` reads the TOKEN
 * slot while `lib/attribution.ts` stamps from `getUserName()` — the NAME slot — and they agree
 * only because `signIn` writes both. Writing one alone displays one name and stamps another.
 * (A naive "local wins if set" rule would instead be VACUOUS: `handleLogin` always writes a
 * name into the local slot before its reload, so the slot is never empty when this runs.)
 * 2. remote absent ∧ local is not the placeholder ⇒ BACKFILL (the once-per-account migration).
 * 3. remote absent ∧ local IS the placeholder ⇒ DO NOTHING. Never publish "Traveler": two devices
 * with no doc yet race, and a device already showing the placeholder would publish it TO THE
 * ACCOUNT for the other to adopt — re-creating the defect and making it sticky.
 *
 * 🔴 SIGN-OUT SAFETY: the `.then` re-checks the account AND the traveler are
 * unchanged and the effect was not cleaned up before calling `signIn` — a late resolve landing
 * after `signOut()` would otherwise resurrect a signed-out session.
 *
 * NO TIMEOUT / BUDGET BRANCH, deliberately: neither writer navigates (this reconciler
 * and the Settings rename both stay on the page), so the write-dies-in-flight shape is
 * unreachable rather than mitigated, and a second unexercised fallback branch would be pure cost.
 *
 * THE NUDGE RIDES ALONG. `consumeNameHint`'s toast used to fire from its own mount effect, i.e.
 * BEFORE this read lands — post-fix it would tell a user their name is Traveler moments before it
 * becomes Powan. It now fires only where the placeholder really is the final answer: branch 3, or
 * the gates being shut (dormant / no account / signed out), where no account layer exists to
 * correct it. Accepted: a read still in flight when the tab is closed leaves the one-shot flag for
 * the next load, which is the same behaviour it already had across a reload.
 *
 * Cold-start flash: the local name paints first and swaps when the read lands. Self-limiting — the
 * adopt writes through to localStorage, so it happens at most once per device, on the first load
 * after a fresh login.
 */
export function runAccountIdentitySync(): () => void {
  const noop = () => {};
  const local = getActiveTraveler();
  const code = getSyncCode();
  // Dormant / no account / signed out: nothing can ever correct the placeholder, so the nudge is
  // exactly right and there is no read to issue.
  if (!isRemoteConfigured() || !code || !local) {
    consumeNameHint();
    return noop;
  }

  let cancelled = false;
  void import('@/lib/trips-remote')
    .then(({ fetchAccountIdentity, pushAccountIdentity }) =>
      fetchAccountIdentity(code).then((remote) => {
        if (cancelled) return;
        // Re-read, don't trust the closure: a sign-out (or a sign-in as someone else) may have
        // landed while the read was in flight.
        const now = getActiveTraveler();
        if (!now || now.token !== local.token || getSyncCode() !== code) return;

        if (remote) {
          if (remote !== now.name) signIn(remote); // 1 — adopt (both slots, one primitive)
          return;
        }
        if (now.name !== DEFAULT_TRAVELER_NAME) {
          void pushAccountIdentity(code, now.name); // 2 — backfill this device's real name
          return;
        }
        consumeNameHint(); // 3 — the placeholder is the answer; never publish it
      }),
    )
    .catch((err) => {
      console.warn('[itinerary-provider] account identity sync unavailable:', err);
    });

  return () => {
    cancelled = true;
  };
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
        // A merge that moves the active-trip pointer takes the SAME switch primitive as a local
        // switch — pointer write, then a full reload — because the pack constants are frozen at
        // module evaluation (core/trips/registry).
        unsubscribe = subscribeTripList(code, (activeTripChanged) => {
          if (activeTripChanged) window.location.reload();
        });
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

/**
 * #10 — MEMBERSHIP ENROLMENT, once per page load, for the active non-default trip.
 *
 * `ensureMembership` reads the trip doc and adds THIS device's uid to its `members` map if the
 * trip has one and this device is not in it (or takes `owner` on a grandfathered members-less
 * trip). It costs one server read on every load after the first, and nothing else — the
 * already-enrolled branch writes nothing.
 *
 * Gated exactly like the domain sync effects: configured build ∧ a non-default (non-sample) trip
 * ∧ an identified traveler. A guest never enrols, and the local-only sample has no members map at
 * all. Firebase is reached only through the dynamic import, after every gate.
 *
 * THE REFUSAL PATH IS THE PRODUCT, NOT AN ERROR. A trip that is member-gated and does not list
 * this device refuses the READ, so `ensureMembership` dispatches `trip:access-pending` rather than
 * throwing, and this is where that becomes one toast telling the user what to do about it. The
 * listener is registered BEFORE the enrolment starts, and torn down with the effect.
 *
 * 🔴 The event name is a LITERAL here on purpose: importing `TRIP_ACCESS_PENDING_EVENT` from
 * `lib/trips-remote` would drag that module — and firebase behind it — onto this provider's
 * static chunk, which is the one thing every gate in this file exists to prevent. The two are
 * pinned equal by `lib/__tests__/trip-membership.test.ts`.
 *
 * Extracted (like `runTripMetaSelfHeal`) so it has a runnable unit check without mounting the
 * whole provider tree. Returns the effect cleanup.
 */
export function runTripMembership(): () => void {
  const noop = () => {};
  if (!isRemoteConfigured()) return noop;
  const activeId = getActiveTripId();
  if (activeId === DEFAULT_TRIP_ID) return noop; // the sample is local-only — no members map
  if (!getActiveTraveler()) return noop; // guest / signed-out never enrols

  const onAccessPending = () => {
    toast(
      'You don’t have access to this trip yet — ask a member to add this device (Settings → Trip access).',
      // One toast, even if the event were ever to fire twice in a load (a dev double-mount).
      { id: 'trip-access-pending' },
    );
  };
  window.addEventListener('trip:access-pending', onAccessPending);

  void import('@/lib/trips-remote')
    .then(({ ensureMembership }) => ensureMembership(activeId))
    .catch((err) => {
      console.warn('[itinerary-provider] membership enrolment unavailable:', err);
    });

  return () => {
    window.removeEventListener('trip:access-pending', onAccessPending);
  };
}

export function ItineraryProvider({ children }: { children: React.ReactNode }) {
  const store = useItinerary();

  // #10 — the wall now WITHHOLDS the app, it does not merely cover it. `{children}` render only
  // for an identified traveler, so a logged-out visitor's DOM (and the static-export HTML, whose
  // SSR snapshot is the signed-out one) carries NO trip content — closing the login.spec.ts
  // "readable via view-source/devtools behind the overlay" finding. The mounted flag is the same
  // SSR-safe idiom TokenGate uses: `useActiveTraveler` yields the inert `{traveler:null}` on the
  // server and the first client render, so gating on it alone would blank the first paint for
  // EVERYONE; mount-gating keeps server and first client render agreeing (both empty), then the
  // real traveler read decides. Reactive via identity:changed, so sign-in mounts the app live
  // and sign-out unmounts it at once.
  const { traveler } = useActiveTraveler();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Gated remote sync for the five synced domains — flush-then-subscribe on mount and
  // reactively on `IDENTITY_CHANGED_EVENT` (D-240: sign-out fires it without a reload, so a
  // mount-once subscription would keep syncing a signed-out session), `online`/tab-return just
  // flush. Each call is the same shape (D-378, `useDomainSync`), gated through its own
  // `SyncPort.isConfigured()` — all five on the per-trip `isTripRemoteConfigured()`, because all
  // five remotes compose `trips/{getTripId()}/…` and the default sample pack has no remote trip id.
  useDomainSync(itineraryOutboxSync, itineraryStoragePort, itinerarySyncPort);
  useDomainSync(expensesOutboxSync, expensesStoragePort, expensesSyncPort);
  useDomainSync(budgetOutboxSync, budgetStoragePort, budgetSyncPort);
  useDomainSync(docsOutboxSync, docsStoragePort, docsSyncPort);
  useDomainSync(placesOutboxSync, myPlacesStoragePort, placesSyncPort);

  // TRIP-META SELF-HEAL — see `runTripMetaSelfHeal` (extracted so it has a runnable unit check
  // without mounting the whole provider tree, same as `createSyncCodeTripListSync` above).
  useEffect(() => runTripMetaSelfHeal(), []);

  // #10 — MEMBERSHIP ENROLMENT + the access-pending toast. See `runTripMembership`.
  useEffect(() => runTripMembership(), []);

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

  // ACCOUNT IDENTITY — adopt/backfill the account's display name, and consume the
  // post-login "Traveler" nudge only where the placeholder is the final answer. See
  // `runAccountIdentitySync`; it owns the (previously unconditional) `consumeNameHint` call.
  useEffect(() => runAccountIdentitySync(), []);

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
      {/* #10 — children render ONLY for an identified traveler (mount-gated, see above). The
          pre-#10 behavior ("content stays mounted BEHIND the wall") left the whole app — trip
          name, dates, itinerary — in a logged-out visitor's DOM under a mere overlay. */}
      {mounted && traveler ? children : null}
      {/* Trip Token landing gate. No guest mode since
          — every logged-out visitor sees this wall. Mounted UNCONDITIONALLY —
          the component derives its state from useActiveTraveler() alone (`show = mounted &&
          (held || !traveler)`), with NO pathname term, so it already covers /travel exactly
          like every other route — which is why travel-date-picker.tsx deliberately carries
          no identity redirect of its own. This is the SINGLE gate mount in the app.
          z-[70] sits above name-prompt's z-[60]. Dormant-safe:
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
          auto-suggest toast + #30's visit autocount (behavioral, renders null), behind one lazy
          boundary. Siblings of the tour so they ride every route behind the gate; all three are
          guest-blocked, and the first two self-suppress on /travel. */}
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
