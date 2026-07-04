// The presence seam — "who else is on the trip right now".
//
// This module is the presence analog of lib/itinerary-remote.ts. It owns the ONLY new
// Firestore collection the cross-friend feature adds: a heartbeat doc per traveler at
// `trips/{TRIP_ID}/presence/{uid}` (uid = the silent anon uid), shape
// `{ name, lastSeen: serverTimestamp() }`. It never touches the `days` model or its
// per-day LWW. It has two directions:
//   WRITE (heartbeat): while the tab is OPEN and VISIBLE, `startPresence()` writes the
//         traveler's heartbeat once immediately, then on an interval (>=30s). The write
//         is PAUSED when the tab is hidden (`visibilitychange`) and resumed when visible.
//         `stopPresence()` clears the interval, removes listeners, and best-effort deletes
//         the doc so the traveler drops off the bar immediately on sign-out / unmount.
//   READ  (subscribe): `subscribePresence(cb)` opens ONE `onSnapshot` on the presence
//         collection (<=3 docs) and maps docs → `PresenceRecord[]`. The caller filters to
//         "active" travelers via `isActive(lastSeen)`.
//
// DORMANT-SAFE (mirrors itinerary-remote.ts EXACTLY): firebase is imported
// ONLY via dynamic `import()` behind `isRemoteConfigured()`. With the env absent the gate
// is false, none of this module's SDK code executes, and firebase tree-shakes off the
// first-load chunk. WRITE is additionally gated on an identified traveler so a
// guest never writes/opens a connection. A misconfigured/unreachable Firebase degrades to
// local-only (try/catch → console.warn, never throw) — it must never crash the app.
//
// FREE-TIER (HARD RULE — never a paid plan): cadence is HEARTBEAT_MS (>=30s) and the
// loop is PAUSED while hidden, so it can never become a sustained sub-30s write loop.
// Budget: ~1 write / HEARTBEAT_MS / traveler. At 60s × 3 travelers ≈ 4,320 writes/day ≈
// ~22% of the free tier's ~20k writes/day. One onSnapshot on <=3 docs is negligible reads.
//
// REUSES the existing firebase init: it shares the SAME singleton app + anonymous sign-in
// as itinerary-remote.ts (getApps()/getApp() — there is never a second initialization
// path). The two modules each cache their own lazy handle promise, but both resolve to the
// one app instance, so dynamic import + getApps() dedupe is enough (no shared mutable here).
//
// CONFIG single-source: the config + on/off gate are read ONLY from
// lib/firebase-config.ts. No process.env.NEXT_PUBLIC_FIREBASE_* reads here.

import { FIREBASE_CONFIG, isRemoteConfigured, TRIP_ID } from './firebase-config';
import { getActiveTraveler } from './token-auth';

// ---------------------------------------------------------------------------
// Tuning constants. HEARTBEAT_MS MUST stay >= 30_000 (free-tier hard rule).
// ACTIVE_WINDOW_MS is the "active = lastSeen within N min" window; a small constant a bit
// larger than the heartbeat so a single missed/late beat doesn't flicker a traveler off.
// ---------------------------------------------------------------------------

/** Heartbeat cadence. >= 30s (free-tier hard rule). */
export const HEARTBEAT_MS = 60_000;

/** A traveler counts as "active now" if their lastSeen is within this window (~3 min). */
export const ACTIVE_WINDOW_MS = 3 * 60_000;

/** A presence record as surfaced to the UI. `lastSeen` is epoch ms (or null if pending). */
export interface PresenceRecord {
  /** The traveler's anon uid (doc id). */
  uid: string;
  /** Display name written into the heartbeat (the traveler's name). */
  name: string;
  /** Last heartbeat as epoch ms, or null while the serverTimestamp is still pending. */
  lastSeen: number | null;
}

// ---------------------------------------------------------------------------
// Shared lazy firebase handle. Mirrors itinerary-remote.ts's getRemote(): init the app +
// anonymous auth + firestore ONCE, behind the gate, via dynamic import (firebase stays off
// the dormant hot path). getApps()/getApp() reuses the SAME singleton app that
// itinerary-remote.ts creates — there is never a second firebase init.
// ---------------------------------------------------------------------------

type FirestoreMod = typeof import('firebase/firestore');

interface PresenceHandle {
  db: import('firebase/firestore').Firestore;
  fs: FirestoreMod;
  uid: string;
}

let presencePromise: Promise<PresenceHandle> | null = null;

/**
 * Lazily initialize firebase (app + anonymous auth + firestore) ONCE, behind the
 * `isRemoteConfigured()` gate. Rejects (caller degrades to a no-op) if the gate is off or
 * any step fails; never throws synchronously. Reuses the singleton app via getApps().
 */
function getPresence(): Promise<PresenceHandle> {
  if (!isRemoteConfigured()) {
    return Promise.reject(new Error('remote not configured'));
  }
  if (presencePromise) return presencePromise;

  presencePromise = (async () => {
    const [{ initializeApp, getApps, getApp }, authMod, firestoreMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);

    const { getAuth, signInAnonymously } = authMod;
    const { getFirestore } = firestoreMod;

    // Reuse the singleton app if it already exists (shared with itinerary-remote.ts —
    // one init across the app), otherwise create it from the single-source config.
    const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

    // Silent anonymous sign-in. The rules gate on request.auth != null,
    // so we must be signed in before any read/write. If itinerary-remote already signed in,
    // this resolves to the same persisted anon user.
    const auth = getAuth(app);
    const cred = await signInAnonymously(auth);

    const db = getFirestore(app);
    return { db, fs: firestoreMod, uid: cred.user.uid };
  })();

  // If init fails, clear the cache so a later call can retry rather than being stuck.
  presencePromise.catch(() => {
    presencePromise = null;
  });

  return presencePromise;
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
  if (!isRemoteConfigured()) return;
  const traveler = getActiveTraveler();
  if (!traveler) return; // guest / signed-out: never write

  try {
    const { db, fs, uid } = await getPresence();
    // A stop() during the await wins — don't write after teardown.
    if (loop?.stopped) return;
    const { doc, setDoc, serverTimestamp } = fs;
    const ref = doc(db, 'trips', TRIP_ID, 'presence', uid);
    await setDoc(
      ref,
      { name: traveler.name, lastSeen: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    // A failed heartbeat must not break the app — degrade to silent local-only.
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
  if (!isRemoteConfigured()) return; // dormant ⇒ no firebase, no loop
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
 * Stop the heartbeat: clear the interval, remove the visibility listener, and best-effort
 * DELETE the presence doc so the traveler drops off the bar immediately (sign-out / unmount).
 * Idempotent and SSR-safe (no-op when there's no loop / no `window`).
 */
export function stopPresence(): void {
  const current = loop;
  if (!current) return;
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

  // Best-effort delete so the traveler disappears at once (not just after they age out of
  // the active window). Gated: only when configured. Failure is non-fatal.
  if (!isRemoteConfigured()) return;
  void (async () => {
    try {
      const { db, fs, uid } = await getPresence();
      const { doc, deleteDoc } = fs;
      await deleteDoc(doc(db, 'trips', TRIP_ID, 'presence', uid));
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
  if (!isRemoteConfigured()) return () => {};

  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;

  (async () => {
    try {
      const { db, fs } = await getPresence();
      if (cancelled) return;

      const { collection, onSnapshot } = fs;
      const presenceCol = collection(db, 'trips', TRIP_ID, 'presence');

      firestoreUnsub = onSnapshot(
        presenceCol,
        (snapshot) => {
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
