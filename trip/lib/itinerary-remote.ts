// The remote-sync seam — the ONLY new architectural surface for.
//
// This module wraps the existing store; it never replaces it. It has two
// directions:
// READ (remote → local): a Firestore `onSnapshot` on the trip's `days` collection
// maps docs back to `DayPlan[]`, writes them through the existing
// `savePlans()`, and dispatches the existing
// `itinerary:changed` CustomEvent. Because that event is already what
// `use-itinerary.ts`'s reread() listens for, the whole reactive UI (calendar,
// dashboard, timeline, every card) updates with ZERO component edits.
// WRITE (local → remote): `pushPlans(prev,next)` is called from the store's
// `commit()` AFTER the local `savePlans(next)`. It diffs prev→next PER DAY and
// writes ONLY the changed `trips/{TRIP_ID}/days/{date}` docs (per-day
// last-write-wins,) — a day that became empty writes `items:[]`, a day
// removed entirely is deleted.
//
// ECHO-SUPPRESSION: `pushPlans` is called ONLY from `commit()`
// (genuine local mutations), NEVER from the snapshot-ingest path — the snapshot path
// calls `savePlans()` + dispatch DIRECTLY, so it can never re-push. Firestore's own
// local-write echo is additionally skipped via `snapshot.metadata.hasPendingWrites`
// Together these break any write→read→write loop.
//
// FIRST-SNAPSHOT RECONCILIATION:
// on the first snapshot we read the trip-doc marker to distinguish "never synced" from
// "deliberately emptied", then either apply remote authoritatively (incl. empty) or
// seed remote from local — never losing user data, never resurrecting the sample over a
// deliberately-emptied shared plan.
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
import { savePlans, loadPlans, hasStoredPlans } from './itinerary-storage';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { FIREBASE_CONFIG, isRemoteConfigured, isTripRemoteConfigured, getTripId } from './firebase-config';
import { getActiveTraveler } from './token-auth';
import { mergeDay, mergeDays, gcTombstones } from '@/core/sync/merge-day';
import { seedHlcFromLegacy } from '@/core/sync/hlc';
import { outboxDirty } from '@/core/sync/outbox';
import { clock } from './trip-now';

// ---------------------------------------------------------------------------
// Shared lazy firebase handle. Both the read (subscribe) and write (push) paths
// need the same app/firestore instances; init them once, behind the gate, via
// dynamic import. The promise
// is cached so concurrent callers share one init.
//
// AUTH IS BACK, AND IT IS PART OF THE HANDLE (issue #10). The rules no longer read
// `if true` under a known tripId: every trip operation now sits behind an auth floor
// (`request.auth != null`), and a trip that has grown a `members` map is gated on membership.
// So this seam signs the device in ANONYMOUSLY before it resolves, and hands back the `auth`
// instance plus the resulting `uid`. Every other remote module awaits THIS function, so no
// module can issue a write before the floor is satisfied.
//
// THE UID IS DEVICE IDENTITY, NOT ACCOUNT IDENTITY. It is the subject a trip's members map
// names, it is free and unlimited, and it survives a Google link (`linkGoogleAccount` below
// preserves it — that is the whole point of linking rather than re-signing-in). Attribution
// still runs entirely through the separate, firebase-free display-name pipeline
// (lib/identity.ts / token-auth.ts) — a Firebase uid is never shown to a user as a name.
// ---------------------------------------------------------------------------

export type FirestoreMod = typeof import('firebase/firestore');

export interface RemoteHandle {
  db: import('firebase/firestore').Firestore;
  fs: FirestoreMod;
  /** The one shared app's Auth instance (the same singleton every module resolves). */
  auth: import('firebase/auth').Auth;
  /** This DEVICE's uid at init time — the subject a trip's `members` map names. */
  uid: string;
}

let remotePromise: Promise<RemoteHandle> | null = null;

/**
 * Lazily initialize firebase (app + firestore) ONCE, behind the `isRemoteConfigured()` gate.
 * Rejects (caller degrades to local-only) if the gate is off or any step fails; never throws
 * synchronously.
 *
 * EXPORTED so the expenses adapter (`lib/expenses-remote.ts`) shares the SAME cached
 * init — one firebase app across every synced domain. The anonymous sign-in is part of the
 * init, so awaiting this function is what guarantees the rules' auth floor is satisfied
 * before any caller issues a read or a write.
 */
