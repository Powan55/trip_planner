// The trip-meta remote-sync seam — carries a trip's IDENTITY (name + config)
// to Firestore, so someone joining via a `?trip=` link receives
// who/what the trip is, not just its raw itinerary/expenses/etc. rows.
//
// SHAPE: ONE doc `trips/{tripId}/meta/info` = `{ name, config? }` (the `meta` subcollection name
// is RESERVED within a trip doc, alongside the-future `profile` subcollection — never reuse
// either name for a different purpose).
//
// WRITE (local → remote): `pushTripMeta(tripId, meta)` — best-effort `setDoc`; never rejects
// (failures are swallowed to console.warn). NO outbox domain (unlike itinerary/expenses/
// budget/docs). A lost write has two recovery paths: (A) the next rename/config change
// re-pushes it (trips-hub `saveRename` — this one WORKS, and is why renaming a broken trip
// fixes it), and (B) the fetch-based self-heal below, which retries on each page load
// until it finds the doc.
//
// ⚠ — AWAIT IT IF YOU ARE ABOUT TO NAVIGATE. This used to read "callers must NOT
// await this for correctness", and that instruction shipped the defect: `window.location.
// assign` unloads the page in 370–740 ms, but this function must first `await getRemote()`
// (a ~456 kB dynamic import + initializeApp + a WebChannel handshake) before `setDoc` is
// even issued, so the write died in flight — measured absent after 20 s on 5 of 6 creates,
// vs 179 ms to land when the caller did not navigate. Every trip shared before its first
// rename was affected: the joiner's /plan rendered no day cells. A NAVIGATING caller must
// now await this under a timeout (see `CREATE_PUSH_BUDGET_MS` in components/trips-hub);
// a caller that stays on the page (`saveRename`) is still correctly fire-and-forget.
// READ (remote → local): `fetchTripMeta(tripId)` — a ONE-SHOT `getDoc` (no subscribe — this is
// a joiner's self-heal read, not a live sync channel), sanitized via the registry's
// own `sanitizeTripConfig` so a malformed remote doc degrades to `undefined`/a name-only
// result rather than corrupting local state. Its caller (`runTripMetaSelfHeal` in
// components/itinerary-provider) runs it at most ONCE PER PAGE LOAD and — since —
// marks its per-session guard only when a doc was actually FOUND, so "the creator's write
// hasn't landed yet" stays retryable instead of dead-ending the joiner's whole session.
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy, gated on
// `isRemoteConfigured()`). This module is itself imported only dynamically (from trips-hub's
// create/rename handlers + the provider's gated self-heal effect), so the dormant build pulls no
// firebase.
//
// NO RULES CHANGE: tripId IS the capability; the existing `trips/{tripId}/**` rules
// already cover this new `meta/info` doc path.

'use client';

import {
  sanitizeTripConfig,
  listKnownTrips,
  listRemovedTrips,
  mergeTripLists,
  importRemoteTrips,
  type TripConfigBlock,
  type TripMeta,
  type RemovedTrip,
} from '@/core/trips/registry';
import { isRemoteConfigured } from './firebase-config';
import { getRemote } from './itinerary-remote';

export type TripMetaPayload = { name: string; config?: TripConfigBlock };

/**
 * Best-effort push of a trip's name/config to `trips/{tripId}/meta/info`. Never rejects to the
 * caller (a failed push is swallowed to console.warn — no outbox, per Plan D7). `tripId` is
 * caller-supplied (NOT read from the active-trip pointer) because a rename can target any known
 * trip row, not only the currently-active one.
 *
 * The returned promise settles only after the lazy firebase load AND the `setDoc` ack, so a caller
 * that is about to unload the page must await it under a timeout.
 */
export async function pushTripMeta(tripId: string, meta: TripMetaPayload): Promise<void> {
  if (!isRemoteConfigured() || !tripId) return;
  try {
    const { db, fs } = await getRemote();
    const { doc, setDoc } = fs;
    const ref = doc(db, 'trips', tripId, 'meta', 'info');
    const payload: Record<string, unknown> = { name: meta.name };
    // JSON round-trip both clones and strips `undefined`-valued optional fields (`currency`),
    // which Firestore's setDoc rejects — same defensive move as docs-remote's sanitizeRowsForWrite.
    if (meta.config) payload.config = JSON.parse(JSON.stringify(meta.config));
    await setDoc(ref, payload);
  } catch (err) {
    console.warn('[trips-remote] trip meta push failed, staying local-only:', err);
  }
}

/**
 * One-shot fetch of a trip's remote meta doc. Returns `undefined` when dormant, unreachable, the
 * doc doesn't exist, or the doc is malformed (no name) — TOTAL, never throws. A present-but-bad
 * `config` field degrades to a name-only result (`sanitizeTripConfig` returns `undefined`) rather
 * than failing the whole fetch.
 */
