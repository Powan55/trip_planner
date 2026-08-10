import { describe, it, expect } from 'vitest';
import {
  mergeDay,
  mergeDays,
  gcTombstones,
  DEFAULT_GC_HORIZON_MS,
  type MergePolicy,
} from '@/core/sync/merge-day';
import { serialize, type Hlc } from '@/core/sync/hlc';
import {
  stampSyncCreated,
  stampSyncUpdated,
  stampSyncDeleted,
} from '@/core/sync/stamp';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * Sync v2 — per-day merge unit suite (S96; D-106 LOCKED).
 *
 * Proves all 11 scenarios of the PURE per-day item-level merge, incl. the
 * commutativity+idempotence property test (the convergence proof) and the clock-skew
 * scenario feeding REAL HLC values from the HLC module. Also covers the pure stamping helper
 * (`core/sync/stamp.ts`). No clock, no firebase, no window — deterministic throughout.
 */

const DATE = '2026-12-12';

/** Build a DayPlan for the shared test date around a set of items. */
function day(items: ItineraryItem[], date: string = DATE): DayPlan {
  return { date, city: 'Kathmandu', country: 'nepal', items };
}

/** Build an item with an explicit HLC (pt/ct/actor) so ordering is unambiguous in tests. */
function item(
  id: string,
  hlc: Hlc,
  extra: Partial<ItineraryItem> = {},
): ItineraryItem {
  return {
    id,
    title: `title-${id}`,
    category: 'sightseeing',
    rev: 1,
    hlc: serialize(hlc),
    deleted: false,
    ...extra,
  };
}

const H = (pt: number, ct: number, actor: string): Hlc => ({ pt, ct, actor });

// mulberry32 PRNG for the reproducible property test.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compare two days by their (id → winning item) map, ignoring array order. */
function itemMap(d: DayPlan): Map<string, ItineraryItem> {
  return new Map(d.items.map((it) => [it.id, it]));
}

describe('mergeDay — case 1: different items, same day → BOTH survive (the headline fix)', () => {
  it('local edits item A, remote edits item B on the same day → merged day has both', () => {
    const local = day([item('A', H(100, 0, 'uidL'))]);
    const remote = day([item('B', H(200, 0, 'uidR'))]);
    const merged = mergeDay(local, remote);
    const ids = merged.items.map((i) => i.id).sort();
    expect(ids).toEqual(['A', 'B']);
  });
});

describe('mergeDay — case 2: same item, two edits → higher-HLC wins, deterministic across arg order', () => {
  it('remote has the higher HLC → remote wins; loser fully replaced', () => {
    const local = day([item('A', H(100, 0, 'uidL'), { title: 'old' })]);
    const remote = day([item('A', H(300, 0, 'uidR'), { title: 'new' })]);
    const merged = mergeDay(local, remote);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe('new');
    expect(merged.items[0].hlc).toBe(serialize(H(300, 0, 'uidR')));
  });

  it('winner is identical regardless of argument order (commutative on a single collision)', () => {
    const a = day([item('A', H(100, 0, 'uidL'), { title: 'L' })]);
    const b = day([item('A', H(300, 0, 'uidR'), { title: 'R' })]);
    expect(mergeDay(a, b).items[0].title).toBe('R');
    expect(mergeDay(b, a).items[0].title).toBe('R');
  });

  it('equal pt+ct → the higher ACTOR string wins (final deterministic tie-break)', () => {
    const a = day([item('A', H(100, 0, 'uidA'), { title: 'fromA' })]);
    const b = day([item('A', H(100, 0, 'uidB'), { title: 'fromB' })]);
    expect(mergeDay(a, b).items[0].title).toBe('fromB'); // 'uidB' > 'uidA'
    expect(mergeDay(b, a).items[0].title).toBe('fromB');
  });
});

