// Offline push outbox — the ONE state-based sync outbox.
//
// THE PROBLEM: today a failed push is dropped, and on reload the
// first-snapshot-authoritative apply DISCARDS the never-pushed offline edit. So an edit made
// offline is silently lost on reload.
//
// THE DESIGN: every remote write is a merge-aware
// transactional read→merge→set over commutative/idempotent merges. So the minimal
// sufficient record is NOT a queue of CRUD ops but simply WHICH CHUNKS have unconfirmed local
// changes. On flush, the CURRENT local state of each dirty chunk is re-pushed through the same
// merged write. This resolves undo↔outbox BY CONSTRUCTION (an add+undo while offline nets in
// localStorage; the flush pushes the net once — no ordering, no coalescing, no replay), and
// makes re-enqueueing an already-dirty chunk a set no-op.
//
// EXACTLY-ONCE: at-least-once transport × idempotent merged writes. A dirty
// chunk is retried until one `pushChunk` RESOLVES (the record persists across reloads); the ack
// then ends retries; duplicate flushes produce value-identical docs because the merge algebra IS
// the dedup (no tokens, no sequence numbers).
//
// THE DECORATOR SEAM: `withOutbox` wraps a domain's push into a `SyncPort['push']`, so the
// reactive-store factory's `commit()` tail is untouched. The
// `ChunkSync.pushChunk` MUST REJECT on failure — honesty moves down one layer; THIS module is
// the swallower, not the impl.
//
// GATING: enqueue AND flush happen ONLY when `isRemoteConfigured()` AND an
// active traveler. Dormant and guest builds NEVER write the outbox slot → dormant bytes stay
// identical and a guest can never queue pollution for later. Both gates are firebase-
// free (firebase-config reads inlined env; token-auth reads localStorage via the gateway), so
// this module pulls NO firebase onto the dormant hot path. (Runtime import of the two app-wide
// gates from lib/ mirrors `lib/itinerary-remote.pushPlans`, and core/vault already imports lib
// at runtime — the dependency direction is an accepted, existing pattern for the sync seam.)

import type { StoragePort, SyncPort } from '@/core/ports';
import { keyFor, readJson, writeJson, removeKey } from '@/core/storage/gateway';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';

export type SyncDomain = 'itinerary' | 'expenses' | 'budget' | 'docs';

/**
 * The per-domain recipe the decorator drives. State-based: it only needs the prev→next chunk
 * diff and a merge-aware single-chunk write. NO op record, no sequence number.
 */
export interface ChunkSync<T> {
  domain: SyncDomain;
  /** Pure prev→next chunk diff — the chunk keys whose contents changed (dates for itinerary;
   * legs for expenses; ['model'] for budget). */
  chunkDiff(prev: T, next: T): string[];
  /** Merge-aware transactional write of ONE chunk from `current`. MUST REJECT on failure so the
   * decorator can keep the chunk dirty; resolving on a legitimately-absent chunk (a skip) is
   * correct and acks the chunk. */
  pushChunk(chunk: string, current: T): Promise<void>;
}

interface OutboxSlot {
  version: 1;
  dirty: Partial<Record<SyncDomain, string[]>>;
  /** — a single, app-wide (NOT per-domain) ISO timestamp of the most recent successful
   * `ack()`, across every domain. Absent on a fresh slot / an old pre- slot (`undefined`,
   * never throws) — that reads as "no ack yet recorded". Single-timestamp, not per-domain: the
   * sync-status badge (`components/sync-status-badge.tsx`) is one app-wide "synced" signal, and
   * a traveler doesn't need to know WHICH domain acked most recently, only that the outbox is
   * making progress. Additive field, no `version` bump (old slots simply lack it). */
  lastAckAt?: string;
}

