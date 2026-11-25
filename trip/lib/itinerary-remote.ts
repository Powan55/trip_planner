// Itinerary sync with Firestore, wrapped around the local store.
// - Read: onSnapshot on trips/{id}/days, written through savePlans() plus the
//   `itinerary:changed` event, so the UI updates without component changes.
// - Write: commit() hands each changed day to the outbox, which calls pushDayMerged, a
//   transactional merge of that one day doc.
// The snapshot path never calls commit(), so it can't re-push; our own write echoes are skipped
// via hasPendingWrites.
// The first snapshot reads the trip-doc marker to tell "never synced" (seed from local) from
// "synced" (apply remote).
// Firebase is only imported dynamically behind isRemoteConfigured(); any failure degrades to
// local-only and never throws. Config comes only from lib/firebase-config.ts.

'use client';

import type { DayPlan, ItineraryItem } from './trip-data';
import { savePlans, loadPlans, hasStoredPlans } from './itinerary-storage';
import { ITINERARY_CHANGED_EVENT } from '@/core/storage/events';
import { isTripRemoteConfigured, getTripId } from './firebase-config';
import { SHARED_TRIP_ID } from './shared-trip';
import { getActiveTraveler } from './token-auth';
import { getUserName } from './identity';
import { recordConflicts } from '@/core/sync/conflict-store';
import { sanitizeItineraryItems } from '@/core/itinerary/model';
import { mergeDay, mergeDays, gcTombstones } from '@/core/sync/merge-day';
import { seedHlcFromLegacy } from '@/core/sync/hlc';
import { outboxDirty } from '@/core/sync/outbox';
import { resolvePair, DEFAULT_POLICY } from '@/core/sync/merge-items';
// D-544 — the seed pushes through the outbox-decorated port. Safe direction for the dormant
// gate: itinerary-ports is firebase-free, and ITS edge back to this module is a dynamic
// `import()` inside pushChunk, so this static import adds no module-init cycle.
import { itinerarySyncPort } from './itinerary-ports';
import { isPermissionDenied } from '@/core/sync/denied';
import { setReadDenied } from '@/core/sync/read-denied';
import { wasTripCreatedHere } from '@/core/storage/gateway';
import { realClock } from './trip-now';
import { getSharedRemote, type FirestoreMod } from './firebase-remote';

/**
 * Map a raw day doc to a DayPlan without throwing on partial or legacy docs.
 *
 * Unknown day-level keys pass through: the doc is spread first and the checked fields written
 * over it, matching every other layer. Don't reintroduce a field list.
 * `countryLabel` is removed when mistyped rather than copied when valid, because the spread
 * has already put it on the object; a number there would throw in dayPlaceLabel.
 *
 * Pure shape-mapper, pinned by itinerary-remote.test.ts: no field defaulting here. Sync-v2
 * defaults are applied separately by `defaultDayForMerge` at the merge boundaries.
 */
export function docToDayPlan(id: string, data: Record<string, unknown>): DayPlan {
  const date = typeof data.date === 'string' ? data.date : id;
  // `country` is a leg id (custom trips use 'main'), so any non-empty string passes through.
  // Coercing it to nepal/japan corrupted synced custom trips (D-303).
  const country = typeof data.country === 'string' && data.country ? data.country : 'nepal';
  const city = typeof data.city === 'string' ? data.city : '';
  // Same contract as the vault read. One bad row would otherwise either throw in the merge
  // (silently killing sync) or get saved and quarantine the whole plan on the next load.
  // Drops bad rows only; defaults nothing.
  const items = sanitizeItineraryItems(data.items);
  const day = { ...data, date, city, country, items } as DayPlan;
  // `countryLabel` keeps its type guard because it is a DECLARED field with a real consumer:
  // a number here reaches `dayPlaceLabel`'s string ops (lib/leg-label.ts) and throws. Unknown
  // keys have no consumer by definition, which is why they can pass unchecked.
  if (typeof data.countryLabel !== 'string') delete day.countryLabel;
  return day;
}

/**
 * Default an item's Sync v2 fields. The hlc is derived from `updatedAt`, not minted, so every
 * client seeds the same stamp. v2 items pass through.
 */
export function defaultItemSyncFields(it: ItineraryItem): ItineraryItem {
  return {
    ...it,
    rev: it.rev ?? 1,
    hlc: it.hlc ?? seedHlcFromLegacy(it.updatedAt),
    deleted: it.deleted ?? false,
  };
}

/**
 * Make a v1 remote day mergeable in memory without writing it back. Tombstones are kept so they
 * reach mergeDay; the UI filters them later.
 */