export function getRemote(): Promise<RemoteHandle> {
  if (!isRemoteConfigured()) {
    return Promise.reject(new Error('remote not configured'));
  }
  if (remotePromise) return remotePromise;

  remotePromise = (async () => {
    const [{ initializeApp, getApps, getApp }, firestoreMod, authMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
      import('firebase/auth'),
    ]);

    const { getFirestore } = firestoreMod;
    const { getAuth, onAuthStateChanged, signInAnonymously } = authMod;

    // Reuse the singleton app if it already exists (one init across the app),
    // otherwise create it from the single-source config.
    const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

    const db = getFirestore(app);
    const auth = getAuth(app);

    // AWAIT THE FIRST AUTH-STATE RESOLUTION BEFORE SIGNING IN. Firebase restores a persisted
    // session asynchronously, so `auth.currentUser` is null for a beat on EVERY load; signing
    // in during that beat would mint a SECOND anonymous uid and silently orphan this device's
    // members entry (it would still be listed, under a uid nothing uses any more). Resolving
    // the observer once is what makes the uid stable across reloads.
    const restored = await new Promise<import('firebase/auth').User | null>((resolve, reject) => {
      const unsub = onAuthStateChanged(
        auth,
        (user) => {
          unsub();
          resolve(user);
        },
        (err) => {
          unsub();
          reject(err);
        },
      );
    });
    const user = restored ?? (await signInAnonymously(auth)).user;

    return { db, fs: firestoreMod, auth, uid: user.uid };
  })();

  // If init (incl. sign-in) fails, clear the cache so a later call can retry rather than
  // being stuck — a cold start while offline must not poison the handle for the session.
  remotePromise.catch(() => {
    remotePromise = null;
  });

  return remotePromise;
}

/**
 * This device's Firebase ID token, or `null` — for the Worker's `Authorization: Bearer …`
 * (issue #10; the Worker verifies membership by reading the trip doc AS this user).
 *
 * TOTAL: `null` when remote is unconfigured (the dormant build and every e2e run) and on ANY
 * failure, so a caller can only ever attach a header it actually has. The token is minted by
 * the SDK and refreshed by it — never cached here.
 */
export async function getAuthIdToken(): Promise<string | null> {
  if (!isRemoteConfigured()) return null;
  try {
    const { auth } = await getRemote();
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null; // unreachable firebase must degrade to "no header", never to a thrown turn
  }
}

/** What `linkGoogleAccount` did, as four outcomes a UI can speak plainly about. */
export type LinkResult = 'linked' | 'adopted' | 'popup-blocked' | 'failed';

/**
 * Link a Google identity onto THIS device's anonymous session (issue #10).
 *
 * WHY LINK RATHER THAN SIGN IN: linking PRESERVES the uid. The uid is what a trip's members map
 * names, so re-signing-in as Google (a different uid) would leave this device's entry pointing at
 * an identity nobody uses any more, and the user locked out of their own trip. Linking is the
 * whole feature; the Google account is a recovery handle bolted onto an identity that already has
 * access, not a new identity.
 *
 * 🔴 POPUP ONLY — NEVER `linkWithRedirect`. This app is a static export served from a GitHub Pages
 * origin while the Firebase `authDomain` is a different origin, so the redirect flow has to write
 * its pending-credential state cross-origin. Under Safari's storage partitioning that state is not
 * there when the user comes back, and the redirect completes as a silent no-op — the user taps,
 * disappears to Google, returns, and nothing has happened, with no error to show them. The popup
 * flow keeps the whole exchange in one window and reports its own failures, which is why every
 * branch below has something to say.
 *
 * ⚠ MUST BE CALLED FROM THE TAP'S USER GESTURE. Browsers only let a popup open under transient
 * activation. The `import('firebase/auth')` below resolves from the module cache in a microtask
 * (the Settings surface has already awaited `getRemote()` to show the device code by the time the
 * button exists), so it does not spend that activation — but do not move this behind a fetch.
 *
 * `credential-already-in-use` means that Google account is ALREADY a Firebase user — the traveler
 * linked it on their other device. Adopting it here (`signInWithCredential`) is exactly right: the
 * device takes on the identity that already holds the memberships, which is the lost-device
 * recovery path. It CHANGES the uid, so the cached handle is dropped and the caller must re-run
 * `ensureMembership`.
 */