/** — same-tab liveness signal. Dispatched
 * from `saveSlot()`, the single choke point for every outbox write (enqueue OR ack), so
 * `hooks/use-sync-status.ts` can re-read live without a reload. Cross-tab liveness is the
 * standard `storage` event (fired automatically by the browser on any OTHER tab's write to this
 * key) — the hook listens for both, same as `use-favorites.ts`. */
export const SYNC_OUTBOX_CHANGED_EVENT = 'sync-outbox:changed';

function notifyChanged(): void {
  if (typeof window === 'undefined') return; // SSR-safe: no-op off the client.
  window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

// ── Persistence. The slot survives reload BY CONSTRUCTION — that is the point.
// SSR-safe / never-throw / corrupt-slot→empty are inherited from the gateway primitives; the
// shape guard below folds a structurally-bad slot to empty too. ──────────────────────────────

function loadSlot(): OutboxSlot {
  const raw = readJson<OutboxSlot | null>('local', keyFor('syncOutbox'), null);
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || typeof raw.dirty !== 'object') {
    return { version: 1, dirty: {} };
  }
  // tolerate an old slot that simply lacks `lastAckAt`, or a structurally-bad
  // value on it — never throw, just treat it as "no ack yet recorded".
  const lastAckAt = typeof raw.lastAckAt === 'string' ? raw.lastAckAt : undefined;
  return { version: 1, dirty: raw.dirty, lastAckAt };
}

function saveSlot(dirty: OutboxSlot['dirty'], lastAckAt?: string): void {
  // Prune empty domain arrays. A fully-clean outbox with NO ack timestamp yet REMOVES the key (so
  // "slot cleared" is literal and the byte footprint is zero) — but once ANY ack has ever been
  // recorded, the key persists (holding `{dirty:{}, lastAckAt}`) so the sync-status badge's
  // resting "synced Xm ago" state survives a reload too.
  const pruned: OutboxSlot['dirty'] = {};
  for (const d of Object.keys(dirty) as SyncDomain[]) {
    const arr = dirty[d];
    if (arr && arr.length > 0) pruned[d] = arr;
  }
  if (Object.keys(pruned).length === 0 && lastAckAt === undefined) {
    removeKey('local', keyFor('syncOutbox'));
    notifyChanged();
    return;
  }
  const slot: OutboxSlot = { version: 1, dirty: pruned };
  if (lastAckAt !== undefined) slot.lastAckAt = lastAckAt;
  writeJson('local', keyFor('syncOutbox'), slot);
  notifyChanged();
}

/** The dirty chunk keys currently recorded for a domain (a copy; empty when none). Read by the
 * first-snapshot dirty-chunk merge exception (subscribeRemote) —. */
export function outboxDirty(domain: SyncDomain): string[] {
  return [...(loadSlot().dirty[domain] ?? [])];
}

// ── The gate. Both enqueue and flush re-check it, so a traveler who signs out with
// a dirty outbox keeps the entries and resumes on sign-in. ────────────────────────────────────
function enabled(): boolean {
  return isRemoteConfigured() && getActiveTraveler() !== null;
}

/**
 * — read-only snapshot for the sync-status UI (`hooks/use-sync-status.ts`). Returns the
 * FULL dirty map (every domain key currently present — no per-domain enumeration, so this
 * tolerates a future 4th `SyncDomain` with zero edits here) and the last-ack timestamp.
 *
 * SELF-GATED with the SAME `enabled()` check as every other entry point in this module (/
 *): a dormant or guest build gets the neutral `{dirty:{}, lastAckAt:null}` shape, which is
 * exactly the "nothing to show" state the badge already renders as nothing — one gate, reused,
 * rather than a second copy of the isRemoteConfigured()/getActiveTraveler() check living in the
 * hook. Never throws (inherits `loadSlot`'s never-throw).
 */
export function outboxSnapshot(): { dirty: OutboxSlot['dirty']; lastAckAt: string | null } {
  if (!enabled()) return { dirty: {}, lastAckAt: null };
  const slot = loadSlot();
  return { dirty: slot.dirty, lastAckAt: slot.lastAckAt ?? null };
}

