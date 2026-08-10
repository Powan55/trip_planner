// The presence seam — "who else is on the trip right now".
//
// This module is the presence analog of lib/itinerary-remote.ts. It owns the ONLY new
// Firestore collection adds: a heartbeat doc per traveler at
// `trips/{TRIP_ID}/presence/{uid}`, shape
// `{ name, lastSeen: serverTimestamp() }`. It never touches the `days` model or its
// per-day LWW. It has two directions:
// WRITE (heartbeat): while the tab is OPEN and VISIBLE, `startPresence()` writes the
// traveler's heartbeat once immediately, then on an interval (>=30s). The write
// is PAUSED when the tab is hidden (`visibilitychange`) and resumed when visible.
// `stopPresence()` clears the interval, removes listeners, and best-effort deletes
// the doc so the traveler drops off the bar immediately on sign-out / unmount.
// READ (subscribe): `subscribePresence(cb)` opens ONE `onSnapshot` on the presence
// collection (<=3 docs) and maps docs → `PresenceRecord[]`. The caller filters to
// "active" travelers via `isActive(lastSeen)`.
//
// DORMANT-SAFE: firebase is imported
// ONLY via dynamic `import()` behind `isRemoteConfigured()`. With the env absent the gate
// is false, none of this module's SDK code executes, and firebase tree-shakes off the
// first-load chunk. WRITE is additionally gated on an identified traveler so a
// guest never writes/opens a connection. A misconfigured/unreachable Firebase degrades to
// local-only (try/catch → console.warn, never throw) — it must never crash the app.
//
// FREE-TIER: cadence is HEARTBEAT_MS (>=30s) and the
// loop is PAUSED while hidden, so it can never become a sustained sub-30s write loop.
// Budget: ~1 write / HEARTBEAT_MS / traveler. At 60s × 3 travelers ≈ 4,320 writes/day ≈
// ~22% of Spark's ~20k writes/day. One onSnapshot on <=3 docs is negligible reads.
//
// REUSES the existing firebase init: it awaits itinerary-remote.ts's `getRemote()`, which owns
// the one app + the one anonymous session. There is no second initialization path here.
//
// CONFIG single-source: the config + on/off gate are read ONLY from
// lib/firebase-config.ts. No process.env.NEXT_PUBLIC_FIREBASE_* reads here.

import { isTripRemoteConfigured, getTripId } from './firebase-config';
import { getActiveTraveler } from './token-auth';
import { getRemote, isPermissionDenied, type RemoteHandle } from './itinerary-remote';
import { deviceStore } from '@/core/storage/gateway';

// ---------------------------------------------------------------------------
// Tuning constants. HEARTBEAT_MS MUST stay >= 30_000 (free-tier hard rule).
// ACTIVE_WINDOW_MS is the "active = lastSeen within N min" window; a small constant a bit
// larger than the heartbeat so a single missed/late beat doesn't flicker a traveler off.
// ---------------------------------------------------------------------------

/** Heartbeat cadence. >= 30s. */
export const HEARTBEAT_MS = 60_000;

/** A traveler counts as "active now" if their lastSeen is within this window (~3 min). */
export const ACTIVE_WINDOW_MS = 3 * 60_000;

/** A presence record as surfaced to the UI. `lastSeen` is epoch ms (or null if pending). */
export interface PresenceRecord {
  /** The traveler's anon uid (doc id). */
  uid: string;
  /** Display name written into the heartbeat. */
  name: string;
  /** Last heartbeat as epoch ms, or null while the serverTimestamp is still pending. */
  lastSeen: number | null;
}

// ---------------------------------------------------------------------------
// Firebase handle. This module used to own a SECOND lazy init (its own
// initializeApp/getFirestore promise, deduped only by getApps()). #10 deleted it: the rules now
// impose an auth floor (`request.auth != null`) on every presence write, and a duplicate init
// that did NOT await the anonymous sign-in could — and on a cold start would — issue the first
// heartbeat before the floor was satisfied, which under the new stop-on-denied rule below would
// kill presence for the whole session over a pure race. `getRemote()` is now the ONE seam every
// remote path awaits, so presence simply awaits it too.
// ---------------------------------------------------------------------------

/**
 * The shared, gated, lazy firebase handle (app + firestore + a signed-in anonymous session).
 * Kept as a named re-export rather than inlined at the three call sites so this module's
 * intent — "presence never initializes firebase itself" — stays readable.
 */
export function getPresence(): Promise<Pick<RemoteHandle, 'db' | 'fs'>> {
  return getRemote();
}

/**
 * Coerce a raw Firestore `lastSeen` field into epoch ms (or null while pending).
 * Tolerates a Firestore Timestamp (`toMillis`/`seconds`), a number, or undefined so a
 * malformed/legacy doc degrades gracefully rather than throwing inside the snapshot handler.
 */
function toMillis(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object') {
    const ts = raw as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  }
  return null;
}