export async function linkGoogleAccount(): Promise<LinkResult> {
  if (!isRemoteConfigured()) return 'failed';
  try {
    const { auth } = await getRemote();
    const { GoogleAuthProvider, linkWithPopup, signInWithCredential } = await import('firebase/auth');
    const user = auth.currentUser;
    if (!user) return 'failed';
    try {
      await linkWithPopup(user, new GoogleAuthProvider());
      return 'linked';
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
        return 'popup-blocked';
      }
      if (code === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(
          err as import('firebase/app').FirebaseError,
        );
        if (!credential) return 'failed';
        await signInWithCredential(auth, credential);
        // The uid just changed. Drop the cached handle so the next getRemote() resolves the
        // ADOPTED identity — every caller reads `uid` off that handle.
        remotePromise = null;
        return 'adopted';
      }
      return 'failed';
    }
  } catch {
    return 'failed'; // stay anonymous; the device keeps whatever access it already had
  }
}

/**
 * Is this device's session linked to a Google identity? Read from `providerData`, which is the
 * SDK's own answer — never a flag we keep ourselves and have to keep true.
 * `false` when unconfigured/unreachable (the honest default: nothing is linked).
 */
export async function isGoogleLinked(): Promise<boolean> {
  if (!isRemoteConfigured()) return false;
  try {
    const { auth } = await getRemote();
    return auth.currentUser?.providerData.some((p) => p.providerId === 'google.com') ?? false;
  } catch {
    return false;
  }
}

/**
 * Did this error come from the security rules refusing the operation? (issue #10)
 *
 * THE ONE COPY of that test. Firestore stamps `code: 'permission-denied'` on the rejection of a
 * denied read/write and on a denied snapshot stream error alike, and the three callers that must
 * treat a denial differently from a transport failure — membership enrolment (dispatch, don't
 * throw), the presence heartbeat (stop the loop, don't retry forever) and the door's identity
 * probe — all route through here rather than each spelling the string out.
 *
 * Deliberately narrow: only the code, never the message. A message match would fire on an
 * unrelated error that merely mentions permissions, and the consequence of a false positive here
 * is a heartbeat that stops or a toast the user cannot act on.
 */
export function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'permission-denied';
}

/**
 * Map a raw Firestore day-doc into a DayPlan. Defensive: tolerate partial/legacy docs
 * so a malformed remote doc degrades gracefully (it just yields a thin-but-valid
 * DayPlan) rather than throwing inside the snapshot handler.
 *
 * UNKNOWN DAY-LEVEL KEYS PASS THROUGH (#42). The doc's own keys are spread in FIRST and the
 * four type-checked fields written over the top, so a day-level field THIS build has no code
 * for still survives the trip back from Firestore. This used to be a four-field literal, which
 * made this function the single place in the whole chain that narrowed a day: Firestore stores
 * what it is handed, `sanitizeDayForWrite` is a JSON clone, and the Vault's read schema is
 * `.passthrough()` (`core/vault/schema.ts`, "unknown future fields survive a read"). Every
 * other layer already keeps unknown keys, and now this one agrees with them. A new per-day
 * field therefore needs NO edit here; do NOT reintroduce a field list. The one-off
 * `countryLabel` line this replaced (the Dec-9 header reverting to "New York, Nepal" after a
 * sync) was the same bug hit once and patched by name.
 *
 * `countryLabel` is nonetheless the ONE key still checked by name below, and the check is a
 * `delete`, not a copy. That shape is load-bearing now that the doc's keys are spread in: a
 * wrong-typed `countryLabel` is ALREADY on the object by the time the guard runs, so a guard
 * that only ever assigns would leave it there, and a number would then reach `compose`'s
 * `label.includes(city)` via `dayPlaceLabel` (`lib/leg-label.ts`) and throw. Do not "simplify"
 * it back to `if (typeof … === 'string') day.countryLabel = …`.
 *
 * BEHAVIOR-FROZEN: this mapper is pinned by the merge-primitive suite
 * (`itinerary-remote.test.ts`) and MUST stay a pure shape-mapper (no field defaulting).
 * Pass-through does not default anything: an absent key stays absent, so #42 holds the freeze.
 * The freeze has been deliberately broken EXACTLY ONCE, with the owner's sign-off: the `country`
 * assertion was re-pointed so a LEG ID passes through instead of being coerced to 'nepal' (see
 * D-303 and the note at that line — the old rule silently corrupted every synced custom trip).
 * Every other assertion is untouched; treat the suite as frozen again from here.
 * The Sync-v2 default-on-read is a
 * SEPARATE step, `defaultDayForMerge` below, applied at the two merge boundaries (snapshot
 * assembly + the transactional-push remote read) — NOT inside `docToDayPlan`. Keeping the
 * two concerns separate is what lets the frozen mapper stay frozen while new clients still
 * treat v1 remote docs as mergeable v2.
 */
