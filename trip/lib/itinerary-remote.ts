// The remote-sync seam — the only optional cross-friend surface on top of the
// local store.
//
// This module wraps the existing local store; it never replaces it. It has two
// directions:
//   READ  (remote → local): a Firestore `onSnapshot` on the trip's `days` collection
//         maps docs back to `DayPlan[]`, writes them through the existing
//         `savePlans()` (incl. `[]`), and dispatches the existing
//         `itinerary:changed` CustomEvent. Because that event is already what
//         `use-itinerary.ts`'s reread() listens for, the whole reactive UI (calendar,
//         dashboard, timeline, every card) updates with ZERO component edits.
//   WRITE (local → remote): `pushPlans(prev,next)` is called from the store's
//         `commit()` AFTER the local `savePlans(next)`. It diffs prev→next PER DAY and
//         writes ONLY the changed `trips/{TRIP_ID}/days/{date}` docs (per-day
//         last-write-wins) — a day that became empty writes `items:[]`, a day
//         removed entirely is deleted.
//
// ECHO-SUPPRESSION (critical): `pushPlans` is called ONLY from `commit()`
// (genuine local mutations), NEVER from the snapshot-ingest path — the snapshot path
// calls `savePlans()` + dispatch DIRECTLY, so it can never re-push. Firestore's own
// local-write echo is additionally skipped via `snapshot.metadata.hasPendingWrites`.
// Together these break any write→read→write loop.
//
// FIRST-SNAPSHOT RECONCILIATION: on the first snapshot we read the trip-doc marker
// to distinguish "never synced" from "deliberately emptied", then either apply remote
// authoritatively (incl. empty) or seed remote from local — never losing user data,
// never resurrecting the sample over a deliberately-emptied shared plan (across devices).
//
// DORMANT-SAFE: firebase is imported ONLY via dynamic `import()` behind
// the `isRemoteConfigured()` gate. With the env absent the gate is false, this module's
// SDK code never executes, and firebase tree-shakes off the hot path. A
// misconfigured/unreachable Firebase degrades to local-only (try/catch → console.warn,
// never throw) — it must never crash the app.
//
// CONFIG single-source: config + the on/off gate are read ONLY from
// lib/firebase-config.ts. No process.env.NEXT_PUBLIC_FIREBASE_* reads here.

'use client';

import type { DayPlan, ItineraryItem } from './trip-data';
import { savePlans, hasStoredPlans } from './itinerary-storage';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { FIREBASE_CONFIG, isRemoteConfigured, TRIP_ID } from './firebase-config';

// ---------------------------------------------------------------------------
// Shared lazy firebase handle. Both the read (subscribe) and write (push) paths
// need the same app/auth/firestore instances; init them once, behind the gate, via
// dynamic import (firebase stays off the dormant hot path). The promise is cached
// so concurrent callers share one init + one anonymous sign-in.
// ---------------------------------------------------------------------------

type FirestoreMod = typeof import('firebase/firestore');

interface RemoteHandle {
  db: import('firebase/firestore').Firestore;
  fs: FirestoreMod;
  uid: string;
}

let remotePromise: Promise<RemoteHandle> | null = null;

/**
 * Lazily initialize firebase (app + anonymous auth + firestore) ONCE, behind the
 * `isRemoteConfigured()` gate. Rejects (caller degrades to local-only) if the gate is
 * off or any step fails; never throws synchronously.
 */
function getRemote(): Promise<RemoteHandle> {
  if (!isRemoteConfigured()) {
    return Promise.reject(new Error('remote not configured'));
  }
  if (remotePromise) return remotePromise;

  remotePromise = (async () => {
    const [{ initializeApp, getApps, getApp }, authMod, firestoreMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);

    const { getAuth, signInAnonymously } = authMod;
    const { getFirestore } = firestoreMod;

    // Reuse the singleton app if it already exists (one init across the app),
    // otherwise create it from the single-source config.
    const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

    // Silent anonymous sign-in — NO login UI. The rules gate on
    // request.auth != null, so we must be signed in before any read/write.
    const auth = getAuth(app);
    const cred = await signInAnonymously(auth);

    const db = getFirestore(app);
    return { db, fs: firestoreMod, uid: cred.user.uid };
  })();

  // If init fails, clear the cache so a later call can retry rather than being stuck.
  remotePromise.catch(() => {
    remotePromise = null;
  });

  return remotePromise;
}

