// @vitest-environment jsdom
//
// S141 — the offline push outbox mechanics (core/sync/outbox.ts, D-150, FU-19). Exercised at the
// UNIT level with a MOCKED pushChunk + a real gateway-backed localStorage slot (jsdom). This is
// the deterministic proof the two-client live scenario (JDK/emulator-gated; the manual
// procedure lives in docs/two-phone-sync-check.md)
// cannot run here: it proves the write-ahead-enqueue / ack-on-resolve / reject-stays-dirty /
// flush-retry / exactly-once / dormant-guest-no-write mechanics, and the RELOAD scenario (an
// offline push persists the dirty slot → a later flush pushes each chunk once → slot cleared).
//
// D-150 (state-based, no op-log), D-038 (dormant never writes the slot), D-055 (guest never
// queues) are cited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StoragePort } from '@/core/ports';

// Controllable gates: the outbox reads isRemoteConfigured() + getActiveTraveler() through these.
const gate = vi.hoisted(() => ({
  remoteOn: true,
  traveler: { name: 'Powan', token: 'Powan', accent: '#000' } as { name: string } | null,
}));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => gate.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => gate.traveler };
});

import type { ChunkSync } from '@/core/sync/outbox';
import { STORAGE_KEYS } from '@/core/storage/gateway';

// The outbox keeps per-tab state at MODULE scope (`running`, `inFlight`). A test that leaves a
// push unsettled would leak an entry into the next test, which would then silently JOIN the stale
// run instead of starting its own. Statically importing the module would make `vi.resetModules()`
// a no-op, so bind the exports late and re-import per test — same names, no production-only reset
// export, and each test gets a genuinely fresh module.
type OutboxModule = typeof import('@/core/sync/outbox');
let withOutbox: OutboxModule['withOutbox'];
let flushOutbox: OutboxModule['flushOutbox'];
let outboxDirty: OutboxModule['outboxDirty'];
let outboxSnapshot: OutboxModule['outboxSnapshot'];
let outboxBlocked: OutboxModule['outboxBlocked'];
let SYNC_OUTBOX_CHANGED_EVENT: OutboxModule['SYNC_OUTBOX_CHANGED_EVENT'];

// ── A tiny controllable domain. T = Record<chunk, version>. `chunkDiff` = keys whose version
//    changed prev→next. `pushChunk` records every attempt and resolves/rejects per `failing`. ──
type State = Record<string, number>;

function makeStorage(initial: State): StoragePort<State> & { value: State } {
  const box = { value: { ...initial } };
  return {
    value: box.value,
    load: () => box.value,
    save: (v: State) => {
      box.value = v;
    },
    has: () => true,
  };
}

interface Harness {
  cs: ChunkSync<State>;
  attempts: Array<{ chunk: string; version: number | undefined }>;
  failing: Set<string>; // chunks whose pushChunk currently REJECTS (transport-shaped)
  /** #267 — chunks whose pushChunk rejects the way the RULES do: `code: 'permission-denied'`. */
  refusing: Set<string>;
}

function makeHarness(): Harness {
  const attempts: Harness['attempts'] = [];
  const failing = new Set<string>();
  const refusing = new Set<string>();
  const cs: ChunkSync<State> = {
    domain: 'itinerary',
    chunkDiff(prev, next) {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      return [...keys].filter((k) => prev[k] !== next[k]);
    },
    async pushChunk(chunk, current) {
      attempts.push({ chunk, version: current[chunk] });
      if (refusing.has(chunk)) {
        // The exact shape Firestore rejects a rules refusal with — a plain Error carrying `code`,
        // which is what `isPermissionDenied` reads and nothing else.
        throw Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied',
        });
      }
      if (failing.has(chunk)) throw new Error(`push failed for ${chunk}`);
    },
  };
  return { cs, attempts, failing, refusing };
}

