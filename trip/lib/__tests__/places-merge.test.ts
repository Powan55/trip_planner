// Issue #17 (D-229 addendum) — the PURE My-Places merge (`core/places/merge.ts`). No mocks, no
// firebase, no DOM: this is the algebra that decides what "saved places follow you between phones"
// actually means, so it is pinned on its own.
//
// Every describe below is one of the four concrete ways a bare `mergeItems` drop-in fails on this
// domain. Each has a paired "would-fail-without-the-slice" assertion so the test is evidence, not
// decoration:
//   1. DELETES RESURRECT — `removePlace` physically filters, and a physical absence is
//      indistinguishable from "not seen yet". Fixed with a tombstone.
//   2. EVERY ROW GETS THE SAME HLC — `MyPlace` has `addedAt`, not the `updatedAt` that
//      `mergeItems` seeds a missing `hlc` from, so every un-stamped row resolved to pt=0.
//   3. THE CAP AND THE SORT ORDER FIGHT — merged output is HLC-ASCENDING, `MyPlace[]` is
//      newest-first, and the cap keeps the FIRST 200 (so it dropped the NEWEST places).
//   4. TOMBSTONES MUST NOT CONSUME THE CAP — 200 is a budget for real places.

import { describe, it, expect } from 'vitest';
import { mergePlaces } from '@/core/places/merge';
import { PLACES_CAP, type MyPlace } from '@/core/places/model';

const NOW = Date.UTC(2026, 7, 14); // 2026-08-14, the tombstone-GC horizon anchor
const DAY = 24 * 60 * 60 * 1000;

/** A serialized HLC at a given physical instant (the same fixed-width form `serialize` emits). */
function hlcAt(pt: number, actor: string): string {
  return `${String(pt).padStart(15, '0')}:000000:${actor}`;
}

function place(id: string, over: Partial<MyPlace> = {}): MyPlace {
  return { id, name: id, legId: 'main', addedAt: '2026-07-24T10:00:00.000Z', ...over };
}

const ids = (rows: MyPlace[]) => rows.map((p) => p.id);
const live = (rows: MyPlace[]) => rows.filter((p) => p.deleted !== true);
const dead = (rows: MyPlace[]) => rows.filter((p) => p.deleted === true);

describe('two phones, two different imports — both survive (the headline of #17)', () => {
  const phoneA = [place('boudhanath', { hlc: hlcAt(NOW - 2 * DAY, 'phoneA'), rev: 1 })];
  const phoneB = [place('fushimi', { hlc: hlcAt(NOW - 1 * DAY, 'phoneB'), rev: 1 })];

  it('neither device clobbers the other (union by id)', () => {
    expect(ids(mergePlaces(phoneA, phoneB, NOW)).sort()).toEqual(['boudhanath', 'fushimi']);
  });

  it('is commutative and idempotent, so arrival order cannot change the result', () => {
    const ab = mergePlaces(phoneA, phoneB, NOW);
    const ba = mergePlaces(phoneB, phoneA, NOW);
    expect(ab).toEqual(ba);
    expect(mergePlaces(phoneA, ab, NOW)).toEqual(ab);
  });
});

describe('CRUX 1 — a delete STAYS deleted (the resurrection test)', () => {
  const original = place('boudhanath', { rev: 1, hlc: hlcAt(NOW - 5 * DAY, 'phoneA') });
  // What phone A holds after the user tapped delete: a TOMBSTONE, not an absence.
  const tombstoned = [{ ...original, deleted: true, rev: 2, hlc: hlcAt(NOW - 1 * DAY, 'phoneA') }];
  // What phone B (offline through the delete) still holds: the live row.
  const peerStillLive = [original];

  it('the peer\'s stale live copy does NOT resurrect the removed place', () => {
    const merged = mergePlaces(tombstoned, peerStillLive, NOW);
    expect(live(merged)).toEqual([]);
    expect(dead(merged)).toHaveLength(1);
    // and it stays gone however many snapshots arrive
    expect(live(mergePlaces(merged, peerStillLive, NOW))).toEqual([]);
    expect(live(mergePlaces(peerStillLive, merged, NOW))).toEqual([]);
  });

  it('WOULD FAIL WITHOUT THE SLICE: a physical delete (no tombstone) resurrects on the next merge', () => {
    // This is exactly what `removePlace` produces on the local-only path — an empty local list.
    expect(ids(mergePlaces([], peerStillLive, NOW))).toEqual(['boudhanath']);
  });

  it('undo-of-delete works: a STRICTLY-later re-add beats the tombstone', () => {
    const readded = [{ ...original, rev: 3, hlc: hlcAt(NOW, 'phoneA') }];
    const merged = mergePlaces(readded, tombstoned, NOW);
    expect(ids(live(merged))).toEqual(['boudhanath']);
    expect(merged[0].deleted).toBeUndefined();
  });

  it('an ancient tombstone is garbage-collected past the 30-day horizon; a recent one is kept', () => {
    const ancient = [{ ...original, deleted: true, rev: 2, hlc: hlcAt(NOW - 40 * DAY, 'phoneA') }];
    expect(mergePlaces(ancient, [], NOW)).toEqual([]);
    expect(mergePlaces(tombstoned, [], NOW)).toHaveLength(1);
  });

  it('#238: a fast device clock (nowPt run far ahead) does not GC a tombstone the list\'s own newest stamp still calls recent', () => {
    const fastNowPt = NOW + 60 * DAY; // this device's clock reads ~60 days ahead of reality
    const anchor = [place('fushimi', { hlc: hlcAt(NOW - 1 * DAY, 'phoneB') })]; // the list's own newest stamp
    const recentGhost = [place('gone', { deleted: true, rev: 2, hlc: hlcAt(NOW - 2 * DAY, 'phoneA') })];
    // Naive `fastNowPt - 30d` blows the cutoff open to `NOW + 30d` and drops `gone` anyway;
    // capped to the list's own newest stamp (`NOW - 1d`), it is still within the 30-day horizon.
    const merged = mergePlaces(anchor, recentGhost, fastNowPt);
    expect(ids(merged).sort()).toEqual(['fushimi', 'gone']);
  });
});