/**
 * Is a heartbeat recent enough to count as "active now"? Pure + injectable `now` for tests.
 * A null `lastSeen` (serverTimestamp still pending locally) is treated as active — it's the
 * client's own just-written beat round-tripping; the server value follows momentarily.
 */
export function isActive(lastSeen: number | null, now: number = Date.now()): boolean {
  if (lastSeen == null) return true;
  return now - lastSeen <= ACTIVE_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// WRITE — the heartbeat loop. One active loop per tab (module-level singleton), tied to the
// active traveler. start → immediate write + interval; pause on hidden; resume on visible;
// stop → clear interval + listeners + best-effort delete the doc.
// ---------------------------------------------------------------------------

interface HeartbeatLoop {
  /** The traveler name this loop is beating for (used to detect an identity change). */
  name: string;
  intervalId: ReturnType<typeof setInterval> | null;
  onVisibility: (() => void) | null;
  /** True once stop() has run, so a late async write resolving after stop is dropped. */
  stopped: boolean;
}

let loop: HeartbeatLoop | null = null;

/**
 * Write this traveler's heartbeat doc (`setDoc` with merge so the doc is created or
 * refreshed). Gated + lazy + degrading: no-ops when the gate is off or there's no active
 * traveler; wraps SDK work in try/catch → console.warn so a failed beat never breaks the app.
 */
async function writeHeartbeat(): Promise<void> {
  // #10: trip-scoped gate — the default pack is a local-only sample with no presence collection.
  if (!isTripRemoteConfigured()) return;
  const traveler = getActiveTraveler();
  if (!traveler) return; // guest / signed-out: never write

  try {
    const { db, fs } = await getPresence();
    // A stop() during the await wins — don't write after teardown.
    if (loop?.stopped) return;
    const { doc, setDoc, serverTimestamp } = fs;
    const ref = doc(db, 'trips', getTripId(), 'presence', deviceStore.getId());
    await setDoc(
      ref,
      { name: traveler.name, lastSeen: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    // #10 — DENIED IS NOT A TRANSIENT FAILURE. The rules refused this write because this device is
    // not (yet) a member of the trip, and every retry for the rest of the session will be refused
    // identically. Left alone it is a write attempt every HEARTBEAT_MS forever against the free
    // tier's quota, and a console line every minute. So tear the loop down and warn ONCE. Nothing
    // is deleted (the delete would be denied too) and nothing is surfaced to the user here —
    // `ensureMembership`'s `trip:access-pending` toast is the one place that explains it.
    // Membership arriving later re-arms the heartbeat on the next page load.
    if (isPermissionDenied(err)) {
      teardownLoop();
      console.warn('[presence] heartbeat denied by the rules — this device is not a member of this trip; loop stopped');
      return;
    }
    // Any other failed heartbeat must not break the app — degrade to silent local-only.
    console.warn('[presence] heartbeat write failed, staying local-only:', err);
  }
}

/**
 * Begin the heartbeat for the currently-active traveler.
 *
 * Dormant/guest-safe: no-ops (and pulls NO firebase) when `isRemoteConfigured()` is false
 * or there's no active traveler. One loop per tab — calling start again for
 * the SAME traveler is a no-op; calling it for a DIFFERENT traveler restarts cleanly.
 *
 * Writes once immediately (so the bar shows the traveler at once), then every HEARTBEAT_MS
 * (>=30s) WHILE THE TAB IS VISIBLE. A `visibilitychange` listener pauses the interval when
 * `document.hidden` and resumes (with an immediate catch-up write) when visible — the
 * free-tier guarantee. SSR-guarded (no `window`/`document` ⇒ no-op).
 */
export function startPresence(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isTripRemoteConfigured()) return; // dormant or the local-only default pack (#10) ⇒ no loop
  const traveler = getActiveTraveler();
  if (!traveler) return; // guest / signed-out ⇒ never start

  // Already beating for this exact traveler — nothing to do.
  if (loop && !loop.stopped && loop.name === traveler.name) return;
  // Beating for a different/old identity — tear it down before starting fresh.
  if (loop) stopPresence();

  const current: HeartbeatLoop = {
    name: traveler.name,
    intervalId: null,
    onVisibility: null,
    stopped: false,
  };
  loop = current;

  // Start (or resume) the >=30s interval. Guarded so we never stack two intervals.
  const startInterval = () => {
    if (current.stopped || current.intervalId !== null) return;
    current.intervalId = setInterval(() => {
      void writeHeartbeat();
    }, HEARTBEAT_MS);
  };

  // Pause the interval (tab hidden). The doc simply ages out of the active window if the
  // tab stays hidden past ACTIVE_WINDOW_MS, which is the intended "went away" behavior.
  const pauseInterval = () => {
    if (current.intervalId !== null) {
      clearInterval(current.intervalId);
      current.intervalId = null;
    }
  };

  // Visibility drives the loop: hidden ⇒ pause; visible ⇒ immediate catch-up
  // write + resume the interval.
  const onVisibility = () => {
    if (current.stopped) return;
    if (document.hidden) {
      pauseInterval();
    } else {
      void writeHeartbeat();
      startInterval();
    }
  };
  current.onVisibility = onVisibility;
  document.addEventListener('visibilitychange', onVisibility);

  // Immediate first beat + interval, but only if the tab is currently visible. If the tab
  // is hidden at start, the visibility listener will fire the first beat when it surfaces.
  if (!document.hidden) {
    void writeHeartbeat();
    startInterval();
  }
}

/**
 * Tear the loop down LOCALLY — interval, visibility listener, the `stopped` flag — and nothing
 * else. No network. Extracted (#10) because there are now two reasons to stop: the user signed out
 * (which should also delete the doc, below) and the rules refused the write (where a delete would
 * be refused too). Returns the loop that was torn down, or null if there was none.
 */
function teardownLoop(): HeartbeatLoop | null {
  const current = loop;
  if (!current) return null;
  current.stopped = true;
  loop = null;

  if (current.intervalId !== null) {
    clearInterval(current.intervalId);
    current.intervalId = null;
  }
  if (current.onVisibility && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', current.onVisibility);
    current.onVisibility = null;
  }
  return current;
}

/**
 * Stop the heartbeat: clear the interval, remove the visibility listener, and best-effort
 * DELETE the presence doc so the traveler drops off the bar immediately (sign-out / unmount).
 * Idempotent and SSR-safe (no-op when there's no loop / no `window`).
 */
export function stopPresence(): void {
  if (!teardownLoop()) return;

  // Best-effort delete so the traveler disappears at once (not just after they age out of
  // the active window). Gated: only when the ACTIVE trip syncs (#10 — the default pack never
  // wrote a doc, so there is nothing to delete). Failure is non-fatal.
  if (!isTripRemoteConfigured()) return;
  void (async () => {
    try {
      const { db, fs } = await getPresence();
      const { doc, deleteDoc } = fs;
      await deleteDoc(doc(db, 'trips', getTripId(), 'presence', deviceStore.getId()));
    } catch (err) {
      console.warn('[presence] heartbeat doc delete failed:', err);
    }
  })();
}

// ---------------------------------------------------------------------------
// READ — subscribe to the presence collection. One onSnapshot on <=3 docs (negligible).
// ---------------------------------------------------------------------------

/**
 * Subscribe to the presence collection (remote → caller). Opens ONE `onSnapshot` on
 * `trips/{TRIP_ID}/presence` after a silent anonymous sign-in, mapping docs to
 * `PresenceRecord[]`. The caller filters to active travelers via `isActive`.
 *
 * Gating & safety (mirrors subscribeRemote): no-ops (returns a no-op unsubscribe) when
 * `isRemoteConfigured()` is false. All SDK/network work is wrapped so any failure
 * degrades to no-presence via console.warn and never throws. Returns an unsubscribe fn that
 * is always safe to call (even on the dormant path / before async setup resolves).
 *
 * @param onChange invoked with the full presence list (unfiltered) on every snapshot.
 * @returns an unsubscribe function.
 */
export function subscribePresence(
  onChange: (records: PresenceRecord[]) => void,
): () => void {
  // #10: trip-scoped gate — the default pack is a local-only sample and never opens this.
  if (!isTripRemoteConfigured()) return () => {};

  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;

  (async () => {
    try {
      const { db, fs } = await getPresence();
      if (cancelled) return;

      const { collection, onSnapshot } = fs;
      const presenceCol = collection(db, 'trips', getTripId(), 'presence');

      firestoreUnsub = onSnapshot(
        presenceCol,
        (snapshot) => {
          // Never route an `expect()` through this callback (incl. through `onChange`): the catch
          // below swallows anything thrown here into a console.warn, so a FAILING assertion still
          // scores as a passing test. Assert on what the subscriber received, after the await.
          try {
            const records: PresenceRecord[] = snapshot.docs.map((d) => {
              const data = d.data() as Record<string, unknown>;
              return {
                uid: d.id,
                name: typeof data.name === 'string' ? data.name : '',
                lastSeen: toMillis(data.lastSeen),
              };
            });
            onChange(records);
          } catch (err) {
            console.warn('[presence] failed to apply presence snapshot:', err);
          }
        },
        (err) => {
          // Stream error (rules/network/quota). Stay no-presence; never throw.
          console.warn('[presence] presence stream error:', err);
        },
      );

      // If we were unsubscribed while awaiting setup, tear the listener straight down.
      if (cancelled && firestoreUnsub) {
        firestoreUnsub();
        firestoreUnsub = null;
      }
    } catch (err) {
      // Init / sign-in / dynamic-import failure → no presence; never crash.
      console.warn('[presence] presence subscribe unavailable:', err);
    }
  })();

  return () => {
    cancelled = true;
    if (firestoreUnsub) {
      firestoreUnsub();
      firestoreUnsub = null;
    }
  };
}