function rawSlot(): unknown {
  const blob = localStorage.getItem(STORAGE_KEYS.syncOutbox);
  return blob === null ? null : JSON.parse(blob);
}

beforeEach(async () => {
  vi.resetModules();
  ({
    withOutbox,
    flushOutbox,
    outboxDirty,
    outboxSnapshot,
    outboxBlocked,
    SYNC_OUTBOX_CHANGED_EVENT,
  } = await import('@/core/sync/outbox'));
  localStorage.clear();
  gate.remoteOn = true;
  gate.traveler = { name: 'Powan' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('outbox mechanics (mocked pushChunk)', () => {
  it('enqueue on push, then ack-on-resolve CLEARS the chunk (clean push prunes dirty to {}, stamps lastAckAt — S229)', async () => {
    const h = makeHarness();
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // d1 changed undefined→1

    expect(h.attempts).toEqual([{ chunk: 'd1', version: 1 }]); // pushed once
    expect(outboxDirty('itinerary')).toEqual([]); // acked → not dirty
    // S229: a real ack now stamps lastAckAt, so the key persists (dirty pruned to {}) instead of
    // being removed outright — the sync-status badge's "synced Xm ago" state survives a reload.
    const slot = rawSlot() as { version: 1; dirty: object; lastAckAt: string };
    expect(slot.version).toBe(1);
    expect(slot.dirty).toEqual({});
    expect(typeof slot.lastAckAt).toBe('string');
    expect(Number.isNaN(new Date(slot.lastAckAt).getTime())).toBe(false);
  });

  it('a REJECTING pushChunk leaves the chunk DIRTY (write-ahead record persists)', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 });

    expect(h.attempts).toEqual([{ chunk: 'd1', version: 1 }]); // attempted
    expect(outboxDirty('itinerary')).toEqual(['d1']); // still dirty (reject swallowed)
    expect(rawSlot()).toEqual({ version: 1, dirty: { itinerary: ['d1'] } }); // persisted
  });

  it('flush RETRIES a dirty chunk and acks it once it resolves', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // fails → dirty
    expect(outboxDirty('itinerary')).toEqual(['d1']);

    h.failing.delete('d1'); // "reconnect"
    await flushOutbox(h.cs, storage); // retries with storage.load()

    expect(h.attempts).toEqual([
      { chunk: 'd1', version: 1 }, // the failed push
      { chunk: 'd1', version: 1 }, // the retry from freshest local state
    ]);
    expect(outboxDirty('itinerary')).toEqual([]); // acked
    // S229: the retry's ack stamps lastAckAt, so the slot key persists holding {dirty:{}, lastAckAt}.
    const slot = rawSlot() as { dirty: object; lastAckAt: string };
    expect(slot.dirty).toEqual({});
    expect(typeof slot.lastAckAt).toBe('string');
  });

  it('EXACTLY-ONCE: once acked, further flushes issue NO new push (ack ends retries)', async () => {
    const h = makeHarness();
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // pushes + acks
    await flushOutbox(h.cs, storage); // nothing dirty → no push
    await flushOutbox(h.cs, storage); // idem

    expect(h.attempts).toEqual([{ chunk: 'd1', version: 1 }]); // exactly one attempt total
  });

  it('a still-failing chunk is retried by EACH flush but NEVER double-pushed after it resolves', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // attempt 1 (fail)
    await flushOutbox(h.cs, storage); // attempt 2 (fail — still offline)
    expect(h.attempts).toHaveLength(2);
    expect(outboxDirty('itinerary')).toEqual(['d1']);

    h.failing.delete('d1');
    await flushOutbox(h.cs, storage); // attempt 3 (resolves → ack)
    await flushOutbox(h.cs, storage); // no attempt (clean)
    expect(h.attempts).toHaveLength(3);
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('re-enqueueing an already-dirty chunk is a set no-op (no duplicate in the dirty set)', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // dirty [d1]
    await push({ d1: 1 }, { d1: 2 }); // d1 changed again → still just [d1]

    expect(outboxDirty('itinerary')).toEqual(['d1']);
  });

  it('multi-chunk push: a resolving chunk acks while a rejecting one stays dirty', async () => {
    const h = makeHarness();
    h.failing.add('d2');
    const push = withOutbox(h.cs);

    await push({}, { d1: 1, d2: 1 });

    expect(outboxDirty('itinerary').sort()).toEqual(['d2']); // d1 acked, d2 dirty
  });

  it('#124: an earlier push resolving does NOT clear a NEWER in-flight edit (and that edit still retries)', async () => {
    const h = makeHarness();
    const storage = makeStorage({ d1: 2 }); // localStorage holds the netted state (edit 2)
    const push = withOutbox(h.cs);

    // Each attempt parks on its own gate, so the ticket's timeline is driven exactly: P1 resolves
    // while P2 is still outstanding.
    const gates: Array<(ok: boolean) => void> = [];
    h.cs.pushChunk = (chunk, current) => {
      h.attempts.push({ chunk, version: current[chunk] });
      return new Promise<void>((resolve, reject) => {
        gates.push((ok) => (ok ? resolve() : reject(new Error(`push failed for ${chunk}`))));
      });
    };
    const settle = () => new Promise<void>((r) => setTimeout(r, 0));

    const e1 = push({}, { d1: 1 }); // edit 1 → enqueue d1, P1 in flight
    await settle();
    expect(h.attempts).toEqual([{ chunk: 'd1', version: 1 }]);

    const e2 = push({ d1: 1 }, { d1: 2 }); // edit 2 lands BEFORE P1 settles (enqueue is a set no-op)
    await settle();

    gates[0](true); // P1 RESOLVES FIRST — must NOT ack, edit 2 is newer and unconfirmed
    await settle();
    expect(outboxDirty('itinerary')).toEqual(['d1']); // the retry record survives a tab close here
    expect(h.attempts).toEqual([
      { chunk: 'd1', version: 1 },
      { chunk: 'd1', version: 2 }, // the newer state is pushed promptly, not parked until a flush
    ]);

    gates[1](false); // P2 FAILS
    await Promise.all([e1, e2]);
    expect(outboxDirty('itinerary')).toEqual(['d1']); // still dirty ⇒ edit 2 is not lost

    // Next load / reconnect retries it from the freshest local state.
    h.cs.pushChunk = async (chunk, current) => {
      h.attempts.push({ chunk, version: current[chunk] });
    };
    await flushOutbox(h.cs, storage);
    expect(h.attempts).toHaveLength(3);
    expect(h.attempts[2]).toEqual({ chunk: 'd1', version: 2 });
    expect(outboxDirty('itinerary')).toEqual([]); // acked at last
  });

  it('concurrent same-domain flush is guarded (the second call is a no-op while one is in flight)', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);
    await push({}, { d1: 1 }); // dirty

    h.failing.delete('d1');
    h.attempts.length = 0; // ignore the failed offline attempt; count only the flush race
    // Make pushChunk slow so both flushes overlap.
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    h.cs.pushChunk = async (chunk, current) => {
      h.attempts.push({ chunk, version: current[chunk] });
      await barrier;
    };

    const f1 = flushOutbox(h.cs, storage);
    const f2 = flushOutbox(h.cs, storage); // in-flight guard → no-op
    release();
    await Promise.all([f1, f2]);

    expect(h.attempts).toHaveLength(1); // only the first flush attempted
    expect(outboxDirty('itinerary')).toEqual([]);
  });
});