/**
 * Map a raw Firestore day-doc into a DayPlan. Defensive: tolerate partial/legacy docs
 * so a malformed remote doc degrades gracefully (it just yields a thin-but-valid
 * DayPlan) rather than throwing inside the snapshot handler.
 */
function docToDayPlan(id: string, data: Record<string, unknown>): DayPlan {
  const date = typeof data.date === 'string' ? data.date : id;
  const country = data.country === 'japan' ? 'japan' : 'nepal';
  const city = typeof data.city === 'string' ? data.city : '';
  const items = Array.isArray(data.items) ? (data.items as ItineraryItem[]) : [];
  return { date, city, country, items };
}

/**
 * Strip `undefined`-valued fields from a day's items before writing to Firestore.
 * Firestore rejects `undefined` field values; our `ItineraryItem` has many optional
 * fields (time/notes/sourceId/updatedBy/...) that are commonly undefined. JSON
 * round-trip drops them cleanly and is also a defensive deep-clone.
 */
function sanitizeDayForWrite(day: DayPlan): Record<string, unknown> {
  return JSON.parse(JSON.stringify(day)) as Record<string, unknown>;
}

/**
 * Stable per-day equality: have this day's persisted contents actually changed
 * prev→next? Compared by value (JSON) so an unchanged day is NOT re-written (keeps
 * writes minimal — only changed day-docs hit Firestore).
 */
