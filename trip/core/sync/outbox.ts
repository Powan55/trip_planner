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
// the dedup (no tokens, no sequence numbers). #267 adds the one other way retries end: a chunk the
// RULES REFUSED is not retried again this page load — see the `denied` block below. It is not
// acked and not dropped, so it stays queued and stays protected; it just stops being attempted,
// and `outboxBlocked()` makes it visible instead of leaving it silently "pending".
//
// THE DECORATOR SEAM: `withOutbox` wraps a domain's push into a `SyncPort['push']`, so the
// reactive-store factory's `commit()` tail is untouched. The
// `ChunkSync.pushChunk` MUST REJECT on failure — honesty moves down one layer; THIS module is
// the swallower, not the impl.
//
// GATING: enqueue AND flush happen ONLY when `isTripRemoteConfigured()` (#10 — the web config
// AND a trip that actually syncs; the default pack is a local-only sample) AND an
// active traveler. Dormant and guest builds NEVER write the outbox slot → dormant bytes stay
// identical and a guest can never queue pollution for later. Both gates are firebase-
// free (firebase-config reads inlined env; token-auth reads localStorage via the gateway), so
// this module pulls NO firebase onto the dormant hot path. (Runtime import of the two app-wide
// gates from lib/ mirrors `lib/itinerary-remote.pushPlans`, and core/vault already imports lib
// at runtime — the dependency direction is an accepted, existing pattern for the sync seam.)