export function docToDayPlan(id: string, data: Record<string, unknown>): DayPlan {
  const date = typeof data.date === 'string' ? data.date : id;
  // LEG-ID PASS-THROUGH (was `data.country === 'japan' ? 'japan' : 'nepal'`). `DayPlan.country`
  // is a LEG ID (lib/trip-data.ts), not a nepal/japan union — a custom trip's single leg is
  // 'main' (core/trips/custom.ts). The old coercion rewrote a synced custom trip's leg id to
  // 'nepal' on every authoritative first snapshot AND wrote it back to Firestore, because
  // `pushDayMerged` takes day-level fields from the REMOTE side of `mergeDay`. The rule here is
  // now the Vault read schema's own (`z.string().min(1)`, core/vault/schema.ts): any non-empty
  // string passes through; missing/blank/wrong-typed still defaults to 'nepal'. Still a pure
  // shape-mapper — the default fills ABSENT input, it never rewrites input that is present. D-303.
  const country = typeof data.country === 'string' && data.country ? data.country : 'nepal';
  const city = typeof data.city === 'string' ? data.city : '';
  const items = Array.isArray(data.items) ? (data.items as ItineraryItem[]) : [];
  const day = { ...data, date, city, country, items } as DayPlan;
  // `countryLabel` keeps its type guard because it is a DECLARED field with a real consumer:
  // a number here reaches `dayPlaceLabel`'s string ops (lib/leg-label.ts) and throws. Unknown
  // keys have no consumer by definition, which is why they can pass unchecked.
  if (typeof data.countryLabel !== 'string') delete day.countryLabel;
  return day;
}

/**
 * Default a single item's Sync v2 fields on read. Pure, clock-free — the
 * hlc is DERIVED from `updatedAt` via `seedHlcFromLegacy`, never minted, so every client
 * seeds the identical stamp for the same legacy item (no divergence). A v2 item that
 * already carries the fields (incl. a `deleted:true` tombstone) passes through unchanged.
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
 * Default a whole day's items for merging. The deployed shared trip's
 * `days/{date}` docs are v1 — items carry NO `rev`/`hlc`/`deleted`. Applying this at the
 * merge boundary makes a v1 remote doc a fully valid, MERGEABLE `DayPlan` in a new client's
 * memory WITHOUT any remote write — the core of the dual-read window. Tombstones are
 * KEPT (they must reach `mergeDay` to propagate + win); the UI-exposed `plans` selector
 * filters them downstream, not here.
 */
export function defaultDayForMerge(day: DayPlan): DayPlan {
  return { ...day, items: (day.items ?? []).map(defaultItemSyncFields) };
}

/**
 * Strip `undefined`-valued fields from a day's items before writing to Firestore.
 * Firestore rejects `undefined` field values; our `ItineraryItem` has many optional
 * fields (time/notes/sourceId/updatedBy/...) that are commonly undefined. JSON
 * round-trip drops them cleanly and is also a defensive deep-clone.
 */
export function sanitizeDayForWrite(day: DayPlan): Record<string, unknown> {
  return JSON.parse(JSON.stringify(day)) as Record<string, unknown>;
}

/**
 * Stable per-day equality: have this day's persisted contents actually changed
 * prev→next? Compared by value (JSON) so an unchanged day is NOT re-written (keeps
 * writes minimal — only changed day-docs hit Firestore,).
 */