describe('CRUX 2 — an un-stamped row is ordered by its real import instant, not the pt=0 epoch', () => {
  // A row written before this slice has no `hlc`. `mergeItems` seeds a missing `hlc` from
  // `updatedAt`, which `MyPlace` does not have — so without `seedFromAddedAt` EVERY such row
  // resolves to {pt:0,ct:0,actor:''} and loses to any stamped row, however stale that row is.
  const importedRecentlyOnThisPhone = [
    place('cafe', { name: 'Sunrise Cafe (my newer import)', addedAt: '2026-08-10T09:00:00.000Z' }),
  ];
  const staleButStampedOnThePeer = [
    place('cafe', {
      name: 'Sunrise Cafe (stale)',
      addedAt: '2026-07-01T09:00:00.000Z',
      rev: 1,
      hlc: hlcAt(Date.parse('2026-07-01T09:00:00.000Z'), 'phoneB'),
    }),
  ];

  it('the newer un-stamped import wins over an older stamped row, in either argument order', () => {
    expect(mergePlaces(importedRecentlyOnThisPhone, staleButStampedOnThePeer, NOW)[0].name).toContain('newer');
    expect(mergePlaces(staleButStampedOnThePeer, importedRecentlyOnThisPhone, NOW)[0].name).toContain('newer');
  });

  it('the seed is TRANSIENT — no `updatedAt` is ever persisted onto a place', () => {
    const merged = mergePlaces(importedRecentlyOnThisPhone, staleButStampedOnThePeer, NOW);
    expect(merged[0]).not.toHaveProperty('updatedAt');
  });
});

describe('CRUX 3 — over the cap, the merge keeps the NEWEST places, not the oldest', () => {
  // STAMPED rows on purpose: `mergeItems` returns live rows HLC-ASCENDING, so with real stamps the
  // oldest places come out FIRST and a `.slice(0, PLACES_CAP)` over that keeps the wrong 200.
  // (Measured against the naive drop-in: it kept 50 of the 150 newest.)
  const iso = (base: number, i: number) => new Date(base + i * DAY).toISOString();
  const OLD_BASE = Date.UTC(2026, 0, 1);
  const NEW_BASE = Date.UTC(2026, 5, 1);
  const oldOnes = Array.from({ length: 150 }, (_, i) =>
    place(`old-${i}`, { addedAt: iso(OLD_BASE, i), rev: 1, hlc: hlcAt(OLD_BASE + i * DAY, 'phoneA') }),
  );
  const newOnes = Array.from({ length: 150 }, (_, i) =>
    place(`new-${i}`, { addedAt: iso(NEW_BASE, i), rev: 1, hlc: hlcAt(NEW_BASE + i * DAY, 'phoneB') }),
  );

  it('300 merged places cap to 200, all 150 new ones survive, and only old ones are dropped', () => {
    const merged = mergePlaces(oldOnes, newOnes, NOW);
    expect(merged).toHaveLength(PLACES_CAP);
    expect(merged.filter((p) => p.id.startsWith('new-'))).toHaveLength(150);
    expect(merged.filter((p) => p.id.startsWith('old-'))).toHaveLength(50);
  });

  it('the surviving list is newest-first (the invariant the card grid renders on)', () => {
    const merged = mergePlaces(oldOnes, newOnes, NOW);
    expect(merged[0].addedAt).toBe(iso(NEW_BASE, 149));
    const addedAts = merged.map((p) => p.addedAt);
    expect([...addedAts].sort().reverse()).toEqual(addedAts);
  });
});

describe('CRUX 4 — tombstones do not consume the 200-place cap', () => {
  const iso = (i: number) => new Date(Date.UTC(2026, 5, 1) + i * DAY).toISOString();
  const fullList = Array.from({ length: PLACES_CAP }, (_, i) => place(`live-${i}`, { addedAt: iso(i) }));
  const tombstones = Array.from({ length: 20 }, (_, i) =>
    place(`gone-${i}`, { addedAt: iso(i), deleted: true, rev: 2, hlc: hlcAt(NOW - DAY, 'phoneB') }),
  );

  it('a full 200-place list plus 20 incoming tombstones keeps all 200 live places', () => {
    const merged = mergePlaces(fullList, tombstones, NOW);
    expect(live(merged)).toHaveLength(PLACES_CAP);
    expect(dead(merged)).toHaveLength(20);
    // Not one real place was evicted to make room for a deletion record.
    expect(ids(live(merged)).sort()).toEqual(ids(fullList).sort());
  });

  it('tombstones are themselves bounded, so the slot cannot grow without limit', () => {
    const manyDead = Array.from({ length: PLACES_CAP + 40 }, (_, i) =>
      place(`gone-${i}`, { addedAt: iso(i % 200), deleted: true, rev: 2, hlc: hlcAt(NOW - DAY, 'phoneB') }),
    );
    expect(dead(mergePlaces([], manyDead, NOW))).toHaveLength(PLACES_CAP);
  });
});
