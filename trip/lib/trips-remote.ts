// Trip identity (name + config) in `trips/{tripId}/meta/info`, so someone joining by link gets
// the trip itself, not just its rows. `meta` and `profile` are reserved subcollection names.
//
// Writes are best-effort and never reject; a failed push is queued in key 58 (D-880) and
// retried by flushPendingTripSync. If you're about to navigate, await the push under a timeout
// (CREATE_PUSH_BUDGET_MS in trips-hub): the lazy firebase load takes longer than a page unload,
// and an unawaited write dies in flight.
// Reads are one-shot; the provider applies them once per load by updatedAt (D-600).
// Imported only dynamically, so dormant builds load no firebase.

'use client';

import {
  sanitizeTripConfig,
  listKnownTrips,
  listRemovedTrips,
  mergeTripLists,
  importRemoteTrips,
  isLegacyAccountKey,
  getKnownTrip,
  readTripSyncQueue,
  SHARED_NAME,
  type TripConfigBlock,
  type TripMeta,
  type RemovedTrip,
  type TripSyncQueue,
} from '@/core/trips/registry';
import {
  DEFAULT_TRIP_ID,
  STORAGE_KEYS,
  getActiveTripId,
  getSyncCode,
  isSafeTripSegment,
  removeKey,
  wasTripCreatedHere,
  writeJson,
} from '@/core/storage/gateway';
import { SYNC_OUTBOX_CHANGED_EVENT } from '@/core/sync/outbox';
import {
  isTripListDenied,
  isTripMetaDenied,
  markTripListDenied,
  markTripMetaDenied,
} from '@/core/sync/read-denied';
import { DEFAULT_TRAVELER_NAME } from './token-auth';
import { isRemoteConfigured, isTripRemoteConfigured } from './firebase-config';
import { getRemote, isPermissionDenied } from './firebase-remote';
import { SHARED_TRIP_ID } from './shared-trip';

export type TripMetaPayload = { name: string; config?: TripConfigBlock; updatedAt?: number };

/**
 * Push a trip's name/config. Never rejects; queued for retry until it lands. `tripId` is passed
 * in because a rename can target any known trip. Settles after the setDoc ack.
 */
export async function pushTripMeta(tripId: string, meta: TripMetaPayload): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(tripId)) return;
  queueTripSync((q) => ({ ...q, meta: [...new Set([...q.meta, tripId])] }));
  try {
    await writeTripMeta(tripId, meta, false);
    settleTripMeta(tripId, meta.updatedAt);
  } catch (err) {
    if (isPermissionDenied(err)) markTripMetaDenied(tripId);
    console.warn('[trips-remote] trip meta push failed, queued for retry:', err);
  }
}

/**
 * The one `meta/info` writer. Rejects on failure. `retry` reads the doc first and skips the write
 * when its `updatedAt` is the same as or newer than ours: D-600's last-writer rule, applied before a queued push
 * lands so it cannot overwrite a peer's later rename. An explicit edit writes as it always has.
 */
async function writeTripMeta(tripId: string, meta: TripMetaPayload, retry: boolean): Promise<void> {
  const { db, fs } = await getRemote();
  const { doc, setDoc, runTransaction } = fs;
  const ref = doc(db, 'trips', tripId, 'meta', 'info');
  const payload: Record<string, unknown> = { name: meta.name };
  // D-600: the entry's own client-clock stamp, the same clock the synced trip list compares on.
  if (typeof meta.updatedAt === 'number' && Number.isFinite(meta.updatedAt)) payload.updatedAt = meta.updatedAt;
  // JSON round-trip both clones and strips `undefined`-valued optional fields (`currency`),
  // which Firestore's setDoc rejects — same defensive move as docs-remote's sanitizeRowsForWrite.
  if (meta.config) payload.config = JSON.parse(JSON.stringify(meta.config));
  // Merge only without a config: a joiner's rename mustn't erase the creator's config, but a
  // config edit must overwrite so deleted keys don't survive the deep merge.
  const opts = meta.config ? {} : { merge: true };
  if (!retry) return setDoc(ref, payload, opts);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remoteAt = snap.exists() ? (snap.data() as Record<string, unknown>).updatedAt : undefined;
    // Equal stamp: the doc already holds this version, and rewriting it from our sanitised copy
    // could drop fields a newer build added.
    if (typeof remoteAt === 'number' && remoteAt >= (meta.updatedAt ?? 0)) return;
    tx.set(ref, payload, opts);
  });
}