describe('RELOAD scenario — the FU-19 fix (offline edit survives + pushes once)', () => {
  it('offline push persists the dirty slot → simulated reload → flush pushes each chunk once → slot cleared', async () => {
    // OFFLINE session: two edits are committed while the network is down (pushChunk rejects).
    const h = makeHarness();
    h.failing.add('2026-12-09');
    h.failing.add('2026-12-10');
    const push = withOutbox(h.cs);

    await push({}, { '2026-12-09': 1 }); // edit day 09 (offline → dirty)
    await push({ '2026-12-09': 1 }, { '2026-12-09': 1, '2026-12-10': 1 }); // edit day 10 (offline → dirty)

    // The offline edits are NOT lost: the dirty slot is on disk (survives reload by construction).
    expect(rawSlot()).toEqual({
      version: 1,
      dirty: { itinerary: ['2026-12-09', '2026-12-10'] },
    });

    // ── SIMULATED RELOAD ──────────────────────────────────────────────────────────────────────
    // A fresh page load: brand-new harness + storage + decorated push, but the SAME localStorage
    // (the outbox slot is exactly what survives the reload). The network is back (no failing).
    const h2 = makeHarness();
    const storage2 = makeStorage({ '2026-12-09': 1, '2026-12-10': 1 }); // localStorage rehydrated the edits
    // The reload's flush trigger (app-start / online) drains the dirty set.
    await flushOutbox(h2.cs, storage2);

    // Each dirty chunk pushed EXACTLY ONCE, from the freshest local state.
    expect(h2.attempts.map((a) => a.chunk).sort()).toEqual(['2026-12-09', '2026-12-10']);
    expect(h2.attempts).toHaveLength(2);
    // Dirty set cleared → the edits are confirmed, exactly once. S229: the ack stamps lastAckAt,
    // so the slot key persists (dirty pruned to {}) rather than being removed outright.
    expect(outboxDirty('itinerary')).toEqual([]);
    const slot = rawSlot() as { dirty: object; lastAckAt: string };
    expect(slot.dirty).toEqual({});
    expect(typeof slot.lastAckAt).toBe('string');
  });
});