export function dayEquals(a: DayPlan | undefined, b: DayPlan | undefined): boolean {
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
 * - a day whose contents CHANGED → a merge-aware transactional write (see below)
 *
 * - a day present in `prev` but ABSENT in `next` → `deleteDoc(days/{date})`
 * - unchanged days are not touched (no spurious writes / no echo storm)
 *
 * SYNC-V2 MERGE-AWARE WRITE. Today's blind
 * `setDoc(whole day)` is the lost-update bug at the TRANSPORT layer: even with a correct
 * local merge, two clients pushing the SAME day still overwrite each other's items. So each
 * changed day is written inside a `runTransaction`:
 * 1. read the CURRENT remote day-doc,
 * 2. default its v1 items on read (`docToDayPlan`) so it is a valid mergeable DayPlan,
 * 3. `mergeDay(remoteNow, localDay)` — item-level merge inside the day,
 * 4. write the merged doc.
 * A concurrent peer write to the same doc between the transaction's read and write forces
 * Firestore to RETRY the transaction, which re-reads the peer's now-committed state and
 * re-merges — so simultaneous same-day pushes NEVER lose an item (the headline v2 fix at
 * the write side). `mergeDay` is commutative+idempotent, so the retry is safe. Cost
 * is one extra doc read per changed day per edit — negligible on Spark FREE at 32 day-docs /
 * 3 editors. A day newly-created locally (absent remote) merges against an
 * empty remote and writes the local items — same code path, no special-casing.
 *
 * ECHO-SUPPRESSION: this is invoked ONLY from `commit()` (genuine local mutations),
 * never from the snapshot path. Attribution + the rev/hlc stamp (
 * gated on config) are already on the items handed in; they are written as-is here.
 *
 * Gated + lazy + degrading: no-ops when `isRemoteConfigured()` is false; wraps all SDK
 * work in try/catch → console.warn so a failed push NEVER breaks the local edit.
 */
export async function pushPlans(prev: DayPlan[], next: DayPlan[]): Promise<void> {
  // Dormant gate: with no config — or on the default pack, whose remote id is retired (#10,
  // `isTripRemoteConfigured`) — never touch firebase.
  // NO-ACTIVE-TRAVELER gate: a session with no active traveler must NEVER push
  // edits into the friends' shared trip — unattributed edits would otherwise pollute it via the
  // union merge. `getActiveTraveler` is firebase-free (token-auth), so this stays dormant-safe. This
  // mirrors the subscribe gate: sync requires BOTH config AND an identified traveler.
  if (!isTripRemoteConfigured() || !getActiveTraveler()) return;

  try {
    const { db, fs } = await getRemote();
    const { doc, deleteDoc } = fs;

    const prevByDate = new Map(prev.map((d) => [d.date, d]));
    const nextByDate = new Map(next.map((d) => [d.date, d]));

    const writes: Promise<void>[] = [];

    // Changed or newly-added days → merge-aware transactional write of that single day-doc.
    for (const day of next) {
      if (!dayEquals(prevByDate.get(day.date), day)) {
        writes.push(pushDayMerged(db, fs, day));
      }
    }

    // Days removed entirely (in prev, gone from next) → deleteDoc that day-doc.
    for (const day of prev) {
      if (!nextByDate.has(day.date)) {
        const ref = doc(db, 'trips', getTripId(), 'days', day.date);
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
 * Merge-aware transactional write of ONE changed day. Reads the
 * current remote day-doc inside a transaction, `mergeDay`s the local day on top of it, and
 * writes the merged result — so a concurrent same-day peer write forces a retry that
 * re-merges rather than clobbering. Exported for the wired-behavior unit test (fake
 * Firestore). See `pushPlans` for the full rationale.
 */
export async function pushDayMerged(
  db: import('firebase/firestore').Firestore,
  fs: Pick<FirestoreMod, 'doc' | 'runTransaction'>,
  localDay: DayPlan,
): Promise<void> {
  const { doc, runTransaction } = fs;
  const ref = doc(db, 'trips', getTripId(), 'days', localDay.date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    // Read the remote-now day and merge the local day on top.
    // An absent remote doc merges against an empty day → writes the local items unchanged.
    const remoteNow: DayPlan = snap.exists()
      ? defaultDayForMerge(docToDayPlan(localDay.date, snap.data() as Record<string, unknown>))
      // was a four-field literal that silently dropped every day-level field it did not
      // name — including the new `countryLabel`, which `mergeDay(remoteNow, localDay)` then took
      // from THIS object (mergeDay's day-level fields come from its FIRST argument), so the
      // label was erased on the very first push against an absent remote doc. Spreading the
      // local day is the same value for the four named fields and cannot drift again.
      : { ...localDay, items: [] };
    // GC BOUNDARY ①: prune past-horizon, unreferenced tombstones from the
    // MERGED result before writing — never in the hot merge path, never as its own write (the
    // GC'd doc ships on THIS genuine edit). Structurally cannot drop a live or recent-tombstone
    // item (gcTombstones' first guard). `nowPt` via the injected clock.
    const merged = gcTombstones(mergeDay(remoteNow, localDay), clock.now().getTime());
    tx.set(ref, sanitizeDayForWrite(merged));
  });
}

/**
 * Push ONE itinerary chunk (a day, keyed by `date`) from the CURRENT local state — the
 * `ChunkSync.pushChunk` impl the offline outbox drives. MUST REJECT on
 * failure: `getRemote()` rejects when unreachable and `pushDayMerged` rejects on a transport
 * error, so the outbox decorator keeps the chunk dirty (this function is NOT the swallower —
 * the decorator is). A dirty date whose day is ABSENT from `current` at flush time is SKIPPED
 * (resolve as a no-op → acked), never a blind `deleteDoc` — an unmerged whole-day delete could
 * clobber a peer's re-created day, and whole-day removal is not a user-reachable op (trip dates
 * are fixed; `clearDay` keeps the day). Gated + lazy firebase stays behind `getRemote()`.
 */
export async function pushDayChunk(current: DayPlan[], date: string): Promise<void> {
  const day = current.find((d) => d.date === date);
  if (!day) return; // absent day → skip (ack), never a blind delete
  const { db, fs } = await getRemote(); // rejects when unreachable → decorator keeps it dirty
  await pushDayMerged(db, fs, day); // rejects on transport error → decorator keeps it dirty
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
 * FIRST-SNAPSHOT RECONCILIATION. On the
 * FIRST snapshot we read the trip-doc marker `trips/{TRIP_ID}` once to distinguish
 * "never synced" from "deliberately emptied":
 * - Trip doc EXISTS (group synced before): remote is authoritative → apply the days
 * snapshot INCLUDING empty (`savePlans(remoteDays)` even if `[]`). This respects a
 * deliberately-emptied shared plan (no sample resurrection).
 * - Trip doc ABSENT (never synced): THIS client seeds → create the trip doc and push
 * the local state up. Seed source by local intent: localStorage
 * key PRESENT ⇒ push the user's local edits; key ABSENT ⇒ local is the untouched
 * SAMPLE_ITINERARY → seed from the sample. Local is left as-is (never overwritten
 * with an empty remote).
 *
 * STEADY-STATE (later snapshots): apply remote → `savePlans(remoteDays incl. [])` +
 * dispatch, SKIPPING any snapshot whose `metadata.hasPendingWrites` is true (the
 * client's own optimistic-write echo —). Another device's edits + deletions
 * appear; local edits aren't clobbered because they were pushed before they round-trip.
 *
 * Gating & safety: no-ops (returns a no-op unsubscribe) when `isRemoteConfigured()` is
 * false. All SDK/network work is wrapped so any failure degrades to local-only
 * via console.warn and never throws.
 *
 * @param onRemoteChange optional callback invoked (after the local write + dispatch)
 * with the assembled plans each time a remote snapshot is applied.
 * @returns an unsubscribe function (always safe to call, even on the dormant path).
 */
export function subscribeRemote(
  onRemoteChange?: (plans: DayPlan[]) => void,
): () => void {
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

  // One-shot `online` retry plumbing. If the INITIAL
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

  // Persist + dispatch a resolved plan set to the local store (the shared write tail).
  // Writes through the EXISTING persistence and dispatches the EXISTING
  // event DIRECTLY — NOT via commit() — so the snapshot path never re-pushes
  // `onRemoteChange`/`onApplied` receives the resolved plans.
  const persistAndDispatch = (plans: DayPlan[]) => {
    plans.sort((a, b) => a.date.localeCompare(b.date)); // stable local shape
    savePlans(plans);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));
    }
    onRemoteChange?.(plans);
  };

  // AUTHORITATIVE apply.
  // Remote is taken verbatim, INCLUDING empty — this is what makes "A deletes everything → B
  // reflects empty and STAYS empty after reload" true: a deliberately-emptied
  // shared plan is a real state, NOT a trigger to reseed, and must NOT be merged against the
  // local items (which would resurrect them). Used ONLY on the first, marker-gated snapshot.
  const applyRemoteAuthoritative = (plans: DayPlan[]) => {
    // THE DIRTY-CHUNK MERGE EXCEPTION. If the offline
    // outbox still holds unpushed local day-edits (flush-then-subscribe may not have completed
    // before this first server snapshot arrives), those dirty dates must NOT be overwritten
    // authoritatively — they are steady-state MERGED instead so the offline edit survives.
    //
    // SAFE AGAINST (delete-all-stays-empty, no sample resurrection): a chunk can be
    // dirty ONLY via a real commit() by an identified traveler on a configured build. The
    // sample-resurrection / delete-all-stays-empty path involves ZERO commits ⇒ the outbox is
    // EMPTY ⇒ this takes the plain authoritative branch below ⇒ byte-identical to today.
    const dirty = outboxDirty('itinerary');
    if (dirty.length === 0) {
      // Default v1 items on read so the local store holds valid v2-shaped items, but do
      // NOT merge — remote is authoritative here, verbatim incl. empty. An empty
      // remote defaults to empty (no items to seed), so delete-all-stays-empty is preserved.
      persistAndDispatch(plans.map(defaultDayForMerge));
      return;
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
  };

  // STEADY-STATE apply.
  // SYNC-V2: MERGE the incoming remote days against the CURRENT local view item-by-item
  // (`mergeDays(loadPlans(), remoteDays)`) before persisting, so a local edit that hasn't
  // round-tripped yet is preserved (different items, same day both survive — the headline
  // fix) while a peer's edits/deletes are folded in. The merge is item-level;
  // tombstones from either side are retained in the persisted/merged layer and filtered out
  // of the UI-exposed `plans` downstream. Applied DIRECTLY (savePlans +
  // dispatch), never via commit() — so it can never re-push, and
  // because mergeDay is idempotent, re-applying a snapshot we ourselves produced is a
  // value-identical no-op.
  const applyRemoteMerged = (remoteDays: DayPlan[]) => {
    // Default v1 remote items on read so a legacy day-doc merges as valid v2, then
    // item-merge against the current local view. Local is already v2 (migrated on load).
    const merged = mergeDays(loadPlans(), remoteDays.map(defaultDayForMerge));
    // GC BOUNDARY ②: the steady-state snapshot apply — prune past-horizon,
    // unreferenced tombstones from each MERGED day before persist (never in the hot merge path).
    // Convergent + conservative: a tombstone one client keeps re-enters via merge until every doc
    // holding it is rewritten past the 30-day horizon (near-inert at 32-day trip scale).
    const nowPt = clock.now().getTime();
    persistAndDispatch(merged.map((d) => gcTombstones(d, nowPt)));
  };

  // Lazy, gated setup. All wrapped — any failure degrades to local-only and
  // never throws. Idempotent + retryable:
  // returns early if already established/cancelled, and on failure arms the `online` retry
  // so a cold-offline start recovers when the network returns.
  const attemptSetup = async () => {
    if (cancelled || established || settingUp) return;
    settingUp = true;
    try {
      const { db, fs, uid } = await getRemote();
      if (cancelled || established) return;

      const { collection, onSnapshot, doc, getDoc, getDocFromServer, setDoc, serverTimestamp } = fs;
      const daysCol = collection(db, 'trips', getTripId(), 'days');

      firestoreUnsub = onSnapshot(
        daysCol,
        (snapshot) => {
          // Skip the echo of the client's OWN optimistic write: when we push a
          // day, Firestore fires a local snapshot with hasPendingWrites=true before the
          // server round-trip. Applying it is redundant (local already has it) and could
          // race; the authoritative server snapshot follows with hasPendingWrites=false.
          if (snapshot.metadata.hasPendingWrites) return;

          // FIRST-SNAPSHOT must reconcile against SERVER truth, never a cold/empty cache
          // onSnapshot can deliver a cache-sourced first event (e.g. right
          // after the listener (re)establishes following an offline window) — an EMPTY one
          // would wrongly look like "never synced" and could drive the seed branch, wiping a
          // peer's real remote with the local sample. So we DEFER reconciliation until the
          // first `fromCache === false` (server) snapshot. A pre-server cache snapshot is
          // simply ignored here: the local store already holds the correct first-paint data
          //, so skipping it is non-destructive.
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
                  { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp, uid },
                  applyRemoteAuthoritative,
                );
                return;
              }

              // Steady-state: MERGE remote against current local, apply incl. empty
              // This is also the path Firestore drives when it
              // AUTO-RECONNECTS after an offline window: the listener stays attached and
              // re-delivers the server state (a friend's offline edits flushed on reconnect
              // arrive here), and our own offline writes round-trip through the
              // hasPendingWrites guard — no duplicate, no wipe, no lost same-day item.
              applyRemoteMerged(remoteDays);
            } catch (err) {
              // A bad single snapshot must not break the stream or the app.
              console.warn('[itinerary-remote] failed to apply remote snapshot:', err);
            }
          })();
        },
        (err) => {
          // Stream error (rules/network/quota). Firestore retries transient/network errors
          // on its own behind a live listener, so we stay local-only and never throw
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
 * First-snapshot reconciliation handshake. Reads the trip-doc marker once
 * to decide between "remote authoritative" and "this client seeds".
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
    /** This device's uid — named `owner` in the seed marker's members map (#10). */
    uid: string;
  },
  // The AUTHORITATIVE applier (not the merging one): on the first snapshot, a synced group's
  // remote is taken verbatim incl. empty. Merging here
  // would resurrect local items over a deliberately-emptied shared plan — so the first
  // snapshot deliberately does NOT merge. Steady-state (later snapshots) does merge.
  applyRemote: (plans: DayPlan[]) => void,
): Promise<void> {
  const { db, doc, getDoc, getDocFromServer, setDoc, serverTimestamp, uid } = ctx;
  const tripRef = doc(db, 'trips', getTripId());

  // The trip-doc marker is the "has this group ever synced" signal. Read it from
  // the SERVER so a fresh client doesn't see a stale/absent cached value as authoritative
  // — using getDocFromServer makes that explicit ( hardening: a plain getDoc may serve
  // an empty cache after an offline window, which would wrongly look like "never synced"
  // and seed the sample over a peer's real remote). Fall back to a cache getDoc only if the
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

  const localWasPersisted = hasStoredPlans(); // present ⇒ user edits; absent ⇒ the built shells/sample

  if (tripExists && (remoteDays.length > 0 || localWasPersisted)) {
    // Group synced before → remote authoritative, apply INCLUDING empty.
    // This is what makes "A deletes everything → B reflects empty and STAYS empty after
    // reload" true: an emptied shared plan is a real state, not a trigger to reseed.
    applyRemote(remoteDays);
    return;
  }

  // #10 — THE MARKER IS NO LONGER THE ONLY SEED SIGNAL, and this branch is why. `createTripDoc`
  // now writes the trip doc AT CREATION TIME (it has to: the members map must name the creator as
  // owner, and rules only accept that on the create). So the creator's very first snapshot finds
  // the marker PRESENT with ZERO day docs — which under the old single condition meant "the group
  // synced and then emptied the plan", and applied `[]` authoritatively over the day shells
  // `buildDayShells` had just derived from the trip's dates. A brand-new trip rendered no day
  // cells at all, on the creator's own device.
  //
  // The added terms make that impossible while leaving every other path byte-identical: with ANY
  // remote day doc, or with a local key already written (which every device that has ever received
  // a snapshot has, because applying one calls savePlans), behaviour is exactly as before. Only
  // "marker present, remote completely empty, this device never persisted anything" seeds — and
  // whole-day removal is not a user-reachable operation (trip dates are fixed; `clearDay` keeps the
  // day), so a completely empty remote means "never pushed to", never "deliberately emptied".
  //
  // Trip doc ABSENT → never synced → THIS client seeds the group.
  // Seed source by LOCAL intent: key present ⇒ the user's own
  // local edits (incl. a deliberate empty); key absent ⇒ the untouched SAMPLE_ITINERARY
  // that loadPlans() returned at first paint. Either way we read the local truth and
  // push it up. We do NOT overwrite local (no applyRemote on this branch) — local is
  // already correct; seeding makes remote match local. (`hasStoredPlans()` is read for
  // the explicit intent signal even though we always seed from the local snapshot.)
  // use the STATIC `loadPlans` imported at the top — the former `await import(...)` here
  // was redundant (itinerary-storage is firebase-free, so importing it statically is dormant-safe).
  const localPlans = loadPlans();
  const localIsUserData = localWasPersisted; // present ⇒ user edits; absent ⇒ sample seed

  try {
    // Create the trip-doc marker first so a concurrent second client sees "synced" and
    // takes the authoritative branch instead of double-seeding. Skipped when the marker is
    // already there (the create-path doc, #10) — rewriting it would clobber a `members` entry a
    // peer added between the create and this first snapshot.
    // #10: the marker carries the same `members` map `createTripDoc` writes, so a trip seeded
    // through THIS legacy path is member-gated from birth too (parity — otherwise the two ways a
    // trip doc can come into existence would disagree about whether the lock is on).
    if (!tripExists) {
      await setDoc(tripRef, {
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        seededFrom: localIsUserData ? 'local-edits' : 'sample',
        members: { [uid]: 'owner' },
      });
    }

    // Push every local day up via the per-day write path (reuse pushPlans with an empty
    // prev so every present day is written; no day is "removed").
    await pushPlans([], localPlans);
  } catch (err) {
    console.warn('[itinerary-remote] first-snapshot seed failed, staying local-only:', err);
  }
  // Local stays as-is; the seed round-trips back as a steady-state snapshot (which our
  // hasPendingWrites guard + value-identical savePlans make a no-op for the UI).
}