export function defaultDayForMerge(day: DayPlan): DayPlan {
  return { ...day, items: (day.items ?? []).map(defaultItemSyncFields) };
}

/** Firestore rejects undefined values; a JSON round-trip drops them and deep-clones. */
export function sanitizeDayForWrite(day: DayPlan): Record<string, unknown> {
  return JSON.parse(JSON.stringify(day)) as Record<string, unknown>;
}

/**
 * Write one day in a transaction: read the remote doc, merge the local day into it, write the
 * result. A concurrent write to the same day forces a retry that re-merges, so neither client
 * loses items. mergeDay is commutative and idempotent, so retries are safe.
 */
export async function pushDayMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  localDay: DayPlan,
  tripId = getTripId(),
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', tripId, 'days', localDay.date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    // Read the remote-now day and merge the local day on top.
    // An absent remote doc merges against an empty day → writes the local items unchanged.
    const remoteNow: DayPlan = snap.exists()
      ? defaultDayForMerge(docToDayPlan(localDay.date, snap.data() as Record<string, unknown>))
      // was a four-field literal that silently dropped every day-level field it did not
      // name — including the new `countryLabel`. Spreading the local day is the same value for
      // the four named fields and cannot drift again.
      : { ...localDay, items: [] };
    // Old tombstones are pruned here, riding on a real edit. realClock, not the ?today= override,
    // or a future horizon would drop tombstones still needed elsewhere.
    // Local first, as in the snapshot path: mergeDay takes day metadata from its first argument.
    const merged = gcTombstones(mergeDay(localDay, remoteNow), realClock.now().getTime());
    const out = sanitizeDayForWrite(merged);
    // Rows this build can't parse (a newer peer's schema) would be erased by the set; carry them verbatim. #848
    if (snap.exists()) {
      const rawItems = (snap.data() as Record<string, unknown>).items;
      // parsed rows are excluded too, so a GC'd tombstone is not carried back
      const have = new Set([...merged.items, ...remoteNow.items].map((it) => it.id));
      const kept = Array.isArray(rawItems)
        ? rawItems.filter(
            (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim() !== '' && !have.has(r.id),
          )
        : [];
      if (kept.length) out.items = [...(out.items as unknown[]), ...kept];
    }
    tx.set(ref, out);
  });
}

/**
 * The outbox's pushChunk for one day. Rejects on failure so the chunk stays dirty. A date with
 * no local day is skipped, never deleted remotely: days can't be removed by users, and a blind
 * delete could clobber a peer.
 */
export async function pushDayChunk(current: DayPlan[], date: string, tripId: string): Promise<void> {
  const day = current.find((d) => d.date === date);
  if (!day) return; // absent day → skip (ack), never a blind delete
  const { db, fs } = await getSharedRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushDayMerged(db, fs, day, tripId); // rejects on transport error → decorator keeps it dirty
}

/**
 * Subscribe to remote day docs. First snapshot: if the trip doc exists, remote is applied as
 * is; otherwise this client seeds remote from local. Later snapshots are merged into local,
 * skipping our own pending-write echoes. No-op when sync isn't configured; never throws.
 * @returns an unsubscribe function, always safe to call.
 */