import type { StoragePort, SyncPort } from '@/core/ports';
import { keyFor, readJson, writeJson, removeKey } from '@/core/storage/gateway';
import { isPermissionDenied } from '@/core/sync/denied';
import { isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';

export type SyncDomain = 'itinerary' | 'expenses' | 'budget' | 'docs' | 'places';

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
  if (!raw || typeof raw !== 'object') return { version: 1, dirty: {} };
  // A version we do not understand is discarded rather than guessed at, but it is NOT discarded
  // silently (#439): dropping every pending chunk is exactly the kind of data-shaped event that
  // should leave a trace, or a future migration bug looks like "sync just stopped".
  if (raw.version !== 1) {
    console.warn('[outbox] discarding a slot written at version', raw.version, '— expected 1');
    return { version: 1, dirty: {} };
  }
  if (typeof raw.dirty !== 'object' || raw.dirty === null) return { version: 1, dirty: {} };
  // Per-DOMAIN validation (#439). The object check above proved `dirty` is an object; it proved
  // nothing about its values. A corrupt slot whose domain value is a string or a number used to
  // reach `for (const chunk of dirty[domain])` in outboxBlocked and `arr.filter` in ack, and throw
  // out of both — out of an async caller, past this module's never-throw contract. Keep only
  // arrays, and only the string entries inside them, so every consumer below is handed the shape
  // it already assumes.
  const dirty: OutboxSlot['dirty'] = {};
  for (const key of Object.keys(raw.dirty) as SyncDomain[]) {
    const value = (raw.dirty as Record<string, unknown>)[key];
    if (!Array.isArray(value)) continue;
    const chunks = value.filter((c): c is string => typeof c === 'string');
    if (chunks.length > 0) dirty[key] = chunks;
  }
  // tolerate an old slot that simply lacks `lastAckAt`, or a structurally-bad
  // value on it — never throw, just treat it as "no ack yet recorded".
  const lastAckAt = typeof raw.lastAckAt === 'string' ? raw.lastAckAt : undefined;
  return { version: 1, dirty, lastAckAt };
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
// a dirty outbox keeps the entries and resumes on sign-in. #10: the gate is TRIP-scoped
// (`isTripRemoteConfigured`) because every chunk this outbox ever drives is a
// `trips/{getTripId()}/…` write — on the local-only default pack (remote id retired, '') an
// enqueue would otherwise record dirty chunks whose flush composes an invalid empty path and
// retries forever. Custom trips are unchanged (their id is never ''). ─────────────────────────
function enabled(): boolean {
  return isTripRemoteConfigured() && getActiveTraveler() !== null;
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

// ── #267: A REFUSED WRITE IS NOT A FAILED ONE. ───────────────────────────────────────────────
// The `catch` below swallows a rejection so the chunk retries, which is right for a transport
// failure and wrong for a rules refusal. A `permission-denied` answers identically on every
// retry — this device is not in the trip's `members` map, or the write is over `firestore.rules`'
// shape bound — so the chunk is re-pushed on every flush trigger (tab focus, `online`, every
// mount) for the rest of the session, while the badge reads "pending" with nothing that can ever
// clear it. `firestore.rules` names that outcome in those words.
//
// A refused chunk is recorded here and SKIPPED until the page reloads. Deliberately NOT acked and
// deliberately NOT persisted:
//   · not acked — the chunk MUST stay dirty. The dirty set is also what protects an unpushed local
//     edit from the first-snapshot authoritative apply (D-150's merge exception), so acking a
//     refused chunk would DISCARD on reload the very edit that could not be pushed. It stays
//     queued; it just stops being re-attempted.
//   · not persisted — membership can be granted later, from another device. `lib/presence.ts`
//     draws the same line for the same refusal ("re-arms on the next page load"), and a flag on
//     disk would need an expiry protocol to avoid blocking a chunk that is now allowed.
//
// Keyed by the TRIP-scoped slot key, not by domain+chunk alone: `budget`/`model` and
// `docs`/`checklist` are singleton chunk ids shared by every trip, so a bare key would carry one
// trip's refusal into another across a switch that did not reload.
const denied = new Set<string>();

function deniedKey(domain: SyncDomain, chunk: string): string {
  return JSON.stringify([keyFor('syncOutbox'), domain, chunk]);
}

/** Record a refusal and say so ONCE per chunk, then let the badge re-read via the same change
 * event every slot write already dispatches. */
function markDenied(domain: SyncDomain, chunk: string): void {
  const key = deniedKey(domain, chunk);
  if (denied.has(key)) return;
  denied.add(key);
  console.warn(
    `[outbox] ${domain}/${chunk} was refused by the rules — not retrying it this page load`,
  );
  notifyChanged();
}

/**
 * #267 — how many CURRENTLY-DIRTY chunks the rules refused this page load. Session state rather
 * than slot state, which is why it is its own read instead of a field on `outboxSnapshot()`.
 *
 * Intersected with the live dirty map on purpose: a trip switch or a `wipeTripData` clears the
 * slot but not this in-memory set, and a count for chunks that no longer exist would be a badge
 * that cannot be cleared. Same `enabled()` gate as every other entry point; never throws.
 */
export function outboxBlocked(): number {
  if (!enabled() || denied.size === 0) return 0;
  const { dirty } = loadSlot();
  let n = 0;
  for (const domain of Object.keys(dirty) as SyncDomain[]) {
    for (const chunk of dirty[domain] ?? []) {
      if (denied.has(deniedKey(domain, chunk))) n += 1;
    }
  }
  return n;
}

/** Write-ahead: union the chunks into the domain's dirty set (synchronous localStorage write,
 * BEFORE any network). Re-enqueueing an already-dirty chunk is a set no-op. Preserves whatever
 * `lastAckAt` was already on disk — enqueuing new dirty work doesn't erase the last-synced
 * signal, it just adds to what's still pending.
 *
 * #237: the read below is deliberately the LAST thing this function does before `saveSlot` —
 * it must load fresh, right here, and the merge must happen against THAT value, never against
 * a slot handed in or read earlier. That keeps the base object (every OTHER domain's dirty
 * array, which this call writes back unchanged) as current as this synchronous call can make
 * it, so a concurrent tab's enqueue/ack for a DIFFERENT chunk landed before this read is
 * preserved rather than clobbered. It narrows, not closes: two tabs are separate OS threads,
 * so a write from tab B landing in the gap between this read and `saveSlot`'s actual write can
 * still be lost. Closing that needs a real cross-tab lock (Web Locks API), which is out of
 * scope here. */
function enqueue(domain: SyncDomain, chunks: string[]): void {
  if (chunks.length === 0) return;
  const fresh = loadSlot();
  const set = new Set(fresh.dirty[domain] ?? []);
  for (const c of chunks) set.add(c);
  fresh.dirty[domain] = [...set];
  saveSlot(fresh.dirty, fresh.lastAckAt);
}

/** Ack: remove one confirmed chunk from the domain's dirty set, and stamp the single app-wide
 * `lastAckAt` to now — every real ack is progress worth surfacing, regardless of domain.
 *
 * #237: same fresh-read-immediately-before-write-back shape as `enqueue`, and the same
 * narrows-but-does-not-close caveat — see its comment. */
function ack(domain: SyncDomain, chunk: string): void {
  const fresh = loadSlot();
  const arr = fresh.dirty[domain];
  if (!arr) return;
  fresh.dirty[domain] = arr.filter((c) => c !== chunk);
  saveSlot(fresh.dirty, new Date().toISOString());
}

// ── #124: at most ONE push in flight per (domain, chunk). ────────────────────────────────────
// THE BUG IT FIXES: `withOutbox` runs on every commit, so two rapid edits to the same chunk used
// to start two independent transaction+ack pairs. `enqueue` is a set no-op the second time (the
// chunk is already dirty), so that dirty flag was the ONLY retry record for BOTH edits — and the
// older push resolving acked it away while the newer one was still in flight. If the newer then
// failed, or the tab closed before it settled, the newer edit was never retried. The rule this
// restores: an ack may only clear a chunk when no NEWER push for that chunk is outstanding.
//
// STILL STATE-BASED — no op queue, no sequence number. A superseded attempt is DROPPED and the
// newest local state re-pushed through the same single-chunk merged write the flush path uses;
// coalescing keystroke-speed edits into one trailing push is the dirty set's set-no-op property
// expressed in time rather than in the slot.
//
// KNOWN CEILING: module-scope ⇒ per-TAB, exactly like the `inFlight` flush flag below. Two tabs
// editing the SAME chunk inside one push window can still race an ack against the other's
// in-flight edit. Upgrade path if that ever matters: an in-flight lease written into the slot (or
// a BroadcastChannel), which buys a cross-tab protocol and a lease-expiry problem; the per-tab
// guard covers the real timeline this fixes — one tab, two edits a keystroke apart.
interface ChunkRun {
  /** Newest state to push for this chunk; overwritten by every joiner. */
  latest: unknown;
  /** Set by a joiner ⇒ the attempt currently in flight is stale and must NOT ack. */
  superseded: boolean;
  promise: Promise<void>;
}
const running = new Map<string, ChunkRun>();

function pushChunkOnce<T>(cs: ChunkSync<T>, chunk: string, current: T): Promise<void> {
  // #267: refused this page load ⇒ do not attempt it again. The guard sits HERE and not in
  // `flushOutbox` because this is the one choke point BOTH the commit path and the flush path
  // route through — one check covers every caller, present and future. The write-ahead enqueue has
  // already run by now, so the chunk stays dirty and stays protected against the first-snapshot
  // apply; it just stops burning a refused write on every flush trigger.
  // `denied.size` first so the ordinary path — nothing refused, ever, on most devices — does not
  // pay `deniedKey`'s gateway read on every single push.
  if (denied.size > 0 && denied.has(deniedKey(cs.domain, chunk))) return Promise.resolve();
  const key = `${cs.domain}\u0000${chunk}`; // NUL: chunk keys are dates / leg ids, never contain it
  const live = running.get(key);
  if (live) {
    // Hand the running loop the newer state and join it, instead of opening a second transaction.
    live.latest = current;
    live.superseded = true;
    return live.promise;
  }
  const run: ChunkRun = { latest: current, superseded: false, promise: Promise.resolve() };
  running.set(key, run);
  // The IIFE runs synchronously up to its first `await`, so `run.promise` is assigned before any
  // other job can observe the entry — a joiner never sees the placeholder.
  run.promise = (async () => {
    try {
      for (;;) {
        run.superseded = false;
        try {
          await cs.pushChunk(chunk, run.latest as T); // ② attempt
        } catch (err) {
          // ④ rejection swallowed — the write-ahead record persists, so the chunk retries on the
          // next flush trigger (and across a reload). NEVER rethrow to the commit caller.
          //
          // #267: but CLASSIFY it first. A rules refusal is not a transient failure, and retrying
          // it is not resilience — it is an unkillable write loop behind a badge that says
          // "pending" forever. Recording it keeps the never-throw contract exactly as it was: this
          // still swallows and still returns, it just stops pretending the next attempt is worth
          // making. `markDenied` is total (a Set add, a warn, a same-tab event) so it cannot turn
          // this catch into a throw.
          if (isPermissionDenied(err)) markDenied(cs.domain, chunk);
          return;
        }
        // ③ ack-on-resolve, but ONLY for the attempt that carried the newest state. Both the
        // supersede and this check are synchronous continuations (single-threaded JS), so there is
        // no window where a joiner's edit is lost between the resolve and the ack.
        if (!run.superseded) {
          // Guarded because this sits OUTSIDE the attempt's own try: `ack` writes localStorage, and
          // a throw here would reject `run.promise` — i.e. reject into the commit tail for the owner
          // AND every joiner, breaking this module's never-throws contract. A failed ack just leaves
          // the chunk dirty, which the next flush retries (idempotent merged write).
          try {
            ack(cs.domain, chunk);
          } catch {
            /* ignore — the chunk stays dirty and retries; never throw at the commit caller */
          }
          return;
        }
        // A newer edit landed mid-flight: loop and push it. Bounded by the edit rate, not
        // unbounded — each turn awaits one real network write and pushes only the latest state.
      }
    } finally {
      // Runs in the same job as the `return` above, so a run that has decided to finish can never
      // be joined: a later commit starts a fresh run and re-acks on its own resolve.
      running.delete(key);
    }
  })();
  return run.promise;
}

/** Attempt each chunk from `current`; ack on resolve, swallow on reject (chunk stays dirty). The
 * ack read-modify-write is fully synchronous, so concurrent acks under one flush never interleave
 * destructively (single-threaded JS). Same-chunk attempts are serialized by `pushChunkOnce`. */
async function pushChunks<T>(cs: ChunkSync<T>, current: T, chunks: string[]): Promise<void> {
  await Promise.all(chunks.map((chunk) => pushChunkOnce(cs, chunk, current)));
}

/**
 * Decorate a domain's push with the outbox. Returned as a `SyncPort['push']`,
 * so it drops straight into the reactive-store factory's `sync?` seam. Push path:
 * ① write-ahead enqueue `chunkDiff(prev,next)` (sync, before any network),
 * ② attempt `pushChunk` for each of THIS diff's chunks from `next` (the just-committed state),
 * ③ ack each on resolve, ④ swallow rejections (the chunk stays dirty for the next flush).
 * Dormant/guest ⇒ no-op, no slot write. Never throws. A commit for a chunk whose push is still in
 * flight does NOT open a second transaction (#124) — it supersedes the running one, which re-pushes
 * the newer state and acks only that. So on the RESOLVE path this settles once the newest edit has
 * been attempted; on a REJECT the run returns without attempting a newer state that landed
 * mid-flight, which is fine — the chunk stays dirty and the next flush pushes the netted state.
 *
 * Takes NO StoragePort: the push path only ever writes `next`, the state the caller just
 * committed. `flushOutbox` is the one that needs `storage.load()`, because it runs later and must
 * re-read the freshest local state.
 */
export function withOutbox<T>(cs: ChunkSync<T>): SyncPort<T>['push'] {
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
 *
 * The commit path deliberately does NOT take this domain flag — a commit while a flush runs must
 * still push, and it can: it lands in `pushChunkOnce`, which either starts its own run for an
 * untouched chunk or supersedes the flush's run for the same chunk (that run then also carries the
 * commit's newer state, so the flush's await simply covers one more attempt). Nothing here waits on
 * the domain flag, so neither path can deadlock or starve the other.
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