// Retry queue for trip meta and the trip list (key 58, D-880). It records which things are
// unsynced, not payloads, so a retry sends the current local state. Refusals are skipped until
// reload but stay queued, like the outbox.

function queueTripSync(edit: (q: TripSyncQueue) => TripSyncQueue): void {
  const q = edit(readTripSyncQueue());
  if (q.meta.length === 0 && !q.list) removeKey('local', STORAGE_KEYS.tripSyncQueue);
  else writeJson('local', STORAGE_KEYS.tripSyncQueue, q);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

const dropMeta = (tripId: string) => queueTripSync((q) => ({ ...q, meta: q.meta.filter((id) => id !== tripId) }));

/** Dequeue only if the entry has not been edited since the pushed copy; a newer edit stays queued. */
function settleTripMeta(tripId: string, pushedAt: number | undefined): void {
  if (getKnownTrip(tripId)?.updatedAt === pushedAt) dropMeta(tripId);
}

// A later list push in this tab owns the queue entry; an earlier one landing must not clear it.
// KNOWN CEILING: per tab. A list push in another tab can still clear this tab's entry.
let listPushes = 0;

let tripSyncFlush: Promise<void> | null = null;

/**
 * Retry every queued trip rename and the queued trip list. Called by the sync badge on mount,
 * `online` and tab return. One run at a time; refused entries are skipped. Never rejects, and an
 * empty queue costs nothing (no firebase load).
 */
export function flushPendingTripSync(): Promise<void> {
  if (!isRemoteConfigured()) return Promise.resolve();
  if (tripSyncFlush) return tripSyncFlush;
  const q = readTripSyncQueue();
  if (q.meta.length === 0 && !q.list) return Promise.resolve();
  tripSyncFlush = (async () => {
    for (const id of q.meta) {
      if (isTripMetaDenied(id)) continue;
      const k = getKnownTrip(id);
      // Forgotten, or a placeholder name the self-heal would not push either: nothing to send.
      if (!k || id === DEFAULT_TRIP_ID || !isSafeTripSegment(id) || k.name === SHARED_NAME) {
        dropMeta(id);
        continue;
      }
      try {
        await writeTripMeta(id, { name: k.name, config: k.config, updatedAt: k.updatedAt }, true);
        settleTripMeta(id, k.updatedAt);
      } catch (err) {
        if (isPermissionDenied(err)) markTripMetaDenied(id);
        else console.warn('[trips-remote] trip meta retry failed, still queued:', err);
      }
    }
    if (q.list) {
      // The list belongs to the account that queued it; after an account change it is not ours.
      if ((getSyncCode()?.trim() ?? '') !== q.list) queueTripSync((f) => (f.list === q.list ? { meta: f.meta } : f));
      else if (!isTripListDenied(q.list)) await pushTripList(q.list);
    }
  })()
    .catch((err) => console.warn('[trips-remote] trip sync flush failed:', err))
    .finally(() => {
      tripSyncFlush = null;
    });
  return tripSyncFlush;
}

/** One-shot meta read; undefined on any failure. A bad config degrades to name-only. */
export async function fetchTripMeta(tripId: string): Promise<TripMetaPayload | undefined> {
  if (!isRemoteConfigured() || !isSafeTripSegment(tripId)) return undefined;
  try {
    const { db, fs } = await getRemote();
    const { doc, getDoc } = fs;
    const ref = doc(db, 'trips', tripId, 'meta', 'info');
    const snap = await getDoc(ref);
    if (!snap.exists()) return undefined;
    const data = snap.data() as Record<string, unknown>;
    if (typeof data.name !== 'string' || data.name.trim().length === 0) return undefined;
    const config = sanitizeTripConfig(data.config);
    const out: TripMetaPayload = config ? { name: data.name, config } : { name: data.name };
    if (typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt)) out.updatedAt = data.updatedAt;
    return out;
  } catch (err) {
    console.warn('[trips-remote] trip meta fetch failed:', err);
    return undefined;
  }
}

// Known-trips list across devices: `trips/{syncCode}/profile/tripList` =
// `{ version: 1, trips, removed? }`. Older clients ignore `removed`. The sample pack is never
// pushed (its id is secret).