describe('mergeDay — case 3: delete vs edit (BOTH policies)', () => {
  it("policy 'hlc' (default): a STRICTLY-LATER edit resurrects the deleted item", () => {
    const deleted = day([item('A', H(100, 0, 'uidL'), { deleted: true })]);
    const laterEdit = day([item('A', H(200, 0, 'uidR'), { deleted: false, title: 'restored' })]);
    const merged = mergeDay(deleted, laterEdit); // default policy 'hlc'
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].deleted).toBe(false);
    expect(merged.items[0].title).toBe('restored');
  });

  it("policy 'hlc': an OLDER edit does NOT resurrect (tombstone's higher HLC keeps it deleted)", () => {
    const deleted = day([item('A', H(300, 0, 'uidL'), { deleted: true })]);
    const olderEdit = day([item('A', H(100, 0, 'uidR'), { deleted: false, title: 'stale' })]);
    const merged = mergeDay(deleted, olderEdit);
    expect(merged.items[0].deleted).toBe(true); // stays deleted
  });

  it("policy 'hlc': an EQUAL-HLC edit does NOT resurrect (tie biases the tombstone)", () => {
    const deleted = day([item('A', H(100, 0, 'uidX'), { deleted: true })]);
    const equalEdit = day([item('A', H(100, 0, 'uidX'), { deleted: false, title: 'tie' })]);
    expect(mergeDay(deleted, equalEdit).items[0].deleted).toBe(true);
  });

  it("policy 'always': ANY tombstone beats ANY concurrent edit regardless of HLC", () => {
    const policy: MergePolicy = { deleteWins: 'always' };
    const deleted = day([item('A', H(100, 0, 'uidL'), { deleted: true })]);
    const laterEdit = day([item('A', H(999, 0, 'uidR'), { deleted: false, title: 'would-restore' })]);
    // Even though the edit has the strictly-higher HLC, 'always' keeps it deleted.
    expect(mergeDay(deleted, laterEdit, policy).items[0].deleted).toBe(true);
    expect(mergeDay(laterEdit, deleted, policy).items[0].deleted).toBe(true); // symmetric
  });
});

describe('mergeDay — case 4: delete vs delete → converges to ONE tombstone', () => {
  it('two tombstones for the same id converge to the higher-HLC tombstone (both args orders)', () => {
    const a = day([item('A', H(100, 0, 'uidL'), { deleted: true, title: 'delL' })]);
    const b = day([item('A', H(200, 0, 'uidR'), { deleted: true, title: 'delR' })]);
    const ab = mergeDay(a, b);
    const ba = mergeDay(b, a);
    expect(ab.items).toHaveLength(1);
    expect(ab.items[0].deleted).toBe(true);
    expect(ab.items[0].hlc).toBe(serialize(H(200, 0, 'uidR'))); // higher wins
    expect(itemMap(ab)).toEqual(itemMap(ba)); // convergent
  });
});

describe('mergeDay — case 5: add on one side only → preserved', () => {
  it('a local-only add (not yet pushed) survives the merge', () => {
    const local = day([item('A', H(100, 0, 'uidL')), item('LOCALONLY', H(150, 0, 'uidL'))]);
    const remote = day([item('A', H(100, 0, 'uidL'))]);
    const merged = mergeDay(local, remote);
    expect(merged.items.map((i) => i.id).sort()).toEqual(['A', 'LOCALONLY']);
  });

  it("a remote-only add (a peer's add) survives the merge", () => {
    const local = day([item('A', H(100, 0, 'uidL'))]);
    const remote = day([item('A', H(100, 0, 'uidL')), item('PEERADD', H(180, 0, 'uidR'))]);
    const merged = mergeDay(local, remote);
    expect(merged.items.map((i) => i.id).sort()).toEqual(['A', 'PEERADD']);
  });
});

describe('mergeDay — case 6: CLOCK SKEW with REAL HLC values → no lost update', () => {
  it('a peer stamp far in the future does not cause the local subsequent edit to be lost', () => {
    // Use the REAL stamping helper to produce genuine HLCs (a requirement of this case).
    const realNow = 1751700000000;
    const farFuture = realNow + 30 * 24 * 60 * 60 * 1000; // peer clock 30d ahead

    // Peer edits item A with a far-future clock.
    const peerItem = stampSyncCreated({ id: 'A', title: 'peer', category: 'food' }, farFuture, 'uidPeer');
    // Local independently edits item A now (behind clock) then, AFTER seeing the peer, edits again.
    const localFirst = stampSyncCreated({ id: 'A', title: 'local-1', category: 'food' }, realNow, 'uidLocal');
    // Local absorbs the peer HLC via a content edit stamped from a clock-aware next stamp.
    // Simulate "edit after receiving peer": stamp from the peer's hlc as the prior, at realNow.
    const localAfterPeer = stampSyncUpdated({ ...localFirst, hlc: peerItem.hlc, title: 'local-2' }, realNow, 'uidLocal');

    // Merge peer vs the local post-peer edit.
    const merged = mergeDay(day([peerItem]), day([localAfterPeer]));
    // The local edit made AFTER absorbing the peer clock must WIN (it is causally later).
    expect(merged.items[0].title).toBe('local-2');
    // And its serialized HLC sorts strictly after the far-future peer stamp — no lost update.
    expect(merged.items[0].hlc! > peerItem.hlc!).toBe(true);
  });
});