export async function fetchTripMeta(tripId: string): Promise<TripMetaPayload | undefined> {
  if (!isRemoteConfigured() || !tripId) return undefined;
  try {
    const { db, fs } = await getRemote();
    const { doc, getDoc } = fs;
    const ref = doc(db, 'trips', tripId, 'meta', 'info');
    const snap = await getDoc(ref);
    if (!snap.exists()) return undefined;
    const data = snap.data() as Record<string, unknown>;
    if (typeof data.name !== 'string' || data.name.trim().length === 0) return undefined;
    const config = sanitizeTripConfig(data.config);
    return config ? { name: data.name, config } : { name: data.name };
  } catch (err) {
    console.warn('[trips-remote] trip meta fetch failed:', err);
    return undefined;
  }
}

// ── Sync Code: cross-device known-trips list ────────────────────────────────────────────────
//
// SHAPE: ONE doc `trips/{syncCode}/profile/tripList` = `{ version: 1, trips: TripMeta[],
// removed?: RemovedTrip[] }`. `removed` is ADDITIVE — an old client simply ignores it (it can
// re-add a forgotten trip until updated; accepted). The syncCode is just another capability token in
// the SAME `trips/` collection, so the existing `trips/{id}/**` rules already cover this
// `profile/tripList` path — NO Firestore rules change. The DEFAULT pack is never pushed, merged, or
// tombstoned (mergeTripLists strips it — its id is a secret).

/** Extract the row array from a raw remote list doc (defensive: tolerate a partial/missing doc). */
function docToTrips(data: Record<string, unknown>): TripMeta[] {
  return Array.isArray(data.trips) ? (data.trips as TripMeta[]) : [];
}

/** Extract the tombstone array from a raw remote list doc. */
function docToRemoved(data: Record<string, unknown>): RemovedTrip[] {
  return Array.isArray(data.removed) ? (data.removed as RemovedTrip[]) : [];
}

/**
 * Best-effort push of THIS browser's known-trips list to `trips/{syncCode}/profile/tripList`: read
 * the remote doc, additive-union it with the local list, write the union back. Fire-and-forget —
 * never rejects to the caller (a failed push stays local-only via console.warn, no outbox). The JSON
 * round-trip strips `undefined`-valued optional fields (config/updatedAt/currency) Firestore rejects.
 */
export async function pushTripList(code: string): Promise<void> {
  if (!isRemoteConfigured() || !code) return;
  try {
    const { db, fs } = await getRemote();
    const { doc, getDoc, setDoc } = fs;
    const ref = doc(db, 'trips', code, 'profile', 'tripList');
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    const { merged, removed } = mergeTripLists(
      listKnownTrips(),
      docToTrips(data),
      listRemovedTrips(),
      docToRemoved(data),
    );
    await setDoc(ref, {
      version: 1,
      trips: JSON.parse(JSON.stringify(merged)),
      removed: JSON.parse(JSON.stringify(removed)),
    });
  } catch (err) {
    console.warn('[trips-remote] trip list push failed, staying local-only:', err);
  }
}

/**
 * Subscribe to the remote trip list (remote → local). Opens ONE `onSnapshot` on
 * `trips/{syncCode}/profile/tripList` (first-snapshot marker = DOC PRESENCE, docs-remote recipe):
 * PRESENT ⇒ merge into the local registry (`importRemoteTrips`) + push the union back when local had
 * extras; ABSENT on the first snapshot ⇒ seed from local. Gated + lazy + self-degrading: no-op unsub
 * when dormant; any failure → local-only via console.warn, never throws. Best-effort, so — unlike the
 * domain subscribes — it carries NO online-reconnect retry (a dropped stream re-subscribes on the
 * next reload). `onMerge` fires after a present-snapshot merge (for the caller to react/telemeter).
 */
export function subscribeTripList(code: string, onMerge?: () => void): () => void {
  if (!isRemoteConfigured() || !code) return () => {};

  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;
  let firstSnapshotHandled = false;

  void (async () => {
    try {
      const { db, fs } = await getRemote();
      if (cancelled) return;
      const { doc, onSnapshot } = fs;
      const ref = doc(db, 'trips', code, 'profile', 'tripList');

      firestoreUnsub = onSnapshot(
        ref,
        (snap) => {
          // Skip our OWN optimistic write echo; defer past a cache-sourced first event (else it
          // wrongly looks like "never synced" — mirrors the itinerary/docs hardening).
          if (snap.metadata.hasPendingWrites) return;
          if (!firstSnapshotHandled && snap.metadata.fromCache) return;
          try {
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            if (snap.exists()) {
              const data = snap.data() as Record<string, unknown>;
              const { localHadExtras } = importRemoteTrips(docToTrips(data), docToRemoved(data));
              if (localHadExtras) void pushTripList(code); // push our extras/removals up (best-effort)
              onMerge?.();
            } else if (first) {
              // Never synced → seed the doc from local (best-effort; local is untouched on failure).
              void pushTripList(code).catch((err) =>
                console.warn('[trips-remote] trip list seed failed, staying local-only:', err),
              );
            }
          } catch (err) {
            console.warn('[trips-remote] failed to apply remote trip list:', err);
          }
        },
        (err) => {
          console.warn('[trips-remote] trip list snapshot stream error:', err);
          firestoreUnsub = null;
        },
      );

      if (cancelled && firestoreUnsub) {
        firestoreUnsub();
        firestoreUnsub = null;
      }
    } catch (err) {
      console.warn('[trips-remote] trip list sync unavailable, staying local-only:', err);
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