/** Write-ahead: union the chunks into the domain's dirty set (synchronous localStorage write,
 * BEFORE any network). Re-enqueueing an already-dirty chunk is a set no-op. Preserves whatever
 * `lastAckAt` was already on disk — enqueuing new dirty work doesn't erase the last-synced
 * signal, it just adds to what's still pending. */
function enqueue(domain: SyncDomain, chunks: string[]): void {
  if (chunks.length === 0) return;
  const slot = loadSlot();
  const set = new Set(slot.dirty[domain] ?? []);
  for (const c of chunks) set.add(c);
  slot.dirty[domain] = [...set];
  saveSlot(slot.dirty, slot.lastAckAt);
}

/** Ack: remove one confirmed chunk from the domain's dirty set, and stamp the single app-wide
 * `lastAckAt` to now — every real ack is progress worth surfacing, regardless of domain. */
function ack(domain: SyncDomain, chunk: string): void {
  const slot = loadSlot();
  const arr = slot.dirty[domain];
  if (!arr) return;
  slot.dirty[domain] = arr.filter((c) => c !== chunk);
  saveSlot(slot.dirty, new Date().toISOString());
}

/** Attempt each chunk from `current`; ack on resolve, swallow on reject (chunk stays dirty). The
 * ack read-modify-write is fully synchronous, so concurrent acks under one flush never interleave
 * destructively (single-threaded JS). */
async function pushChunks<T>(cs: ChunkSync<T>, current: T, chunks: string[]): Promise<void> {
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        await cs.pushChunk(chunk, current); // ② attempt
        ack(cs.domain, chunk); // ③ ack-on-resolve
      } catch {
        // ④ rejection swallowed — the write-ahead record persists, so the chunk retries on the
        // next flush trigger (and across a reload). NEVER rethrow to the commit caller.
      }
    }),
  );
}

/**
 * Decorate a domain's push with the outbox. Returned as a `SyncPort['push']`,
 * so it drops straight into the reactive-store factory's `sync?` seam. Push path:
 * ① write-ahead enqueue `chunkDiff(prev,next)` (sync, before any network),
 * ② attempt `pushChunk` for each of THIS diff's chunks from `next` (the just-committed state),
 * ③ ack each on resolve, ④ swallow rejections (the chunk stays dirty for the next flush).
 * Dormant/guest ⇒ no-op, no slot write. Never throws.
 */
export function withOutbox<T>(cs: ChunkSync<T>, _storage: StoragePort<T>): SyncPort<T>['push'] {
  return async (prev: T, next: T): Promise<void> => {
    if (!enabled()) return;
    const chunks = cs.chunkDiff(prev, next);
    if (chunks.length === 0) return;
    enqueue(cs.domain, chunks); // ① write-ahead
    await pushChunks(cs, next, chunks); // ②③④
  };
}

// One in-flight flag per domain: a concurrent flush for the same domain is a
// no-op; cross-tab double-flush is harmless (idempotent writes). Module-scope, matching the one
// shared outbox.
const inFlight = new Set<SyncDomain>();

/**
 * Flush a domain's dirty set. Called on `online` / visible / app-start. Reads the
 * FRESHEST local state (`storage.load()`) and re-pushes each dirty chunk with the same ack rule, so
 * the flush pushes the netted local state once. Dormant/guest ⇒ no-op. Concurrent same-domain
 * flushes are guarded. Never throws.
 */
export async function flushOutbox<T>(cs: ChunkSync<T>, storage: StoragePort<T>): Promise<void> {
  if (!enabled()) return;
  if (inFlight.has(cs.domain)) return;
  const chunks = outboxDirty(cs.domain);
  if (chunks.length === 0) return;
  inFlight.add(cs.domain);
  try {
    await pushChunks(cs, storage.load(), chunks);
  } finally {
    inFlight.delete(cs.domain);
  }
}