describe('mergeDay — case 7: ECHO → merging remote-that-equals-local is value-identical', () => {
  it('merging a day against an identical remote yields the same item set (no-echo belt)', () => {
    const d = day([item('A', H(100, 0, 'uidL')), item('B', H(200, 0, 'uidR'))]);
    const merged = mergeDay(d, d);
    expect(itemMap(merged)).toEqual(itemMap(d)); // value-identical → nothing changed to push
  });
});

describe('mergeDay — case 8: legacy/no-hlc item vs a real edit', () => {
  it('a real post-v2 edit beats a legacy (seeded-HLC) item for the same id', () => {
    // Legacy item: no hlc/rev, only an old updatedAt → seeded to pt=Date.parse, actor="".
    const legacy: ItineraryItem = {
      id: 'A',
      title: 'legacy',
      category: 'food',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const realEdit = item('A', H(Date.parse('2026-06-01T00:00:00.000Z'), 0, 'uidReal'), { title: 'fresh' });
    const merged = mergeDay(day([legacy]), day([realEdit]));
    expect(merged.items[0].title).toBe('fresh'); // real edit (higher pt) wins
  });

  it('two legacy items (both seeded) converge deterministically regardless of arg order', () => {
    const l1: ItineraryItem = { id: 'A', title: 'l1', category: 'food', updatedAt: '2026-01-01T00:00:00.000Z' };
    const l2: ItineraryItem = { id: 'A', title: 'l2', category: 'food', updatedAt: '2026-03-01T00:00:00.000Z' };
    const ab = mergeDay(day([l1]), day([l2]));
    const ba = mergeDay(day([l2]), day([l1]));
    expect(ab.items[0].title).toBe('l2'); // later updatedAt seeds a higher pt
    expect(itemMap(ab)).toEqual(itemMap(ba));
  });
});

describe('mergeDay — case 9: COMMUTATIVITY + IDEMPOTENCE property test (CONVERGENCE PROOF)', () => {
  it('over randomized day pairs: mergeDay(a,b) ≡ mergeDay(b,a) AND merge is idempotent', () => {
    const r = rng(4242);
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const actors = ['uid1', 'uid2', 'uid3'];

    const randItem = (id: string): ItineraryItem =>
      item(id, H(Math.floor(r() * 6), Math.floor(r() * 3), actors[Math.floor(r() * actors.length)]), {
        deleted: r() < 0.25, // ~25% tombstones so delete-vs-edit paths are exercised
        title: `t-${id}-${Math.floor(r() * 1000)}`,
      });

    const randDay = (): DayPlan => {
      const chosen = ids.filter(() => r() < 0.6); // random subset of ids
      return day(chosen.map(randItem));
    };

    let commutativeFailures = 0;
    let idempotenceFailures = 0;

    for (let trial = 0; trial < 500; trial++) {
      const a = randDay();
      const b = randDay();

      // COMMUTATIVITY: merge(a,b) and merge(b,a) agree on the (id → winner) map.
      const ab = mergeDay(a, b);
      const ba = mergeDay(b, a);
      if (JSON.stringify([...itemMap(ab).entries()].sort()) !== JSON.stringify([...itemMap(ba).entries()].sort())) {
        commutativeFailures++;
      }

      // IDEMPOTENCE: merge(a, merge(a,b)) ≡ merge(a,b).
      const again = mergeDay(a, ab);
      if (JSON.stringify([...itemMap(again).entries()].sort()) !== JSON.stringify([...itemMap(ab).entries()].sort())) {
        idempotenceFailures++;
      }
    }

    // THE CONVERGENCE PROOF: zero failures across 500 randomized trials.
    expect(commutativeFailures).toBe(0);
    expect(idempotenceFailures).toBe(0);
  });

  it('ordering is also stable across argument order (arrays are byte-identical, not just set-equal)', () => {
    const a = day([item('B', H(200, 0, 'uid')), item('A', H(100, 0, 'uid'))]);
    const b = day([item('C', H(300, 0, 'uid')), item('A', H(100, 0, 'uid'))]);
    expect(mergeDay(a, b).items.map((i) => i.id)).toEqual(mergeDay(b, a).items.map((i) => i.id));
  });
});

describe('mergeDay — case 10: GC drops only old, unreferenced tombstones; never a live item', () => {
  const now = 1_000_000_000_000; // fixed nowPt

  it('drops a tombstone older than the horizon that no live item references', () => {
    const oldPt = now - DEFAULT_GC_HORIZON_MS - 1;
    const d = day([
      item('LIVE', H(now, 0, 'uid')),
      item('OLDGHOST', H(oldPt, 0, 'uid'), { deleted: true }),
    ]);
    const gced = gcTombstones(d, now);
    expect(gced.items.map((i) => i.id).sort()).toEqual(['LIVE']); // ghost dropped
  });

  it('KEEPS a recent tombstone (within the horizon) so it can still propagate', () => {
    const recentPt = now - 1000; // 1s ago, well inside the 30d horizon
    const d = day([item('RECENTGHOST', H(recentPt, 0, 'uid'), { deleted: true })]);
    expect(gcTombstones(d, now).items.map((i) => i.id)).toEqual(['RECENTGHOST']);
  });

  it('NEVER drops a live item, however old its stamp', () => {
    const ancient = now - DEFAULT_GC_HORIZON_MS * 10;
    const d = day([item('ANCIENTLIVE', H(ancient, 0, 'uid'), { deleted: false })]);
    expect(gcTombstones(d, now).items.map((i) => i.id)).toEqual(['ANCIENTLIVE']);
  });

  it('KEEPS an old tombstone that IS referenced by a live item of the same id (never GC a referenced id)', () => {
    const oldPt = now - DEFAULT_GC_HORIZON_MS - 1;
    // A live item AND a tombstone share id 'A' (a resurrection): the id is referenced → keep both.
    const d = day([
      { ...item('A', H(now, 0, 'uid')), deleted: false },
      { ...item('A', H(oldPt, 0, 'uid')), deleted: true },
    ]);
    const gced = gcTombstones(d, now);
    expect(gced.items).toHaveLength(2);
  });
});

describe('mergeDay — case 11: ordering is deterministic and stable', () => {
  it('merged live items are sorted by winning hlc ascending, tombstones excluded from the live order', () => {
    const local = day([item('C', H(300, 0, 'uid')), item('GHOST', H(50, 0, 'uid'), { deleted: true })]);
    const remote = day([item('A', H(100, 0, 'uid')), item('B', H(200, 0, 'uid'))]);
    const merged = mergeDay(local, remote);
    const liveIds = merged.items.filter((i) => !i.deleted).map((i) => i.id);
    expect(liveIds).toEqual(['A', 'B', 'C']); // ascending by hlc pt 100,200,300
    // The tombstone is retained (for propagation) but after the live items.
    expect(merged.items.map((i) => i.id)).toEqual(['A', 'B', 'C', 'GHOST']);
  });
});

describe('mergeDays — collection-level: pairs by date, passes solo days through, sorts by date', () => {
  it('merges matched dates and preserves days unique to either side', () => {
    const d1Local = day([item('A', H(100, 0, 'uid'))], '2026-12-12');
    const d2LocalOnly = day([item('X', H(100, 0, 'uid'))], '2026-12-13');
    const d1Remote = day([item('B', H(200, 0, 'uid'))], '2026-12-12');
    const d3RemoteOnly = day([item('Y', H(100, 0, 'uid'))], '2026-12-14');

    const merged = mergeDays([d1Local, d2LocalOnly], [d1Remote, d3RemoteOnly]);
    expect(merged.map((d) => d.date)).toEqual(['2026-12-12', '2026-12-13', '2026-12-14']); // sorted
    const dec12 = merged.find((d) => d.date === '2026-12-12')!;
    expect(dec12.items.map((i) => i.id).sort()).toEqual(['A', 'B']); // different items both survive
  });
});

describe('stamp helpers (core/sync/stamp.ts) — PURE, clock+uid injected', () => {
  it('stampSyncCreated sets rev=1 and a fresh hlc', () => {
    const out = stampSyncCreated({ id: 'A', title: 'x', category: 'food' }, 5000, 'uidA');
    expect(out.rev).toBe(1);
    expect(out.hlc).toBe(serialize(H(5000, 0, 'uidA')));
  });

  it('stampSyncUpdated bumps rev and advances hlc strictly past the previous', () => {
    const created = stampSyncCreated({ id: 'A', title: 'x', category: 'food' }, 5000, 'uidA');
    const updated = stampSyncUpdated({ ...created, title: 'y' }, 5000, 'uidA'); // same ms ⇒ ct advances
    expect(updated.rev).toBe(2);
    expect(updated.hlc! > created.hlc!).toBe(true);
  });

  it('stampSyncDeleted writes a tombstone (deleted:true), bumps rev, advances hlc', () => {
    const created = stampSyncCreated({ id: 'A', title: 'x', category: 'food' }, 5000, 'uidA');
    const tomb = stampSyncDeleted(created, 6000, 'uidA');
    expect(tomb.deleted).toBe(true);
    expect(tomb.rev).toBe(2);
    expect(tomb.hlc! > created.hlc!).toBe(true);
  });
});