describe('DORMANT / GUEST — the slot is NEVER written (D-038 / D-055)', () => {
  it('DORMANT (not configured): push writes NO outbox slot', async () => {
    gate.remoteOn = false;
    const h = makeHarness();
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 });

    expect(h.attempts).toEqual([]); // never even attempted
    expect(localStorage.getItem(STORAGE_KEYS.syncOutbox)).toBeNull(); // ZERO slot bytes
    await flushOutbox(h.cs, storage); // flush also no-ops
    expect(localStorage.getItem(STORAGE_KEYS.syncOutbox)).toBeNull();
  });

  it('GUEST (configured but no active traveler): push writes NO outbox slot', async () => {
    gate.traveler = null;
    const h = makeHarness();
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 });

    expect(h.attempts).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.syncOutbox)).toBeNull();
  });

  it('a traveler who signs OUT with a dirty outbox keeps the entries; flush resumes on sign-in', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);
    await push({}, { d1: 1 }); // dirty while signed in
    expect(outboxDirty('itinerary')).toEqual(['d1']);

    gate.traveler = null; // sign out
    h.failing.delete('d1');
    await flushOutbox(h.cs, storage); // gated off → no drain
    expect(outboxDirty('itinerary')).toEqual(['d1']); // entries kept

    gate.traveler = { name: 'Powan' }; // sign back in
    await flushOutbox(h.cs, storage); // resumes
    expect(outboxDirty('itinerary')).toEqual([]);
  });
});