export function subscribeRemote(onDead?: () => void): () => void {
  // Dormant gate: with no config — or on the local-only default pack (#10) — never touch firebase.
  if (!isTripRemoteConfigured()) return () => {};

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
  // Days from the most recent applied snapshot. The first reconcile awaits the marker read, and a
  // snapshot landing during that await must not be overwritten by the older first-load days (#542).
  let latestRemoteDays: DayPlan[] = [];

  // If setup fails offline there's no listener for Firestore to reconnect, so retry on `online`.
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
  // The caller's reopen timer (#845) replaces the `online` wait; both would double-listen.
  const retry = () => (onDead ? onDead() : armOnlineRetry());

  // Persist + dispatch a resolved plan set to the local store (the shared write tail).
  // Writes through the EXISTING persistence and dispatches the EXISTING
  // event DIRECTLY — NOT via commit() — so the snapshot path never re-pushes.
  const persistAndDispatch = (plans: DayPlan[]) => {
    plans.sort((a, b) => a.date.localeCompare(b.date)); // stable local shape
    savePlans(plans);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));
    }
  };

  // Keep what this merge drops from local (D-801). Called BEFORE persist, while loadPlans() is
  // still the pre-merge view. Must never block the apply, so any failure is swallowed.
  const keepLosses = (merged: DayPlan[]) => {
    try {
      recordConflicts(loadPlans(), merged, getActiveTraveler()?.name ?? getUserName() ?? '');
    } catch (err) {
      console.warn('[itinerary-remote] conflict record failed:', err);
    }
  };

  // First-snapshot apply: remote verbatim, including emptied days, so a cleared shared plan
  // stays cleared instead of being merged back. Returns false when it refuses, and the caller
  // falls through to seeding.
  const applyRemoteAuthoritative = (plans: DayPlan[]): boolean => {
    // Never wipe (D-544). Clearing a plan keeps its day docs (D-091), so zero docs means the
    // content was never pushed, not that it was emptied.
    if (plans.length === 0 && loadPlans().length > 0) return false;
    // Days still dirty in the outbox are merged instead, so an unpushed offline edit survives.
    const dirty = outboxDirty('itinerary');
    if (dirty.length === 0) {
      // Remote decides which days and ids exist. A local-only id is not kept, but a shared id
      // whose local row has a newer HLC wins and its day is pushed.
      const remoteDefaulted = plans.map(defaultDayForMerge);
      const localByDate = new Map(loadPlans().map((d) => [d.date, d]));
      // The winner can equal remote with its keys in another order; that is not a change to push.
      const canon = (_k: string, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
          : v;
      const resolved = remoteDefaulted.map((rd) => {
        const localById = new Map((localByDate.get(rd.date)?.items ?? []).map((i) => [i.id, i]));
        let changed = false;
        const items = (rd.items ?? []).map((r) => {
          const l = localById.get(r.id);
          if (!l) return r;
          const w = resolvePair(l, r, DEFAULT_POLICY);
          if (JSON.stringify(w, canon) === JSON.stringify(r, canon)) return r;
          changed = true;
          return w;
        });
        return changed ? { ...rd, items } : rd;
      });
      keepLosses(resolved);
      persistAndDispatch(resolved);
      // Same write-ahead + push the seed uses; chunkDiff enqueues only the days that differ.
      void Promise.resolve(itinerarySyncPort.push(remoteDefaulted, resolved)).catch(() => {});
      return true;
    }
    // Some dates are dirty: apply remote authoritatively for NON-dirty dates, and merge the
    // dirty dates against the current local view (exactly the steady-state item-level merge, so
    // the unpushed local edit and the peer's remote edits both survive —).
    const dirtySet = new Set(dirty);
    const localByDate = new Map(loadPlans().map((d) => [d.date, d]));
    const remoteDefaulted = plans.map(defaultDayForMerge);
    const remoteByDate = new Map(remoteDefaulted.map((d) => [d.date, d]));
    const result: DayPlan[] = remoteDefaulted.filter((d) => !dirtySet.has(d.date));
    for (const date of dirtySet) {
      const remoteDay = remoteByDate.get(date);
      const localDay = localByDate.get(date);
      if (localDay && remoteDay) result.push(mergeDay(localDay, remoteDay));
      else if (localDay) result.push(localDay); // remote absent → keep local (the flush pushes it up)
      else if (remoteDay) result.push(remoteDay); // no local copy → remote as-is
    }
    persistAndDispatch(result);
    return true;
  };

  // Later snapshots merge item by item into local, so unpushed local edits survive. Applied
  // directly, never via commit(), so it can't re-push.
  const applyRemoteMerged = (remoteDays: DayPlan[]) => {
    // Default v1 remote items on read so a legacy day-doc merges as valid v2, then
    // item-merge against the current local view. Local is already v2 (migrated on load).
    const merged = mergeDays(loadPlans(), remoteDays.map(defaultDayForMerge));
    // Prune old tombstones before saving (D-567).
    const nowPt = realClock.now().getTime();
    keepLosses(merged);
    persistAndDispatch(merged.map((d) => gcTombstones(d, nowPt)));
  };

  // Idempotent; on failure arms the `online` retry.
  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs, uid } = await getSharedRemote();
      if (cancelled || established) return;

      const { collection, onSnapshot, doc, getDoc, getDocFromServer, setDoc, serverTimestamp } = fs;
      const daysCol = collection(db, 'trips', getTripId(), 'days');

      firestoreUnsub = onSnapshot(
        daysCol,
        (snapshot) => {
          // #271: any snapshot event reaching here proves this device's read is no longer
          // denied — clear whatever the error path below set (membership granted mid-session,
          // no reload needed). Unconditional and cheap (a Set check that only writes on a flip).
          setReadDenied('itinerary', false);

          // Our own optimistic write; the server snapshot follows.
          if (snapshot.metadata.hasPendingWrites) return;

          // Reconcile only against a server snapshot: an empty cached one would look like
          // "never synced" and seed over a peer's real data.
          if (!firstSnapshotHandled && snapshot.metadata.fromCache) return;

          (async () => {
            try {
              const remoteDays: DayPlan[] = snapshot.docs.map((d) =>
                docToDayPlan(d.id, d.data() as Record<string, unknown>),
              );
              latestRemoteDays = remoteDays;

              if (!firstSnapshotHandled) {
                firstSnapshotHandled = true;
                // Sign-out can cancel during the awaits; re-check when the callback fires so a
                // wiped account's plan is never written back.
                await reconcileFirstSnapshot(
                  remoteDays,
                  { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp, uid },
                  // Cancelled counts as handled (write nothing, seed nothing). Uses the newest
                  // snapshot, since one may have arrived during the await.
                  () => (cancelled ? true : applyRemoteAuthoritative(latestRemoteDays)),
                );
                return;
              }

              // Also the path for Firestore's own reconnect after an offline window.
              applyRemoteMerged(remoteDays);
            } catch (err) {
              // A bad single snapshot must not break the stream or the app.
              console.warn('[itinerary-remote] failed to apply remote snapshot:', err);
            }
          })();
        },
        (err) => {
          // Firestore retries transient errors itself; a terminal one detaches the listener,
          // so arm the `online` retry.
          console.warn('[itinerary-remote] snapshot stream error:', err);
          established = false;
          firestoreUnsub = null;
          // Permission denied fails the same way every time, so record it and don't retry.
          if (isPermissionDenied(err)) {
            setReadDenied('itinerary', true);
            return;
          }
          if (!cancelled) retry();
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
      // Usually a cold start offline. getRemote() resets on failure, so the retry starts fresh.
      console.warn('[itinerary-remote] remote sync unavailable, staying local-only:', err);
      if (!cancelled) retry();
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
 * Reads the trip-doc marker once to choose between applying remote and seeding it. Firestore
 * functions are passed in so nothing is imported eagerly.
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
    /** This device's uid — named `owner` in the seed marker's members map (#10). */
    uid: string;
  },
  // Not the merging applier: merging here would resurrect items in a cleared plan. False means
  // it refused (D-544) and the seed should run.
  applyRemote: (plans: DayPlan[]) => boolean,
): Promise<void> {
  const { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp, uid } = ctx;
  const tripId = getTripId();
  const tripRef = doc(db, 'trips', tripId);

  // Read the marker from the server: an empty cache would look like "never synced". Falls back
  // to the cache only if the server read fails.
  let tripExists = false;
  let serverFailed = false;
  try {
    let tripSnap;
    try {
      tripSnap = await getDocFromServer(tripRef);
    } catch {
      serverFailed = true;
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

  // An unconfirmed absence must not seed: the non-merge marker setDoc would overwrite a members map.
  if (serverFailed && !tripExists) {
    if (remoteDays.length > 0) applyRemote(remoteDays);
    return;
  }

  const localWasPersisted = hasStoredPlans(); // present ⇒ user edits; absent ⇒ the built shells/sample

  // If applyRemote refuses (empty remote, non-empty local), fall through and re-seed the remote.
  if (tripExists && (remoteDays.length > 0 || localWasPersisted) && applyRemote(remoteDays)) {
    // Group synced before → remote authoritative, apply INCLUDING empty.
    // This is what makes "A deletes everything → B reflects empty and STAYS empty after
    // reload" true: an emptied shared plan is a real state, not a trigger to reseed.
    return;
  }

  // The marker alone isn't enough: trips create their doc at creation (for the members map), so
  // a new trip's first snapshot has a marker and no days. Marker + no remote days + nothing ever
  // saved locally means "never pushed", so seed.
  // The shared trip is never seeded from a device's defaults or the sample.
  if (tripId === SHARED_TRIP_ID && (!tripExists || (remoteDays.length === 0 && !localWasPersisted))) return;

  // Seed: push local up, leave local as is.
  const localPlans = loadPlans();
  const localIsUserData = localWasPersisted; // present ⇒ user edits; absent ⇒ sample seed

  try {
    // Marker first, so a second client applies instead of double-seeding. Not rewritten if it
    // exists (would clobber a peer's members entry). Only the creating device writes members,
    // or an early joiner would own the trip.
    if (!tripExists) {
      await setDoc(tripRef, {
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        seededFrom: localIsUserData ? 'local-edits' : 'sample',
        ...(wasTripCreatedHere(tripId) ? { members: { [uid]: 'owner' } } : {}),
      });
    }

    // Through the outbox (D-544), so a half-landed seed stays dirty and retries rather than
    // reading back as an emptied plan.
    await itinerarySyncPort.push([], localPlans);
  } catch (err) {
    console.warn('[itinerary-remote] first-snapshot seed failed, staying local-only:', err);
  }
  // Local stays as-is; the seed round-trips back as a steady-state snapshot (which our
  // hasPendingWrites guard + value-identical savePlans make a no-op for the UI).
}