function dayEquals(a: DayPlan | undefined, b: DayPlan | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Push local itinerary changes to Firestore (local → remote), per-day.
 *
 * Called from the store's `commit()` AFTER the local `savePlans(next)` — so the offline
 * cache + instant same-tab echo are already in place; the remote write is best-effort
 * on top. Diffs `prev`→`next` by date:
 *   - a day whose contents CHANGED  → `setDoc(days/{date}, {...day})` (LWW per day-doc)
 *     (a day that became empty has `items:[]` and is written, NOT deleted — local parity)
 *   - a day present in `prev` but ABSENT in `next` → `deleteDoc(days/{date})`
 *   - unchanged days are not touched (no spurious writes / no echo storm)
 *
 * ECHO-SUPPRESSION: this is invoked ONLY from `commit()` (genuine local mutations),
 * never from the snapshot path. Items carry their attribution as-is.
 *
 * Gated + lazy + degrading: no-ops when `isRemoteConfigured()` is false; wraps all SDK
 * work in try/catch → console.warn so a failed push NEVER breaks the local edit.
 */
export async function pushPlans(prev: DayPlan[], next: DayPlan[]): Promise<void> {
  // Dormant gate: with no config, never touch firebase.
  if (!isRemoteConfigured()) return;

  try {
    const { db, fs } = await getRemote();
    const { doc, setDoc, deleteDoc } = fs;

    const prevByDate = new Map(prev.map((d) => [d.date, d]));
    const nextByDate = new Map(next.map((d) => [d.date, d]));

    const writes: Promise<void>[] = [];

    // Changed or newly-added days → setDoc that single day-doc.
    for (const day of next) {
      if (!dayEquals(prevByDate.get(day.date), day)) {
        const ref = doc(db, 'trips', TRIP_ID, 'days', day.date);
        writes.push(setDoc(ref, sanitizeDayForWrite(day)));
      }
    }

    // Days removed entirely (in prev, gone from next) → deleteDoc that day-doc.
    for (const day of prev) {
      if (!nextByDate.has(day.date)) {
        const ref = doc(db, 'trips', TRIP_ID, 'days', day.date);
        writes.push(deleteDoc(ref));
      }
    }

    if (writes.length === 0) return; // nothing changed → no network at all
    await Promise.all(writes);
  } catch (err) {
    // A failed push must not break the local edit — degrade to local-only.
    console.warn('[itinerary-remote] push failed, staying local-only:', err);
  }
}

/**
 * Subscribe to remote itinerary changes (remote → local).
 *
 * Opens ONE Firestore `onSnapshot` on `trips/{TRIP_ID}/days` after a silent
 * anonymous sign-in. On each snapshot it assembles the day-docs into a
 * `DayPlan[]` (sorted by date), writes through `savePlans()` and dispatches the
 * `itinerary:changed` CustomEvent — so the existing reactive UI updates with no
 * component edits. Returns an unsubscribe fn.
 *
 * FIRST-SNAPSHOT RECONCILIATION. On the FIRST snapshot we read the trip-doc marker
 * `trips/{TRIP_ID}` once to distinguish "never synced" from "deliberately emptied":
 *   - Trip doc EXISTS (group synced before): remote is authoritative → apply the days
 *     snapshot INCLUDING empty (`savePlans(remoteDays)` even if `[]`). This respects a
 *     deliberately-emptied shared plan (no sample resurrection).
 *   - Trip doc ABSENT (never synced): THIS client seeds → create the trip doc and push
 *     the local state up. Seed source by local intent (localStorage key-presence):
 *     key PRESENT ⇒ push the user's local edits; key ABSENT ⇒ local is the untouched
 *     SAMPLE_ITINERARY → seed from the sample. Local is left as-is (never overwritten
 *     with an empty remote).
 *
 * STEADY-STATE (later snapshots): apply remote → `savePlans(remoteDays incl. [])` +
 * dispatch, SKIPPING any snapshot whose `metadata.hasPendingWrites` is true (the
 * client's own optimistic-write echo). Another device's edits + deletions
 * appear; local edits aren't clobbered because they were pushed before they round-trip.
 *
 * Gating & safety: no-ops (returns a no-op unsubscribe) when `isRemoteConfigured()` is
 * false. All SDK/network work is wrapped so any failure degrades to local-only
 * via console.warn and never throws.
 *
 * @param onRemoteChange optional callback invoked (after the local write + dispatch)
 *        with the assembled plans each time a remote snapshot is applied.
 * @returns an unsubscribe function (always safe to call, even on the dormant path).
 */
export function subscribeRemote(
  onRemoteChange?: (plans: DayPlan[]) => void,
): () => void {
  // Dormant gate: with no config, never touch firebase.
  if (!isRemoteConfigured()) return () => {};

  // The real Firestore unsubscribe, once the async setup resolves. Until then,
  // `cancelled` lets a synchronous unmount cancel the in-flight subscribe.
  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;

  // True once an `onSnapshot` listener is live. Guards the offline→online retry from
  // ever opening a SECOND listener: once established, Firestore's own client
  // auto-reconnects and re-delivers across drops, so no app-level retry is needed.
  let established = false;

  // Guards a single in-flight setup so a concurrent retry (e.g. an `online` event firing
  // while the initial setup is still awaiting sign-in) can't open two listeners.
  let settingUp = false;

  // First-snapshot reconciliation runs exactly once; later snapshots are steady-state.
  let firstSnapshotHandled = false;

  // One-shot `online` retry plumbing (offline→online recovery). If the INITIAL
  // setup fails while offline (e.g. anonymous sign-in can't reach the network, so no
  // listener is ever established), there is nothing for Firestore to auto-reconnect.
  // We register a window `online` listener that re-attempts setup when connectivity
  // returns, then remove it once we're established (or on unsubscribe). Gated + lazy +
  // dormant-safe: this whole function only runs when `isRemoteConfigured()` is true and
  // firebase is reached solely via the dynamic import in getRemote().
  let onlineHandler: (() => void) | null = null;
  const removeOnlineHandler = () => {
    if (onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', onlineHandler);
    }
    onlineHandler = null;
  };
  const armOnlineRetry = () => {
    // Only arm once, only in a browser, only while still wanted and not yet established.
    if (onlineHandler || cancelled || established || typeof window === 'undefined') return;
    onlineHandler = () => {
      removeOnlineHandler(); // one-shot; attemptSetup re-arms if it fails again
      if (cancelled || established) return;
      void attemptSetup();
    };
    window.addEventListener('online', onlineHandler);
  };

  // Apply a remote snapshot to the local store (the shared steady-state write path).
  // Writes through the EXISTING persistence (incl. `[]`) and dispatches the
  // EXISTING event DIRECTLY — NOT via commit() — so the snapshot path never
  // re-pushes (echo-suppression).
  const applyRemote = (plans: DayPlan[]) => {
    plans.sort((a, b) => a.date.localeCompare(b.date)); // stable local shape
    savePlans(plans);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));
    }
    onRemoteChange?.(plans);
  };

  // Lazy, gated setup. All wrapped — any failure degrades to local-only and
  // never throws ("misconfigured/unreachable → local-only"). Idempotent + retryable:
  // returns early if already established/cancelled, and on failure arms the `online` retry
  // so a cold-offline start recovers when the network returns.
  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;

      const { collection, onSnapshot, doc, getDoc, getDocFromServer, setDoc, serverTimestamp } = fs;
      const daysCol = collection(db, 'trips', TRIP_ID, 'days');

      firestoreUnsub = onSnapshot(
        daysCol,
        (snapshot) => {
          // Skip the echo of the client's OWN optimistic write: when we push a
          // day, Firestore fires a local snapshot with hasPendingWrites=true before the
          // server round-trip. Applying it is redundant (local already has it) and could
          // race; the authoritative server snapshot follows with hasPendingWrites=false.
          if (snapshot.metadata.hasPendingWrites) return;

          // FIRST-SNAPSHOT must reconcile against SERVER truth, never a cold/empty cache.
          // onSnapshot can deliver a cache-sourced first event (e.g. right after the
          // listener (re)establishes following an offline window) — an EMPTY one would
          // wrongly look like "never synced" and could drive the seed branch, wiping a
          // peer's real remote with the local sample. So we DEFER reconciliation until the
          // first `fromCache === false` (server) snapshot. A pre-server cache snapshot is
          // simply ignored here: the local store already holds the correct first-paint data
          // (localStorage or the in-memory sample), so skipping it is non-destructive.
          // Once reconciled, steady-state applies every later snapshot (cache or server),
          // by which point the cache is warm and correct.
          if (!firstSnapshotHandled && snapshot.metadata.fromCache) return;

          (async () => {
            try {
              const remoteDays: DayPlan[] = snapshot.docs.map((d) =>
                docToDayPlan(d.id, d.data() as Record<string, unknown>),
              );

              if (!firstSnapshotHandled) {
                firstSnapshotHandled = true;
                await reconcileFirstSnapshot(
                  remoteDays,
                  { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp },
                  applyRemote,
                );
                return;
              }

              // Steady-state: remote is authoritative, apply incl. empty.
              // This is also the path Firestore drives when it AUTO-RECONNECTS after an
              // offline window: the listener stays attached and re-delivers the merged
              // server state (a friend's offline edits flushed on reconnect arrive here),
              // and our own offline writes round-trip through the hasPendingWrites guard —
              // no duplicate, no wipe.
              applyRemote(remoteDays);
            } catch (err) {
              // A bad single snapshot must not break the stream or the app.
              console.warn('[itinerary-remote] failed to apply remote snapshot:', err);
            }
          })();
        },
        (err) => {
          // Stream error (rules/network/quota). Firestore retries transient/network errors
          // on its own behind a live listener, so we stay local-only and never throw.
          // For a terminal error it detaches the listener; arm the `online` retry
          // so a later reconnect can re-establish from scratch.
          console.warn('[itinerary-remote] snapshot stream error:', err);
          established = false;
          firestoreUnsub = null;
          if (!cancelled) armOnlineRetry();
        },
      );

      // We have a live listener. Mark established and drop any pending online-retry —
      // from here Firestore handles reconnection internally.
      established = true;
      removeOnlineHandler();

      // If we were unmounted while awaiting setup, tear the listener straight down.
      if (cancelled && firestoreUnsub) {
        firestoreUnsub();
        firestoreUnsub = null;
        established = false;
      }
    } catch (err) {
      // Init / sign-in / dynamic-import failure → degrade to local-only.
      // The common cause is a cold start while OFFLINE (anonymous sign-in can't reach the
      // network). getRemote() clears its cached promise on failure, so a retry gets a
      // fresh attempt; arm the `online` listener to fire that retry on reconnect.
      console.warn('[itinerary-remote] remote sync unavailable, staying local-only:', err);
      if (!cancelled) armOnlineRetry();
    } finally {
      settingUp = false;
    }
  };

  void attemptSetup();

  // Unsubscribe: cancel an in-flight setup, tear down the live listener if present, and
  // remove the online-retry listener so nothing leaks after unmount.
  return () => {
    cancelled = true;
    removeOnlineHandler();
    if (firestoreUnsub) {
      firestoreUnsub();
      firestoreUnsub = null;
    }
    established = false;
  };
}