// Account display name: `trips/{userToken}/profile/identity` = `{ version: 1, name }`. A separate
// doc because tripList is written as a full overwrite, and a stale client would drop the name.
// No timeout handling: identity is never written from a navigating code path.

/**
 * Publish the account's display name. Never rejects; the provider retries on the next load.
 * Callers must not publish the login placeholder (DEFAULT_TRAVELER_NAME); a deliberate rename
 * to that name is allowed, so this function doesn't filter it.
 */
export async function pushAccountIdentity(code: string, name: string): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return;
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) return;
  try {
    await writeIdentityDoc(code, trimmed);
  } catch (err) {
    console.warn('[trips-remote] account identity push failed, staying local-only:', err);
  }
}

/**
 * The only identity-doc writer. Without `name` it writes `{ version: 1 }`: the account exists
 * with no name, so callers can create it without publishing the placeholder. Rejects on failure.
 */
async function writeIdentityDoc(code: string, name?: string): Promise<void> {
  const { db, fs } = await getRemote();
  const { doc, setDoc } = fs;
  await setDoc(
    doc(db, 'trips', code, 'profile', 'identity'),
    name ? { version: 1, name } : { version: 1 },
  );
}

/**
 * Seed both account docs for a new key, as the door's create path does. Without the identity
 * doc the door rejects the key on every other device. Filters the placeholder name here.
 * Best-effort; the login fallback backfills a failed identity write.
 */
export async function seedAccountDocs(code: string, name?: string | null): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return;
  const trimmed = name?.trim().slice(0, 24);
  const publishable = trimmed && trimmed !== DEFAULT_TRAVELER_NAME ? trimmed : undefined;
  await Promise.all([
    writeIdentityDoc(code, publishable).catch((err) =>
      console.warn('[trips-remote] account identity seed failed, staying local-only:', err),
    ),
    pushTripList(code),
  ]);
}

/** The reconciler's read of `profile/identity`. `error` covers dormant, unreachable and denied. */
export type AccountIdentityRead =
  | { status: 'exists'; name?: string }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Server read of the identity doc for the provider's reconciler. An error is never reported as
 * "missing", or the reconciler would overwrite a real name it failed to see.
 */
export async function fetchAccountIdentity(code: string): Promise<AccountIdentityRead> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return { status: 'error' };
  try {
    const { db, fs } = await getRemote();
    const { doc, getDocFromServer } = fs;
    const snap = await getDocFromServer(doc(db, 'trips', code, 'profile', 'identity'));
    if (!snap.exists()) return { status: 'missing' };
    return {
      status: 'exists',
      name: readIdentityName(snap.data() as Record<string, unknown> | undefined),
    };
  } catch (err) {
    console.warn('[trips-remote] account identity fetch failed:', err);
    return { status: 'error' };
  }
}

/**
 * Whether a tripList doc proves `code` is a real account (D-565). The door fails open offline,
 * so a typo'd key can get in; this stops the reconciler minting a permanent identity doc for it.
 * False on any error.
 */
export async function hasRemoteTripList(code: string): Promise<boolean> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return false;
  try {
    const { db, fs } = await getRemote();
    const { doc, getDocFromServer } = fs;
    const snap = await getDocFromServer(doc(db, 'trips', code, 'profile', 'tripList'));
    return snap.exists();
  } catch (err) {
    console.warn('[trips-remote] trip-list evidence read failed:', err);
    return false;
  }
}

/** Create-only identity write for legacy keys that lack one; a transaction so it never
 * overwrites. Never rejects. */
export async function healAccountIdentity(code: string, name?: string): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return;
  const trimmed = name?.trim().slice(0, 24);
  const publishable = trimmed && trimmed !== DEFAULT_TRAVELER_NAME ? trimmed : undefined;
  try {
    const { db, fs } = await getRemote();
    const { doc, runTransaction } = fs;
    const ref = doc(db, 'trips', code, 'profile', 'identity');
    await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return;
      tx.set(ref, publishable ? { version: 1, name: publishable } : { version: 1 });
    });
  } catch (err) {
    console.warn('[trips-remote] account identity heal failed, retries next load:', err);
  }
}

// ── #10 — the front door's account-existence probe ──────────────────────────────────────────

export type AccountProbe = 'exists' | 'missing' | 'unavailable';

/** `name` is only set with `verdict: 'exists'`. */
export type AccountProbeResult = { verdict: AccountProbe; name?: string };