describe('S229 — lastAckAt + outboxSnapshot() + the same-tab change event', () => {
  it('a fresh (never-written) slot has NO lastAckAt — outboxSnapshot reads it as null, never throws', () => {
    expect(rawSlot()).toBeNull();
    expect(outboxSnapshot()).toEqual({ dirty: {}, lastAckAt: null });
  });

  it('an OLD pre-S229 slot (no lastAckAt field at all) loads fine — undefined reads as "no ack yet"', async () => {
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['d1'] } }), // legacy shape, no lastAckAt key
    );
    expect(outboxSnapshot()).toEqual({ dirty: { itinerary: ['d1'] }, lastAckAt: null });
    expect(outboxDirty('itinerary')).toEqual(['d1']); // unaffected by the new field's absence
  });

  it('outboxSnapshot() is GATED exactly like every other entry point (D-038/D-055): dormant/guest reads the neutral shape even with real bytes on disk', async () => {
    // Write a real dirty+acked slot while enabled…
    const h = makeHarness();
    await withOutbox(h.cs)({}, { d1: 1 }); // acks → lastAckAt set
    expect(outboxSnapshot().lastAckAt).not.toBeNull();

    // …then go dormant: outboxSnapshot must NOT surface the on-disk bytes.
    gate.remoteOn = false;
    expect(outboxSnapshot()).toEqual({ dirty: {}, lastAckAt: null });

    // …and guest, same result.
    gate.remoteOn = true;
    gate.traveler = null;
    expect(outboxSnapshot()).toEqual({ dirty: {}, lastAckAt: null });
  });

  it('lastAckAt is stamped on ack and SURVIVES a later enqueue (not clobbered by write-ahead)', async () => {
    const h = makeHarness();
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // acks d1 → lastAckAt set
    const firstAck = outboxSnapshot().lastAckAt;
    expect(firstAck).not.toBeNull();

    h.failing.add('d2');
    await push({ d1: 1 }, { d1: 1, d2: 1 }); // d2 enqueues and FAILS — no new ack
    const snap = outboxSnapshot();
    expect(snap.dirty).toEqual({ itinerary: ['d2'] });
    expect(snap.lastAckAt).toBe(firstAck); // untouched by the failed enqueue
  });

  it('saveSlot dispatches SYNC_OUTBOX_CHANGED_EVENT on the window on every write (enqueue AND ack)', async () => {
    const seen: string[] = [];
    const onEvt = () => seen.push('changed');
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, onEvt);

    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // ① enqueue write (fails, no ack)
    expect(seen).toEqual(['changed']);

    h.failing.delete('d1');
    await flushOutbox(h.cs, storage); // ② ack write
    expect(seen).toEqual(['changed', 'changed']);

    window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, onEvt);
  });
});

