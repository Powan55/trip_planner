// Offline push outbox. Without it, an edit whose push failed would be discarded on reload by
// the first remote snapshot.
//
// State-based, not an op queue: every remote write is an idempotent read-merge-set, so the
// outbox only records WHICH chunks have unconfirmed local changes. A flush re-pushes their
// current local state. Offline add+undo nets out locally, and re-enqueueing is a no-op.
// Retries continue until a push resolves; chunks the rules refuse stop retrying for this page
// load but stay queued (see `denied`).
//
// `withOutbox` wraps a domain push as a SyncPort push. `pushChunk` must reject on failure;
// this module does the swallowing.
//
// Only active when the trip syncs remotely and a traveler is signed in, so dormant and guest
// builds never write the slot. Both gates are firebase-free.

import type { StoragePort, SyncPort } from '@/core/ports';
import { DEFAULT_TRIP_ID, getActiveTripId, getDefaultTripShareId, getStoredDefaultTripShareId, keyForTrip, readJson, writeJson, removeKey } from '@/core/storage/gateway';
import { isPermissionDenied } from '@/core/sync/denied';
import { getTripId, isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';

export type SyncDomain = 'itinerary' | 'expenses' | 'budget' | 'docs' | 'places';

export interface ChunkSync<T> {
  domain: SyncDomain;
  /** Keys of the chunks that changed (dates for itinerary, legs for expenses, ['model'] for budget). */
  chunkDiff(prev: T, next: T): string[];
  /** Merged write of one chunk. Must reject on failure so the chunk stays dirty; resolving on an
   * absent chunk acks it. `tripId` is the remote id captured when the push was queued. */
  pushChunk(chunk: string, current: T, tripId: string): Promise<void>;
}

interface OutboxSlot {
  version: 1;
  dirty: Partial<Record<SyncDomain, string[]>>;
  /** Last successful ack across all domains, for the sync badge. Optional, no version bump. */
  lastAckAt?: string;
  /** Per-chunk enqueue counter (D-572). An ack clears a chunk only if nothing was enqueued since
   * its push, so another tab's newer edit stays dirty. Never pruned: a reset counter would let a
   * stale ack match a fresh edit. */
  seq?: Partial<Record<SyncDomain, Record<string, number>>>;
}

/** Same-tab change event, fired on every slot write. Other tabs get the `storage` event. */
export const SYNC_OUTBOX_CHANGED_EVENT = 'sync-outbox:changed';

function notifyChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

// Persistence

// Slots whose save was refused (quota, or a newer build's slot). Reads merge them back in so this
// page load still sees the chunks; the next successful save carries them to disk.
const unsaved = new Map<string, OutboxSlot>();

function unsavedKey(slotKey: string, packId: string): string {
  // A share switch drops the default pack's slot; memory from the old trip must not outlive it.
  return packId === DEFAULT_TRIP_ID ? JSON.stringify([slotKey, getStoredDefaultTripShareId()]) : slotKey;
}

function withUnsaved(slot: OutboxSlot, key: string, packId: string): OutboxSlot {
  const mem = unsaved.get(unsavedKey(key, packId));
  if (!mem) return slot;
  const dirty: OutboxSlot['dirty'] = { ...slot.dirty };
  for (const d of Object.keys(mem.dirty) as SyncDomain[]) {
    dirty[d] = [...new Set([...(dirty[d] ?? []), ...(mem.dirty[d] ?? [])])];
  }
  const seq: NonNullable<OutboxSlot['seq']> = { ...slot.seq };
  for (const [d, counters] of Object.entries(mem.seq ?? {}) as [SyncDomain, Record<string, number>][]) {
    const merged = { ...seq[d] };
    for (const [c, n] of Object.entries(counters)) merged[c] = Math.max(merged[c] ?? 0, n);
    seq[d] = merged;
  }
  const lastAckAt = [slot.lastAckAt, mem.lastAckAt].filter((s): s is string => !!s).sort().pop();
  return { version: 1, dirty, lastAckAt, seq };
}

function isNewerVersion(raw: unknown): boolean {
  const v = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  return typeof v === 'number' && v > 1;
}

function loadSlot(tripId?: string): OutboxSlot {
  const packId = tripId ?? getActiveTripId();
  const key = keyForTrip(packId, 'syncOutbox');
  return withUnsaved(readSlot(key), key, packId);
}

function readSlot(key: string): OutboxSlot {
  const raw = readJson<OutboxSlot | null>('local', key, null);
  if (!raw || typeof raw !== 'object') return { version: 1, dirty: {} };
  // Unknown version: warn rather than fail silently. saveSlot won't overwrite a newer one.
  if (raw.version !== 1) {
    console.warn('[outbox] ignoring a slot written at version', raw.version, '— expected 1');
    return { version: 1, dirty: {} };
  }
  if (typeof raw.dirty !== 'object' || raw.dirty === null) {
    const got = raw.dirty === null ? 'null' : typeof raw.dirty;
    console.warn('[outbox] discarding a slot whose dirty map is', got, '— expected an object');
    return { version: 1, dirty: {} };
  }
  // Keep only arrays of strings, so a corrupt value can't throw in ack or outboxBlocked.
  const dirty: OutboxSlot['dirty'] = {};
  for (const key of Object.keys(raw.dirty) as SyncDomain[]) {
    const value = (raw.dirty as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      const got = value === null ? 'null' : typeof value;
      console.warn('[outbox] dropping the queued', key, 'chunks — expected an array, got', got);
      continue;
    }
    const chunks = value.filter((c): c is string => typeof c === 'string');
    if (chunks.length > 0) dirty[key] = chunks;
  }
  const lastAckAt = typeof raw.lastAckAt === 'string' ? raw.lastAckAt : undefined;
  const seq: NonNullable<OutboxSlot['seq']> = {};
  if (raw.seq && typeof raw.seq === 'object') {
    for (const [d, counters] of Object.entries(raw.seq)) {
      if (!counters || typeof counters !== 'object') continue;
      const kept: Record<string, number> = {};
      for (const [chunk, n] of Object.entries(counters)) {
        if (Number.isFinite(n)) kept[chunk] = n;
      }
      seq[d as SyncDomain] = kept;
    }
  }
  return { version: 1, dirty, lastAckAt, seq };
}

function chunkSeq(slot: OutboxSlot, domain: SyncDomain, chunk: string): number {
  return slot.seq?.[domain]?.[chunk] ?? 0;
}

/** A slot that does not reach disk is kept in `unsaved` instead. */
function saveSlot(packId: string, dirty: OutboxSlot['dirty'], lastAckAt?: string, seq?: OutboxSlot['seq']): boolean {
  // A clean slot with no ack yet removes the key; after any ack it stays so "synced Xm ago"
  // survives a reload.
  const pruned: OutboxSlot['dirty'] = {};
  for (const d of Object.keys(dirty) as SyncDomain[]) {
    const arr = dirty[d];
    if (arr && arr.length > 0) pruned[d] = arr;
  }
  const key = keyForTrip(packId, 'syncOutbox');
  const memKey = unsavedKey(key, packId);
  const slot: OutboxSlot = { version: 1, dirty: pruned };
  if (lastAckAt !== undefined) slot.lastAckAt = lastAckAt;
  if (seq && Object.keys(seq).length > 0) slot.seq = seq;
  let ok: boolean;
  if (isNewerVersion(readJson<unknown>('local', key, null))) {
    console.warn('[outbox] not overwriting a slot from a newer version; keeping this change in memory');
    ok = false;
    // Literal name, not an export: storage-persistence.tsx (root layout) must not import this module.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('trip:outbox-newer-version'));
  } else if (Object.keys(pruned).length === 0 && lastAckAt === undefined) {
    removeKey('local', key);
    ok = true;
  } else {
    ok = writeJson('local', key, slot);
  }
  if (ok) unsaved.delete(memKey);
  else unsaved.set(memKey, slot);
  notifyChanged();
  return ok;
}

/** A copy of a domain's dirty chunks, used by the first-snapshot merge. `tripId` reads another
 * pack's slot. */
export function outboxDirty(domain: SyncDomain, tripId?: string): string[] {
  return [...(loadSlot(tripId).dirty[domain] ?? [])];
}

// Trip-scoped: on the local-only sample pack the remote id is '', so a flush would build an
// invalid path and retry forever.
function enabled(): boolean {
  return isTripRemoteConfigured() && getActiveTraveler() !== null;
}

/** Read-only snapshot for the sync badge. Empty when the outbox is disabled. */
export function outboxSnapshot(): { dirty: OutboxSlot['dirty']; lastAckAt: string | null } {
  if (!enabled()) return { dirty: {}, lastAckAt: null };
  const slot = loadSlot();
  return { dirty: slot.dirty, lastAckAt: slot.lastAckAt ?? null };
}

// Chunks the rules refused (permission-denied) this page load. Retrying would fail identically
// forever, so they're skipped until reload. Not acked: the dirty mark is what protects the
// unpushed edit from the first snapshot (D-150). Not persisted: membership may be granted later
// from another device. Keyed by trip, because chunk ids like budget/model repeat across trips.
const denied = new Set<string>();

function deniedKey(packId: string, domain: SyncDomain, chunk: string): string {
  return JSON.stringify([keyForTrip(packId, 'syncOutbox'), domain, chunk]);
}

/** Record a refusal, warning once per chunk. */
function markDenied(packId: string, domain: SyncDomain, chunk: string): void {
  const key = deniedKey(packId, domain, chunk);
  if (denied.has(key)) return;
  denied.add(key);
  console.warn(
    `[outbox] ${domain}/${chunk} was refused by the rules — not retrying it this page load`,
  );
  notifyChanged();
}

/**
 * How many still-dirty chunks were refused this page load. Intersected with the live dirty map
 * because a wipe or trip switch clears the slot but not `denied`.
 */
export function outboxBlocked(): number {
  if (!enabled() || denied.size === 0) return 0;
  const packId = getActiveTripId();
  const { dirty } = loadSlot(packId);
  let n = 0;
  for (const domain of Object.keys(dirty) as SyncDomain[]) {
    for (const chunk of dirty[domain] ?? []) {
      if (denied.has(deniedKey(packId, domain, chunk))) n += 1;
    }
  }
  return n;
}

/** Write-ahead: add the chunks to the dirty set synchronously, before any network. Bumps each
 * chunk's counter and returns the new values for the ack; null if the slot didn't reach disk.
 *
 * Reads the slot fresh right before saving to narrow the cross-tab race. KNOWN CEILING: another
 * tab can still write between the read and the save; closing it needs Web Locks. */
function enqueue(packId: string, domain: SyncDomain, chunks: string[]): Record<string, number> | null {
  const fresh = loadSlot(packId);
  const set = new Set(fresh.dirty[domain] ?? []);
  const counters = { ...fresh.seq?.[domain] };
  for (const c of chunks) {
    set.add(c);
    counters[c] = (counters[c] ?? 0) + 1;
  }
  fresh.dirty[domain] = [...set];
  if (saveSlot(packId, fresh.dirty, fresh.lastAckAt, { ...fresh.seq, [domain]: counters })) return counters;
  // Make the memory-only counter non-integer so it can't match another tab's counter and ack its
  // newer edit. withUnsaved's max then prefers the disk value.
  for (const c of chunks) counters[c] -= Math.random();
  return null;
}

/** Clear a confirmed chunk and stamp lastAckAt, but only if its counter still equals `seq`;
 * otherwise the push carried stale state and the chunk stays dirty. Same race caveat as enqueue. */
function ack(packId: string, domain: SyncDomain, chunk: string, seq: number): void {
  const fresh = loadSlot(packId);
  const arr = fresh.dirty[domain];
  if (!arr) return;
  if (chunkSeq(fresh, domain, chunk) !== seq) return;
  fresh.dirty[domain] = arr.filter((c) => c !== chunk);
  saveSlot(packId, fresh.dirty, new Date().toISOString(), fresh.seq);
}

// At most one push in flight per chunk. Otherwise an older push resolving would ack the chunk
// while a newer edit was still in flight, and if that one failed it would never be retried.
// A second commit joins the running push, which then re-pushes the newest state.
// Per tab only; the slot's seq counter covers acks across tabs.
interface ChunkRun {
  /** Newest state to push for this chunk; overwritten by every joiner. */
  latest: unknown;
  /** Enqueue counter captured with `latest`. */
  seq: number;
  /** Set by a joiner: the attempt in flight is stale and must not ack. */
  superseded: boolean;
  promise: Promise<void>;
}
const running = new Map<string, ChunkRun>();

/** Pack and remote id captured when a push is queued, since the active trip can change during
 * pushChunk's awaits. */
interface Target {
  packId: string;
  remoteId: string;
  shareId: string;
}

function captureTarget(): Target | null {
  const remoteId = getTripId();
  return remoteId ? { packId: getActiveTripId(), remoteId, shareId: getDefaultTripShareId() } : null;
}

function pushChunkOnce<T>(cs: ChunkSync<T>, t: Target, chunk: string, current: T, seq: number): Promise<void> {
  // Both commit and flush paths pass through here, so one refusal check covers both.
  if (denied.size > 0 && denied.has(deniedKey(t.packId, cs.domain, chunk))) return Promise.resolve();
  const key = [t.packId, t.remoteId, cs.domain, chunk].join('\u0000'); // NUL: none of these contain it
  const live = running.get(key);
  if (live) {
    // Hand the running loop the newer state and join it, instead of opening a second transaction.
    live.latest = current;
    live.seq = seq;
    live.superseded = true;
    return live.promise;
  }
  const run: ChunkRun = { latest: current, seq, superseded: false, promise: Promise.resolve() };
  running.set(key, run);
  // Assigned before the first await, so a joiner never sees the placeholder.
  run.promise = (async () => {
    try {
      for (;;) {
        run.superseded = false;
        const attemptSeq = run.seq;
        try {
          await cs.pushChunk(chunk, run.latest as T, t.remoteId); // ② attempt
        } catch (err) {
          // ④ Swallowed: the chunk stays dirty and retries on the next flush. Never rethrow to
          // the commit caller. Rules refusals are recorded so they stop retrying.
          if (isPermissionDenied(err)) markDenied(t.packId, cs.domain, chunk);
          return;
        }
        // ③ Ack only the attempt that carried the newest state.
        // A share switch wiped this pack's slot and restarted its counters, so seq is meaningless now.
        if (t.packId === DEFAULT_TRIP_ID && getDefaultTripShareId() !== t.shareId) return;
        if (!run.superseded) {
          // Outside the attempt's try, so guard it: a throw would reject into every joiner.
          try {
            ack(t.packId, cs.domain, chunk, attemptSeq);
          } catch {
            /* the chunk stays dirty and retries */
          }
          return;
        }
        // A newer edit landed mid-flight: loop and push it.
      }
    } finally {
      // Same job as the return above, so a finishing run can't be joined.
      running.delete(key);
    }
  })();
  return run.promise;
}

/** Push each chunk from `current`. Acks are synchronous, so they can't interleave. */
async function pushChunks<T>(
  cs: ChunkSync<T>,
  t: Target,
  current: T,
  chunks: string[],
  seqs: Record<string, number>,
): Promise<void> {
  await Promise.all(chunks.map((chunk) => pushChunkOnce(cs, t, chunk, current, seqs[chunk] ?? 0)));
}

/**
 * Wrap a domain's push with the outbox: ① enqueue the diff synchronously, ② push each chunk from
 * `next`, ③ ack on resolve, ④ swallow rejections so the next flush retries. No-op when disabled.
 *
 * Returns false without pushing if the write-ahead record didn't reach disk; nothing would protect
 * the edit after a reload, so the caller rolls the commit back.
 */
export function withOutbox<T>(cs: ChunkSync<T>): SyncPort<T>['push'] {
  return (prev: T, next: T) => {
    try {
      const t = enabled() ? captureTarget() : null;
      if (!t) return Promise.resolve();
      const chunks = cs.chunkDiff(prev, next);
      if (chunks.length === 0) return Promise.resolve();
      const seqs = enqueue(t.packId, cs.domain, chunks); // ① write-ahead
      if (!seqs) return false;
      return pushChunks(cs, t, next, chunks, seqs); // ②③④
    } catch (err) {
      return Promise.reject(err); // never a sync throw into commit
    }
  };
}

/** Whether a domain has a dirty chunk worth retrying. Refused chunks don't count. */
export function outboxRetryable(domain: SyncDomain): boolean {
  if (!enabled()) return false;
  const packId = getActiveTripId();
  return (loadSlot(packId).dirty[domain] ?? []).some((c) => !denied.has(deniedKey(packId, domain, c)));
}

// One flush per trip and domain. A call landing mid-flush asks for a rerun rather than returning,
// since the running pass may already have failed (an `online` flush during an offline one).
const inFlight = new Map<string, { promise: Promise<void>; rerun: boolean }>();

/**
 * Re-push a domain's dirty chunks from the freshest local state. Runs on online, visible,
 * app start and the retry timer. Commits don't take this flag; they go through pushChunkOnce,
 * so neither path can block the other.
 */
export async function flushOutbox<T>(cs: ChunkSync<T>, storage: StoragePort<T>): Promise<void> {
  const t = enabled() ? captureTarget() : null;
  if (!t) return;
  const fk = [t.packId, t.remoteId, cs.domain].join('\u0000');
  const live = inFlight.get(fk);
  if (live) {
    live.rerun = true;
    return live.promise;
  }
  if ((loadSlot(t.packId).dirty[cs.domain] ?? []).length === 0) return;
  const entry = { promise: Promise.resolve(), rerun: false };
  inFlight.set(fk, entry);
  entry.promise = (async () => {
    try {
      do {
        entry.rerun = false;
        const slot = loadSlot(t.packId);
        const chunks = slot.dirty[cs.domain] ?? [];
        if (chunks.length === 0) break;
        // Counters before state, so the pushed state is at least as new as they are.
        await pushChunks(cs, t, storage.load(), chunks, { ...slot.seq?.[cs.domain] });
      } while (entry.rerun);
    } finally {
      inFlight.delete(fk);
    }
  })();
  return entry.promise;
}