/** How long the door waits for the identity read before admitting anyway (#10). */
const PROBE_TIMEOUT_MS = 8000;

/** The shared sanitiser for `profile/identity`'s `name`: trimmed, capped at 24, blank ⇒ undefined. */
function readIdentityName(data: Record<string, unknown> | undefined): string | undefined {
  if (typeof data?.name !== 'string') return undefined;
  return data.name.trim().slice(0, 24) || undefined;
}

/**
 * The door's login check, one server read under an 8s budget (which covers the firebase load):
 * - 'exists': a real account (with its display name, if any)
 * - 'missing': the server says no such account
 * - 'unavailable': timeout or any error. Callers admit on this: a network failure must never
 *   lock someone out of their own data.
 * Server read, not cache: a cold cache reports absence. permission-denied is logged loudly
 * because it would silently disable the check.
 */
export async function probeAccountIdentity(code: string): Promise<AccountProbeResult> {
  if (!isRemoteConfigured() || !code) return { verdict: 'unavailable' };
  if (!isSafeTripSegment(code)) return { verdict: 'missing' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readAccountVerdict(code),
      // Timer wins ⇒ admit rather than hang the door.
      new Promise<AccountProbeResult>((resolve) => {
        timer = setTimeout(() => resolve({ verdict: 'unavailable' }), PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'permission-denied') {
      console.warn('[door] rules deny the identity probe — token validation is inoperative');
    }
    return { verdict: 'unavailable' }; // offline/error must admit — never lock a real user out
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The probe's reads. Older keys have a tripList doc but no identity doc, so a missing identity
 * falls back to reading tripList before rejecting, then backfills identity so the extra read
 * happens once.
 */
async function readAccountVerdict(code: string): Promise<AccountProbeResult> {
  const { db, fs } = await getRemote();
  const { doc, getDocFromServer } = fs;
  const snap = await getDocFromServer(doc(db, 'trips', code, 'profile', 'identity'));
  if (snap.exists()) {
    return { verdict: 'exists', name: readIdentityName(snap.data() as Record<string, unknown>) };
  }
  const list = await getDocFromServer(doc(db, 'trips', code, 'profile', 'tripList'));
  if (!list.exists()) return { verdict: 'missing' };
  await writeIdentityDoc(code).catch((err) =>
    console.warn('[trips-remote] legacy identity backfill failed, retries next login:', err),
  );
  // No name: the account never had one server-side. The door falls back to this device's stored
  // name, then to the placeholder + the rename nudge — the same as any account that knows none.
  return { verdict: 'exists' };
}

// Member lock. A trip doc may carry `members: { <uid>: 'owner' | 'member' }`; one naming an owner
// switches the trip from "anyone with the id" to membership. Opt-in so existing trips and links
// keep working (see firestore.rules).
// createTripDoc names the creator owner. Others add themselves via a field-path update, since a
// non-owner may only make add-only members edits. Members may only add 'member' (D-642).

export type TripRole = 'owner' | 'member';

/**
 * Fired when the rules refuse this device's enrolment; the provider shows a toast.
 * itinerary-provider.tsx uses the string literal to keep firebase off its chunk; keep in step
 * (trip-membership.test.ts checks).
 */
export const TRIP_ACCESS_PENDING_EVENT = 'trip:access-pending';

/**
 * The members map off a raw trip doc, or `undefined` when the rules' `isOpen()` reads the trip as
 * open: no map, not a map, or no value equal to 'owner' (#453). Must stay in step with isOpen().
 */
export function readMembers(data: Record<string, unknown> | undefined): Record<string, string> | undefined {
  const raw = data?.members;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (!Object.values(raw).includes('owner')) return undefined;
  return raw as Record<string, string>;
}

/**
 * Create a new trip's doc with this device as owner. Must run before any subcollection write:
 * rules only accept the members map on create, and later writes need the creator in it.
 */
export async function createTripDoc(tripId: string): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(tripId)) return;
  try {
    const { db, fs, uid } = await getRemote();
    const { doc, setDoc, serverTimestamp } = fs;
    await setDoc(doc(db, 'trips', tripId), {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      seededFrom: 'create',
      members: { [uid]: 'owner' },
    });
  } catch (err) {
    console.warn('[trips-remote] trip doc create failed, staying local-only:', err);
  }
}

/**
 * Enrol this device in a trip. Never rejects.
 * - No trip doc, or already a member: no write.
 * - Open trip (no owner): no write. Claiming owner here would let whoever taps a forwarded link
 *   first lock out the creator, and 'member' would be refused by the rules. Open trips stay open
 *   (D-540).
 * - Otherwise add as 'member' via a field-path update.
 * permission-denied fires `trip:access-pending`; gated trips need an invite link.
 */
export async function ensureMembership(tripId: string): Promise<void> {
  // This function also repairs every known trip after Google-account adoption, when the
  // active pack may be the local-only sample. Gate the explicit target, not the active pack.
  if (!isRemoteConfigured() || !isSafeTripSegment(tripId) || tripId === DEFAULT_TRIP_ID || tripId === SHARED_TRIP_ID) return;
  try {
    const { db, fs, uid } = await getRemote();
    const { doc, getDocFromServer, updateDoc } = fs;
    const ref = doc(db, 'trips', tripId);
    // Server read: a stale cache could skip a required enrolment, or make an owner write itself
    // as 'member' and silently demote itself.
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) return;
    const members = readMembers(snap.data() as Record<string, unknown>);
    if (!members) {
      // Open trip — no roster to invent (#477), unless this device created it and a joiner's
      // seed landed first (#501): the creator reclaims owner.
      if (wasTripCreatedHere(tripId)) await updateDoc(ref, { [`members.${uid}`]: 'owner' });
      return;
    }
    if (uid in members) return; // already enrolled — no write
    await updateDoc(ref, { [`members.${uid}`]: 'member' });
  } catch (err) {
    if (isPermissionDenied(err)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TRIP_ACCESS_PENDING_EVENT));
      }
      return;
    }
    console.warn('[trips-remote] membership enrolment failed:', err);
  }
}

