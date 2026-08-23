// The My-Places remote-sync seam (issue #17, D-229 addendum) — the read/write directions for the
// PLACES domain. Same HYBRID SHAPE as the docs checklist: a SINGLE doc
// `trips/{tripId}/places/list` whose payload is the `{version, items:[…]}` row-array container,
// merged per-row with the shared algebra via `mergePlaces` (core/places/merge.ts).
//
// WHY THAT CONTAINER, EXACTLY: `firestore.rules`'s catch-all `match /{sub}/{document=**}` already
// grants a member create/update under `boundedWrite()`, and `boundedWrite()` bounds
// `len('items') <= 5000`. Reusing the `items` field name therefore needs NO rules change and
// arrives pre-bounded. A differently-named container field would be UNBOUNDED by those rules and
// would have to be added to `boundedWrite()` — do not rename it.
//
// WRITE (local → remote): `pushPlacesMerged(local)` — a merge-aware transactional
// read→merge→set of the one doc. Invoked ONLY from the outbox decorator. MUST REJECT on failure so
// the outbox keeps the `'list'` chunk dirty (the decorator swallows).
// READ (remote → local): `subscribeRemotePlaces` opens `onSnapshot` on the single doc.
// PRESENT ⇒ `mergePlaces(local, remote)`; ABSENT on the first snapshot ⇒ seed from local (push up;
// local untouched). Applied via `saveMyPlaces()` + the `myplaces:changed` CustomEvent DIRECTLY,
// never through the store's `commit()`, so the snapshot path can never re-push.
//
// DORMANT-SAFE: firebase is reached ONLY through the shared `getRemote()` (lazy, gated). This
// module is itself imported only dynamically (from the outbox pushChunk + the provider's gated
// subscribe), so the dormant build pulls no firebase.
//
// TRIP-GATED (D-229 addendum / #10): every path here composes `trips/{getTripId()}/…`, and the
// DEFAULT sample pack's remote id is retired (`getTripId()` is ''). `isTripRemoteConfigured()` is
// therefore the gate on both directions — on the default pack this module never opens a stream and
// never composes an empty path. Places on the sample trip stay local-only, silently.

'use client';

import { saveMyPlaces, loadMyPlaces } from '@/core/places/storage';
import { mergePlaces } from '@/core/places/merge';
import { sanitizePlaces, type MyPlace } from '@/core/places/model';
import { MY_PLACES_CHANGED_EVENT } from '@/core/storage/events';
import { isTripRemoteConfigured, getTripId } from './firebase-config';
import { getRemote, type FirestoreMod } from './itinerary-remote';
import { realClock } from './trip-now';

/**
 * Map a raw Firestore places doc into its `MyPlace[]`.
 *
 * `sanitizePlaces` rather than a bare cast, because the cast was a LIE about untrusted bytes: one
 * `null` element written by a peer on an older build (or by anything else with write access) makes
 * `mergePlaces` dereference `p.hlc` and throw. In the snapshot path that is caught and the update
 * is dropped; inside `pushPlacesMerged` it rejects the transaction, so the `'list'` chunk stays
 * dirty and retries FOREVER — a poison row that silently wedges this device's outbox. Sanitising at
 * the read boundary is the same lenient-read discipline `model.ts` already applies to local bytes.
 *
 * `keepUnknownKeys` (#138 / D-374 — places was left out of that sweep). The merged result of this
 * read is written straight back up by `pushPlacesMerged`, so the strict declared-field rebuild
 * dropped a newer client's forward fields before they could reach the write. Retention here is
 * NECESSARY BUT NOT SUFFICIENT: `mergePlaces` closes with its own `sanitizePlaces`, so both of this
 * module's merge calls must pass the flag too or the keys are re-stripped one step later. The LOCAL
 * entry points (`loadMyPlaces`/`saveMyPlaces`, backup) stay strict, per D-374/D-376 — and it is that
 * strict local re-save that creates the equal-HLC/different-key-set collision D-376 resolves in
 * favour of the richer row.
 */
export function docToPlaceRows(data: Record<string, unknown>): MyPlace[] {
  return Array.isArray(data.items) ? sanitizePlaces(data.items, { keepUnknownKeys: true }) : [];
}

/**
 * Merge-aware transactional write of the SINGLETON places doc. Reads the current remote doc inside
 * a transaction, `mergePlaces` the local rows on top, and writes the merged result — so a place
 * imported on the OTHER phone is not clobbered (both survive) and a same-id collision resolves by
 * HLC. Exported for the wired-behavior unit test (fake Firestore).
 *
 * `keepUnknownKeys` on the merge is the OTHER half of the read-side retention, and without it the
 * read-side flag was a no-op on this domain: `mergePlaces` closes with `sanitizePlaces`, so at the
 * strict default the rebuild re-stripped the forward keys `docToPlaceRows` had just kept, on the
 * way INTO this `tx.set` (#138 / D-374). `docs`/`expenses` never needed the equivalent — they write
 * `mergeItems` output directly, with no sanitize tail. The rows still carry no `undefined` for
 * Firestore to reject: declared fields are normalized or deleted either way, and the only undeclared
 * keys present came off a Firestore snapshot, which cannot hold one.
 */