// ── #267 — a REFUSED write is classified before it is swallowed ──────────────────────────────
// The bug: `permission-denied` (not in the trip's `members` map, or over firestore.rules' write-
// shape bound) was indistinguishable from a network error, so the chunk was re-pushed on every
// flush trigger for the rest of the session behind a badge stuck on "pending".
describe('#267 — a rules refusal is permanent, a transport failure is not', () => {
  const warnings: string[] = [];
  beforeEach(() => {
    warnings.length = 0;
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(String(args[0]));
    });
  });

  it('a REFUSED chunk is attempted exactly once, no matter how many flushes fire', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 }); // attempt 1 — refused
    await flushOutbox(h.cs, storage); // online
    await flushOutbox(h.cs, storage); // tab visible
    await flushOutbox(h.cs, storage); // app start

    expect(h.attempts.map((a) => a.chunk)).toEqual(['d1']); // ← the whole bug, in one assertion
  });

  it('a TRANSPORT failure still retries on every flush — the classification is what differs', async () => {
    const h = makeHarness();
    h.failing.add('d1');
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 });
    await flushOutbox(h.cs, storage);
    await flushOutbox(h.cs, storage);

    expect(h.attempts.map((a) => a.chunk)).toEqual(['d1', 'd1', 'd1']);
    expect(outboxBlocked()).toBe(0); // never classified as permanent
  });

  it('a refused chunk stays DIRTY and is never acked — the local edit keeps its first-snapshot protection', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    const push = withOutbox(h.cs);

    await push({}, { d1: 1 });

    // Dropping it from `dirty` would be the tempting "stop retrying" fix and it would be data
    // loss: `outboxDirty()` is what makes subscribeRemote MERGE this date instead of applying
    // remote authoritatively over it (D-150).
    expect(outboxDirty('itinerary')).toEqual(['d1']);
    expect(outboxSnapshot().lastAckAt).toBeNull();
  });

  it('becomes VISIBLE: outboxBlocked() counts it, and the same-tab change event fires so the badge re-reads', async () => {
    const seen: string[] = [];
    const onEvt = () => seen.push('changed');
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, onEvt);

    const h = makeHarness();
    h.refusing.add('d1');
    const push = withOutbox(h.cs);

    expect(outboxBlocked()).toBe(0);
    await push({}, { d1: 1 });

    expect(outboxBlocked()).toBe(1);
    expect(seen).toEqual(['changed', 'changed']); // ① the enqueue write, ② the refusal
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('itinerary/d1');

    window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, onEvt);
  });

  it('warns ONCE per chunk, not once per attempt', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    h.refusing.add('d2');
    const storage = makeStorage({ d1: 1, d2: 1 });
    const push = withOutbox(h.cs);

    await push({}, { d1: 1, d2: 1 });
    await flushOutbox(h.cs, storage);
    await flushOutbox(h.cs, storage);

    expect(warnings).toHaveLength(2); // one per refused chunk, not one per attempt
    expect(outboxBlocked()).toBe(2);
  });

  it('the refusal is per-CHUNK — a healthy sibling in the same domain still pushes and still acks', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    const push = withOutbox(h.cs);

    await push({}, { d1: 1, d2: 1 });

    expect(outboxDirty('itinerary')).toEqual(['d1']); // d2 acked, d1 refused and still queued
    expect(outboxBlocked()).toBe(1);
    expect(outboxSnapshot().lastAckAt).toEqual(expect.any(String)); // d2's ack still landed
  });

  it('outboxBlocked() is GATED like every other entry point, and intersects the LIVE dirty map', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    await withOutbox(h.cs)({}, { d1: 1 });
    expect(outboxBlocked()).toBe(1);

    gate.traveler = null; // guest (D-055)
    expect(outboxBlocked()).toBe(0);
    gate.traveler = { name: 'Powan' };

    gate.remoteOn = false; // dormant (D-038)
    expect(outboxBlocked()).toBe(0);
    gate.remoteOn = true;

    // The refusal set is in-memory and survives a slot wipe (a trip switch that did not reload);
    // the count must not, or the badge reports a chunk that no longer exists and can never clear.
    localStorage.removeItem(STORAGE_KEYS.syncOutbox);
    expect(outboxBlocked()).toBe(0);
  });

  it('resets on RELOAD — a fresh module (a new page load) retries, so membership granted meanwhile lands', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    const storage = makeStorage({ d1: 1 });
    await withOutbox(h.cs)({}, { d1: 1 });
    expect(h.attempts).toHaveLength(1);

    // Reload: the slot persists (still dirty), the in-memory refusal set does not.
    vi.resetModules();
    ({ withOutbox, flushOutbox, outboxDirty, outboxSnapshot, outboxBlocked, SYNC_OUTBOX_CHANGED_EVENT } =
      await import('@/core/sync/outbox'));
    expect(outboxDirty('itinerary')).toEqual(['d1']);
    expect(outboxBlocked()).toBe(0);

    h.refusing.delete('d1'); // this device was added to the trip while the tab was closed
    await flushOutbox(h.cs, storage);

    expect(h.attempts).toHaveLength(2);
    expect(outboxDirty('itinerary')).toEqual([]); // acked at last
  });

  it('never throws at the commit caller — the swallow contract is unchanged by the classification', async () => {
    const h = makeHarness();
    h.refusing.add('d1');
    const push = withOutbox(h.cs);
    await expect(push({}, { d1: 1 })).resolves.toBeUndefined();
    await expect(push({ d1: 1 }, { d1: 2 })).resolves.toBeUndefined(); // and again once denied
  });
});