/** Re-enrol an adopted Firebase identity in every remotely-backed trip known on this device. */
export async function ensureKnownTripMemberships(): Promise<void> {
  await Promise.all(
    listKnownTrips()
      // A kept legacy-name row is an account path, not a trip: never enrol in it (#775).
      .filter((trip) => trip.id !== DEFAULT_TRIP_ID && !isLegacyAccountKey(trip.id))
      .map((trip) => ensureMembership(trip.id)),
  );
}

/**
 * Keep 'open' and 'unknown' distinct: the UI hides controls on 'open', and 'unknown' is routine
 * offline because the server read rejects instead of using the cache.
 */
export type TripRosterRead =
  /** A read that came back with a roster the rules will actually gate on. */
  | { state: 'roster'; members: Record<string, TripRole> }
  /** A read that SUCCEEDED and found no usable roster: no members map, or one
   *  `readMembers`/`isOpen()` read as open. Everyone holding the trip id can open it. */
  | { state: 'open' }
  /** A read that SUCCEEDED and found no trip doc: the creator's first sync has not landed (#501). */
  | { state: 'absent' }
  /** Nothing was established — dormant, offline, unreachable, or refused. */
  | { state: 'unknown' };

/** The trip's roster. Any failure is `{ state: 'unknown' }`. */
export async function fetchTripMembers(tripId: string): Promise<TripRosterRead> {
  if (!isTripRemoteConfigured() || !isSafeTripSegment(tripId)) return { state: 'unknown' };
  try {
    const { db, fs } = await getRemote();
    const { doc, getDocFromServer } = fs;
    const snap = await getDocFromServer(doc(db, 'trips', tripId));
    if (!snap.exists()) return { state: 'absent' };
    const members = readMembers(snap.data() as Record<string, unknown>) as
      | Record<string, TripRole>
      | undefined;
    return members ? { state: 'roster', members } : { state: 'open' };
  } catch (err) {
    console.warn('[trips-remote] members fetch failed:', err);
    return { state: 'unknown' };
  }
}

/** What a roster write did. `denied` is the rules refusing it, which the UI must explain. */
export type MemberWriteResult = 'ok' | 'denied' | 'failed';

/** Any member may add another device, always as 'member' (D-642). */
export async function addTripMember(tripId: string, uid: string): Promise<MemberWriteResult> {
  return writeMemberField(tripId, uid, 'member');
}

/** Owner only; the rules enforce it too. */
export async function removeTripMember(tripId: string, uid: string): Promise<MemberWriteResult> {
  return writeMemberField(tripId, uid, null);
}