/**
 * First-snapshot reconciliation handshake. Reads the trip-doc marker once to decide
 * between "remote authoritative" and "this client seeds".
 *
 * Imports nothing eagerly — the firestore fns are passed in from the gated, lazy
 * getRemote() handle so this stays off the dormant hot path.
 */
async function reconcileFirstSnapshot(
  remoteDays: DayPlan[],
  ctx: {
    db: import('firebase/firestore').Firestore;
    doc: FirestoreMod['doc'];
    getDoc: FirestoreMod['getDoc'];
    getDocFromServer: FirestoreMod['getDocFromServer'];
    setDoc: FirestoreMod['setDoc'];
    serverTimestamp: FirestoreMod['serverTimestamp'];
  },
  applyRemote: (plans: DayPlan[]) => void,
): Promise<void> {
  const { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp } = ctx;
  const tripRef = doc(db, 'trips', TRIP_ID);

  // The trip-doc marker is the "has this group ever synced" signal. Read it from
  // the SERVER so a fresh client doesn't see a stale/absent cached value as authoritative
  // — using getDocFromServer makes that explicit (a plain getDoc may serve an empty cache
  // after an offline window, which would wrongly look like "never synced" and seed the
  // sample over a peer's real remote). Fall back to a cache getDoc only if the
  // server read fails, and even then only the never-wipe-on-empty interpretation applies.
  let tripExists = false;
  try {
    let tripSnap;
    try {
      tripSnap = await getDocFromServer(tripRef);
    } catch {
      tripSnap = await getDoc(tripRef); // server unreachable → best-effort cache read
    }
    tripExists = tripSnap.exists();
  } catch (err) {
    // If the marker read fails, fall back to the safe interpretation: treat a non-empty
    // remote as authoritative, but NEVER wipe local with an empty remote.
    console.warn('[itinerary-remote] trip-doc marker read failed:', err);
    if (remoteDays.length > 0) applyRemote(remoteDays);
    return;
  }

  if (tripExists) {
    // Group synced before → remote authoritative, apply INCLUDING empty.
    // This is what makes "A deletes everything → B reflects empty and STAYS empty after
    // reload" true: an emptied shared plan is a real state, not a trigger to reseed.
    applyRemote(remoteDays);
    return;
  }

  // Trip doc ABSENT → never synced → THIS client seeds the group.
  // Seed source by LOCAL intent (key-presence): key present ⇒ the user's own
  // local edits (incl. a deliberate empty); key absent ⇒ the untouched SAMPLE_ITINERARY
  // that loadPlans() returned at first paint. Either way we read the local truth and
  // push it up. We do NOT overwrite local (no applyRemote on this branch) — local is
  // already correct; seeding makes remote match local. (`hasStoredPlans()` is read for
  // the explicit intent signal even though we always seed from the local snapshot.)
  const { loadPlans } = await import('./itinerary-storage');
  const localPlans = loadPlans();
  const localIsUserData = hasStoredPlans(); // present ⇒ user edits; absent ⇒ sample seed

  try {
    // Create the trip-doc marker first so a concurrent second client sees "synced" and
    // takes the authoritative branch instead of double-seeding.
    await setDoc(tripRef, {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      seededFrom: localIsUserData ? 'local-edits' : 'sample',
    });

    // Push every local day up via the per-day write path (reuse pushPlans with an empty
    // prev so every present day is written; no day is "removed").
    await pushPlans([], localPlans);
  } catch (err) {
    console.warn('[itinerary-remote] first-snapshot seed failed, staying local-only:', err);
  }
  // Local stays as-is; the seed round-trips back as a steady-state snapshot (which our
  // hasPendingWrites guard + value-identical savePlans make a no-op for the UI).
}