export async function pushPlacesMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  localRows: MyPlace[],
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', getTripId(), 'places', 'list');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteRows: MyPlace[] = snap.exists() ? docToPlaceRows(snap.data() as Record<string, unknown>) : [];
    const merged = mergePlaces(remoteRows, localRows, realClock.now().getTime(), { keepUnknownKeys: true });
    tx.set(ref, { version: 1, items: merged });
  });
}

/**
 * Push the places list from the CURRENT local state — the `ChunkSync.pushChunk` impl the offline
 * outbox drives. The only chunk is the singleton `'list'`. MUST REJECT on failure (getRemote
 * rejects when unreachable; pushPlacesMerged rejects on a transport error) so the decorator keeps
 * the chunk dirty. Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushPlacesChunk(current: MyPlace[], chunk: string): Promise<void> {
  if (chunk !== 'list') return; // unknown chunk → ack (never a bad write)
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushPlacesMerged(db, fs, current); // rejects on transport error → stays dirty
}

/**
 * Subscribe to remote places changes (remote → local). Opens ONE `onSnapshot` on the singleton doc
 * `trips/{tripId}/places/list`. PRESENT ⇒ `mergePlaces(local, remote)` (always merge — the merge
 * preserves an unpushed local import AND an unpushed local tombstone, so no separate dirty-chunk
 * exception is needed); ABSENT on first snapshot ⇒ seed from local. Applied DIRECTLY via
 * `saveMyPlaces()`+dispatch (never `commit()`) so it can never re-push. Gated + lazy +
 * self-degrading: no-op unsubscribe when dormant or on the default pack; any failure → local-only
 * via console.warn, never throws. Mirrors `subscribeRemoteDocs`.
 */
export function subscribeRemotePlaces(): () => void {
  // Trip-scoped gate: the default pack is a local-only sample and never opens this.
  if (!isTripRemoteConfigured()) return () => {};

  let cancelled = false;
  let firestoreUnsub: (() => void) | null = null;
  let established = false;
  let settingUp = false;
  let firstSnapshotHandled = false;

  let onlineHandler: (() => void) | null = null;
  const removeOnlineHandler = () => {
    if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  };
  const armOnlineRetry = () => {
    if (onlineHandler || cancelled || established || typeof window === 'undefined') return;
    onlineHandler = () => {
      removeOnlineHandler();
      if (cancelled || established) return;
      void attemptSetup();
    };
    window.addEventListener('online', onlineHandler);
  };

  const persistAndDispatch = (rows: MyPlace[]) => {
    saveMyPlaces(rows);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MY_PLACES_CHANGED_EVENT));
  };

  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs } = await getRemote();
      if (cancelled || established) return;
      const { doc, onSnapshot } = fs;
      const ref = doc(db, 'trips', getTripId(), 'places', 'list');

      firestoreUnsub = onSnapshot(
        ref,
        (snap) => {
          // Skip the echo of our OWN optimistic write (the authoritative server snapshot follows).
          if (snap.metadata.hasPendingWrites) return;
          // Defer until the first SERVER snapshot (a cache-sourced first event would wrongly look
          // like "never synced" — mirrors the itinerary/expenses/budget/docs hardening).
          if (!firstSnapshotHandled && snap.metadata.fromCache) return;

          try {
            const first = !firstSnapshotHandled;
            firstSnapshotHandled = true;
            const local = loadMyPlaces();
            if (snap.exists()) {
              const remoteRows = docToPlaceRows(snap.data() as Record<string, unknown>);
              persistAndDispatch(mergePlaces(local, remoteRows, realClock.now().getTime(), { keepUnknownKeys: true }));
            } else if (first) {
              // Never synced → seed the doc from local. Best-effort; a failure stays local-only
              // (local is untouched, so nothing is lost).
              void pushPlacesMerged(db, fs, local).catch((err) =>
                console.warn('[places-remote] doc seed failed, staying local-only:', err),
              );
            }
          } catch (err) {
            console.warn('[places-remote] failed to apply remote snapshot:', err);
          }
        },
        (err) => {
          console.warn('[places-remote] snapshot stream error:', err);
          established = false;
          firestoreUnsub = null;
          if (!cancelled) armOnlineRetry();
        },
      );

      established = true;
      removeOnlineHandler();
      if (cancelled && firestoreUnsub) {
        firestoreUnsub();
        firestoreUnsub = null;
        established = false;
      }
    } catch (err) {
      console.warn('[places-remote] remote sync unavailable, staying local-only:', err);
      if (!cancelled) armOnlineRetry();
    } finally {
      settingUp = false;
    }
  };

  void attemptSetup();

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