/** Remove this device's own key. The last owner gets 'denied'. Doesn't forget the trip locally. */
export async function leaveTrip(tripId: string, uid: string): Promise<MemberWriteResult> {
  return writeMemberField(tripId, uid, null);
}

/**
 * Promote or demote, owner only. The last owner can't step down. A transfer is promote then
 * demote; a second owner is the only recovery from a lost owner device.
 */
export async function setTripMemberRole(
  tripId: string,
  uid: string,
  role: TripRole,
): Promise<MemberWriteResult> {
  return writeMemberField(tripId, uid, role);
}

const FIREBASE_UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** One field-path write against the members map — `null` value ⇒ delete that entry. */
async function writeMemberField(
  tripId: string,
  uid: string,
  role: TripRole | null,
): Promise<MemberWriteResult> {
  if (!isTripRemoteConfigured() || !isSafeTripSegment(tripId) || !uid) return 'failed';
  if (!FIREBASE_UID_RE.test(uid)) return 'failed';
  try {
    const { db, fs } = await getRemote();
    const { doc, updateDoc, deleteField } = fs;
    // FIELD PATH, never a whole-document write: the rules only ever accept an edit whose affected
    // keys are exactly `members`.
    await updateDoc(doc(db, 'trips', tripId), { [`members.${uid}`]: role ?? deleteField() });
    return 'ok';
  } catch (err) {
    if (isPermissionDenied(err)) return 'denied';
    console.warn('[trips-remote] members write failed:', err);
    return 'failed';
  }
}

/** Extract the row array from a raw remote list doc (defensive: tolerate a partial/missing doc). */
function docToTrips(data: Record<string, unknown>): TripMeta[] {
  return Array.isArray(data.trips) ? (data.trips as TripMeta[]) : [];
}

/** Extract the tombstone array from a raw remote list doc. */
function docToRemoved(data: Record<string, unknown>): RemovedTrip[] {
  return Array.isArray(data.removed) ? (data.removed as RemovedTrip[]) : [];
}

/**
 * Merge the local trip list into the remote one in a transaction, so concurrent devices
 * re-merge instead of clobbering. Never rejects; failures are queued for retry.
 */
export async function pushTripList(code: string): Promise<void> {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return;
  const push = ++listPushes;
  queueTripSync((q) => ({ ...q, list: code }));
  try {
    const { db, fs } = await getRemote();
    const { doc, runTransaction } = fs;
    const ref = doc(db, 'trips', code, 'profile', 'tripList');
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      const { merged, removed } = mergeTripLists(
        listKnownTrips(),
        docToTrips(data),
        listRemovedTrips(),
        docToRemoved(data),
        { keepUnknownKeys: true }, // #519: this merge is written straight back to the doc below
      );
      tx.set(ref, {
        version: 1,
        trips: JSON.parse(JSON.stringify(merged)),
        removed: JSON.parse(JSON.stringify(removed)),
      });
    });
    if (push === listPushes) queueTripSync((q) => (q.list === code ? { meta: q.meta } : q));
  } catch (err) {
    if (isPermissionDenied(err)) markTripListDenied(code);
    console.warn('[trips-remote] trip list push failed, queued for retry:', err);
  }
}

/**
 * Subscribe to the remote trip list and merge it in, pushing back when local had extras.
 * A missing doc is left alone: seeding it would make any pasted string a working account.
 * No reconnect retry; a dropped stream resubscribes on reload. `activeTripChanged` is true only
 * when a tombstone moved the active trip, and then the caller reloads.
 */
export function subscribeTripList(
  code: string,
  onMerge?: (activeTripChanged: boolean) => void,
): () => void {
  if (!isRemoteConfigured() || !isSafeTripSegment(code)) return () => {};

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
            firstSnapshotHandled = true;
            if (snap.exists()) {
              const data = snap.data() as Record<string, unknown>;
              const activeBefore = getActiveTripId();
              const { localHadExtras } = importRemoteTrips(docToTrips(data), docToRemoved(data));
              if (localHadExtras) void pushTripList(code); // push our extras/removals up (best-effort)
              onMerge?.(getActiveTripId() !== activeBefore);
            }
            // ABSENT ⇒ do nothing (#10). The old absent-first-snapshot seed branch is deleted —
            // see the docblock. An account with no tripList doc gets one from its next deliberate
            // list-changing action, never from merely logging in with a string.
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
