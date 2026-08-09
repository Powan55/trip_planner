// @vitest-environment jsdom
//
// Pure-function unit tests for the S94 `core/itinerary` CRUD extraction. These exercise
// the framework-free `DayPlan[]` transforms directly (no React, no window, no firebase) —
// the mechanical extraction of the logic that formerly lived inline in
// `hooks/use-itinerary.ts`. Three things are proven here:
//   1. Each CRUD op behaves as before on a `DayPlan[]` (add/update/remove/move/reorder +
//      upsert/synthesize + the two selectors), including the D-041 stamper injection point.
//   2. The D-031 composition property: two chained mutations, each fed the PRIOR mutation's
//      result (the store's "read base from freshest persisted state, not the closure"),
//      compose without clobbering — the moveItem+reorderItems-in-one-handler case.
//   3. A StoragePort CONTRACT test: a fake in-memory port drives the exact same CRUD the
//      hook's `commit()` runs (load → transform → save), proving the core is port-driven
//      and the persistence contract is honored through the port abstraction.
import { describe, it, expect } from 'vitest';
import {
  synthesizeDay,
  upsertDay,
  addItem,
  updateItem,
  removeItem,
  moveItem,
  deleteItems,
  moveItems,
  copyDay,
  reorderItems,
  getDayPlan,
  findPlacements,
  noStamp,
} from '@/core/itinerary';
import type { StoragePort } from '@/core/ports';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const NEPAL_DATE = '2026-12-10'; // inside the Nepal leg
const JAPAN_DATE = '2026-12-25'; // inside the Japan leg (S112: Kyoto leg, Dec 24-28)

function item(id: string, extra: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id, title: `Item ${id}`, category: 'sightseeing', ...extra };
}

function day(date: string, items: ItineraryItem[], over: Partial<DayPlan> = {}): DayPlan {
  return { date, city: 'X', country: 'nepal', items, ...over };
}

describe('core/itinerary — synthesizeDay', () => {
  it('synthesizes a Nepal day (Kathmandu) for a Nepal-leg date', () => {
    expect(synthesizeDay(NEPAL_DATE)).toEqual({
      date: NEPAL_DATE,
      city: 'Kathmandu',
      country: 'nepal',
      items: [],
    });
  });

  it('synthesizes a Japan day (Kyoto) for a Japan-leg date', () => {
    expect(synthesizeDay(JAPAN_DATE)).toEqual({
      date: JAPAN_DATE,
      city: 'Kyoto',
      country: 'japan',
      items: [],
    });
  });
});

describe('core/itinerary — upsertDay', () => {
  it('maps over an existing day', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const next = upsertDay(plans, NEPAL_DATE, (p) => ({ ...p, city: 'Pokhara' }));
    expect(next).toHaveLength(1);
    expect(next[0].city).toBe('Pokhara');
    expect(next[0].items).toEqual([item('a')]);
  });

  it('synthesizes + applies when the day is absent (append, order preserved)', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const next = upsertDay(plans, JAPAN_DATE, (p) => ({
      ...p,
      items: [...p.items, item('b')],
    }));
    expect(next).toHaveLength(2);
    expect(next[0].date).toBe(NEPAL_DATE);
    expect(next[1]).toEqual({
      date: JAPAN_DATE,
      city: 'Kyoto',
      country: 'japan',
      items: [item('b')],
    });
  });

  it('does not mutate the input array', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const snapshot = JSON.stringify(plans);
    upsertDay(plans, NEPAL_DATE, (p) => ({ ...p, items: [] }));
    expect(JSON.stringify(plans)).toBe(snapshot);
  });
});

describe('core/itinerary — addItem', () => {
  it('appends an item to an existing day', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const next = addItem(plans, NEPAL_DATE, item('b'));
    expect(next[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('creates the day (synthesized) when absent', () => {
    const next = addItem([], JAPAN_DATE, item('b'));
    expect(next).toHaveLength(1);
    expect(next[0].date).toBe(JAPAN_DATE);
    expect(next[0].country).toBe('japan');
    expect(next[0].items).toEqual([item('b')]);
  });

  it('applies the injected stamper (D-041 boundary) to the added item', () => {
    const stamp = (i: ItineraryItem): ItineraryItem => ({ ...i, createdBy: 'Alex', updatedBy: 'Alex' });
    const next = addItem([], NEPAL_DATE, item('b'), stamp);
    expect(next[0].items[0]).toMatchObject({ id: 'b', createdBy: 'Alex', updatedBy: 'Alex' });
  });

  it('noStamp default leaves the item unchanged (dormant / no-name case)', () => {
    const next = addItem([], NEPAL_DATE, item('b'), noStamp);
    expect(next[0].items[0]).toEqual(item('b'));
  });
});

describe('core/itinerary — updateItem', () => {
  it('patches the matching item, leaving siblings untouched', () => {
    const plans = [day(NEPAL_DATE, [item('a'), item('b')])];
    const next = updateItem(plans, NEPAL_DATE, 'b', { title: 'Renamed' });
    expect(next[0].items[0]).toEqual(item('a'));
    expect(next[0].items[1].title).toBe('Renamed');
  });

  it('stamps the MERGED item via the injected stamper (D-041)', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const stamp = (i: ItineraryItem): ItineraryItem => ({ ...i, updatedBy: 'Sam' });
    const next = updateItem(plans, NEPAL_DATE, 'a', { notes: 'hi' }, stamp);
    expect(next[0].items[0]).toMatchObject({ id: 'a', notes: 'hi', updatedBy: 'Sam' });
  });

  it('is a no-op on a day that has no matching item id (but upserts the day)', () => {
    const next = updateItem([], JAPAN_DATE, 'nope', { title: 'x' });
    // day is synthesized, but no item matches → items stays []
    expect(next[0].items).toEqual([]);
  });
});

describe('core/itinerary — removeItem', () => {
  it('removes the matching item; no attribution applied', () => {
    const plans = [day(NEPAL_DATE, [item('a'), item('b')])];
    const next = removeItem(plans, NEPAL_DATE, 'a');
    expect(next[0].items.map((i) => i.id)).toEqual(['b']);
  });

  it('emptying a day yields items:[] (the [] survives — D-091 at the transform level)', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const next = removeItem(plans, NEPAL_DATE, 'a');
    expect(next[0].items).toEqual([]);
  });
});

describe('core/itinerary — moveItem', () => {
  it('moves an item from source day to target day (append)', () => {
    const plans = [day(NEPAL_DATE, [item('a'), item('b')]), day(JAPAN_DATE, [item('c')])];
    const next = moveItem(plans, 'b', NEPAL_DATE, JAPAN_DATE);
    expect(next.find((d) => d.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual(['a']);
    expect(next.find((d) => d.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('synthesizes the target day when absent', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    const next = moveItem(plans, 'a', NEPAL_DATE, JAPAN_DATE);
    const target = next.find((d) => d.date === JAPAN_DATE)!;
    expect(target.country).toBe('japan');
    expect(target.items.map((i) => i.id)).toEqual(['a']);
    expect(next.find((d) => d.date === NEPAL_DATE)!.items).toEqual([]);
  });

  it('same-date move is a no-op (returns the same array reference)', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    expect(moveItem(plans, 'a', NEPAL_DATE, NEPAL_DATE)).toBe(plans);
  });

  it('unknown item id is a no-op (returns the same array reference)', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    expect(moveItem(plans, 'zzz', NEPAL_DATE, JAPAN_DATE)).toBe(plans);
  });

  it('stamps the moved item via the injected stamper (D-041); createdBy preserved', () => {
    const plans = [day(NEPAL_DATE, [item('a', { createdBy: 'Orig' })])];
    const stamp = (i: ItineraryItem): ItineraryItem => ({ ...i, updatedBy: 'Mover' });
    const next = moveItem(plans, 'a', NEPAL_DATE, JAPAN_DATE, stamp);
    const moved = next.find((d) => d.date === JAPAN_DATE)!.items[0];
    expect(moved).toMatchObject({ id: 'a', createdBy: 'Orig', updatedBy: 'Mover' });
  });
});

describe('core/itinerary — reorderItems', () => {
  it('reorders items to match orderedIds', () => {
    const plans = [day(NEPAL_DATE, [item('a'), item('b'), item('c')])];
    const next = reorderItems(plans, NEPAL_DATE, ['c', 'a', 'b']);
    expect(next[0].items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops ids not present in orderedIds; ignores unknown ids', () => {
    const plans = [day(NEPAL_DATE, [item('a'), item('b'), item('c')])];
    const next = reorderItems(plans, NEPAL_DATE, ['b', 'zzz']);
    expect(next[0].items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('core/itinerary — selectors', () => {
  it('getDayPlan returns the matching day, else a synthesized empty day', () => {
    const plans = [day(NEPAL_DATE, [item('a')])];
    expect(getDayPlan(plans, NEPAL_DATE).items).toEqual([item('a')]);
    expect(getDayPlan(plans, JAPAN_DATE)).toEqual({
      date: JAPAN_DATE,
      city: 'Kyoto',
      country: 'japan',
      items: [],
    });
  });

  it('findPlacements returns every item across days matching sourceId, with its date', () => {
    const plans = [
      day(NEPAL_DATE, [item('a', { sourceId: 'rec-1' }), item('b')]),
      day(JAPAN_DATE, [item('c', { sourceId: 'rec-1' })]),
    ];
    const found = findPlacements(plans, 'rec-1');
    expect(found).toEqual([
      { date: NEPAL_DATE, item: item('a', { sourceId: 'rec-1' }) },
      { date: JAPAN_DATE, item: item('c', { sourceId: 'rec-1' }) },
    ]);
  });
});

// ── S130 bulk ops (deleteItems / moveItems / copyDay) ─────────────────────────
// Each bulk op is a FOLD of its single-item sibling over the selection. Copy mints fresh ids
// via an injected stripper (production = freshCopyOf); the tests use a deterministic stripper
// that mirrors its CONTRACT (strip the source id, mint a new one, keep content) without pulling
// the hook's generateItemId. These prove the fold, the fresh-id + dedupe guarantee (D-032), and
// the live-only copy.
describe('core/itinerary — bulk ops (S130)', () => {
  // Fresh-id stripper for copyDay tests (deterministic; contract-equivalent to freshCopyOf).
  function makeCopyOf() {
    let n = 0;
    return (i: ItineraryItem): ItineraryItem => {
      const { id: _id, deleted: _d, ...content } = i as ItineraryItem & { deleted?: boolean };
      return { ...content, id: `copy-${n++}` } as ItineraryItem;
    };
  }

  it('deleteItems removes a subset across days, leaves the rest (fold of removeItem)', () => {
    const base = [
      day(NEPAL_DATE, [item('a'), item('b'), item('c')]),
      day(JAPAN_DATE, [item('d'), item('e')]),
    ];
    const next = deleteItems(base, [
      { date: NEPAL_DATE, itemId: 'a' },
      { date: NEPAL_DATE, itemId: 'c' },
      { date: JAPAN_DATE, itemId: 'e' },
    ]);
    expect(next.find((d) => d.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual(['b']);
    expect(next.find((d) => d.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual(['d']);
  });

  it('moveItems moves a set to the target (sources lose them, target gains them; fold of moveItem)', () => {
    const base = [
      day(NEPAL_DATE, [item('a'), item('b'), item('c')]),
      day(JAPAN_DATE, [item('z')]),
    ];
    const next = moveItems(
      base,
      [
        { itemId: 'a', fromDate: NEPAL_DATE },
        { itemId: 'c', fromDate: NEPAL_DATE },
      ],
      JAPAN_DATE,
    );
    expect(next.find((d) => d.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual(['b']);
    expect(next.find((d) => d.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual(['z', 'a', 'c']);
  });

  it('copyDay copies live items to dst with FRESH ids (differ from source), skipping tombstones', () => {
    const base = [
      day(NEPAL_DATE, [
        item('a'),
        item('b', { deleted: true } as Partial<ItineraryItem>),
        item('c'),
      ]),
      day(JAPAN_DATE, [item('z')]),
    ];
    const next = copyDay(base, NEPAL_DATE, JAPAN_DATE, makeCopyOf());
    const dst = next.find((d) => d.date === JAPAN_DATE)!.items;
    // 'z' + two copies (of live a, c) — the tombstoned 'b' is NOT copied.
    expect(dst.map((i) => i.id)).toEqual(['z', 'copy-0', 'copy-1']);
    // Copies never reuse a source id; content (title) carried.
    expect(dst.filter((i) => i.id.startsWith('copy-')).map((i) => i.title)).toEqual([
      'Item a',
      'Item c',
    ]);
    // Source untouched.
    expect(next.find((d) => d.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('copyDay(src, src) dedupes — copies get FRESH ids, never colliding with the originals (D-032)', () => {
    const base = [day(NEPAL_DATE, [item('a'), item('c')])];
    const next = copyDay(base, NEPAL_DATE, NEPAL_DATE, makeCopyOf());
    const ids = next.find((d) => d.date === NEPAL_DATE)!.items.map((i) => i.id);
    // Originals kept + two fresh-id copies; all four ids distinct (no reuse of 'a'/'c').
    expect(ids).toEqual(['a', 'c', 'copy-0', 'copy-1']);
    expect(new Set(ids).size).toBe(4);
  });
});

// ── D-031 composition property ───────────────────────────────────────────────
// The store's `commit()` reads its base from the FRESHEST PERSISTED state (loadPlans),
// NOT the React closure — so two mutations chained in ONE handler each see the prior
// mutation's already-applied result and compose without clobbering. The pure core makes
// this trivially checkable: feed each transform the PRIOR transform's output. This is the
// exact `handleDragEnd` case: moveItem then reorderItems in one handler.
describe('core/itinerary — D-031 chained composition (moveItem + reorderItems in one handler)', () => {
  it('move to target then reorder that target compose correctly (no clobber)', () => {
    const base = [
      day(NEPAL_DATE, [item('a'), item('b')]),
      day(JAPAN_DATE, [item('c'), item('d')]),
    ];

    // Handler step 1: move 'b' from Nepal to Japan (append) → Japan = [c, d, b].
    const afterMove = moveItem(base, 'b', NEPAL_DATE, JAPAN_DATE);
    expect(afterMove.find((x) => x.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual([
      'c',
      'd',
      'b',
    ]);

    // Handler step 2, fed step 1's result (the freshest base — D-031): reorder Japan so
    // the just-moved 'b' lands first → [b, c, d]. If step 2 had instead re-read a stale
    // pre-move base (the bug D-031 prevents), 'b' would be absent and this would drop it.
    const afterReorder = reorderItems(afterMove, JAPAN_DATE, ['b', 'c', 'd']);
    expect(afterReorder.find((x) => x.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual([
      'b',
      'c',
      'd',
    ]);
    // Nepal correctly lost 'b'.
    expect(afterReorder.find((x) => x.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual([
      'a',
    ]);
  });

  // S130: a BULK op chained with another op in ONE handler must compose on the prior's output.
  // deleteItems then copyDay: the copy must see the POST-delete day, so the just-deleted item is
  // NOT copied. Non-vacuous — if copyDay re-read a stale pre-delete base (the bug D-031 prevents),
  // 'a' would still be copied to Japan and this would fail.
  it('deleteItems then copyDay compose (the copy sees the post-delete day — non-vacuous)', () => {
    let n = 0;
    const copyOf = (i: ItineraryItem): ItineraryItem => {
      const { id: _id, ...content } = i;
      return { ...content, id: `copy-${n++}` } as ItineraryItem;
    };
    const base = [
      day(NEPAL_DATE, [item('a'), item('b')]),
      day(JAPAN_DATE, []),
    ];

    // Handler step 1: delete 'a' from Nepal → Nepal = [b].
    const afterDelete = deleteItems(base, [{ date: NEPAL_DATE, itemId: 'a' }]);
    expect(afterDelete.find((x) => x.date === NEPAL_DATE)!.items.map((i) => i.id)).toEqual(['b']);

    // Handler step 2, fed step 1's result (D-031): copy Nepal → Japan. ONLY the surviving 'b'
    // is copied (fresh id). Had step 2 read the pre-delete base, Japan would wrongly get a copy
    // of 'a' too.
    const afterCopy = copyDay(afterDelete, NEPAL_DATE, JAPAN_DATE, copyOf);
    const japan = afterCopy.find((x) => x.date === JAPAN_DATE)!.items;
    expect(japan.map((i) => i.id)).toEqual(['copy-0']);
    expect(japan[0].title).toBe('Item b');
    expect(japan[0].id).not.toBe('a');
    expect(japan[0].id).not.toBe('b');
  });
});

// ── StoragePort contract test ────────────────────────────────────────────────
// A fake in-memory StoragePort<DayPlan[]> drives the exact read-modify-write cycle the
// hook's `commit()` runs: base = port.load(); next = coreTransform(base); port.save(next).
// This proves the core is port-driven — the CRUD composes with ANY StoragePort impl, not
// just the Vault gateway — and that a chained commit reads its base from the freshest
// PERSISTED state (D-031), the load-bearing invariant.
function makeFakePort(seed: DayPlan[]): StoragePort<DayPlan[]> & { readonly saves: number } {
  let value: DayPlan[] = seed;
  let saves = 0;
  return {
    load: () => value,
    save: (v) => {
      value = v;
      saves += 1;
    },
    has: () => true,
    get saves() {
      return saves;
    },
  };
}

describe('core/itinerary — StoragePort contract (fake in-memory port drives the CRUD)', () => {
  // Mirror the hook's commit(): read base from the port, transform, save back.
  function commit(port: StoragePort<DayPlan[]>, transform: (base: DayPlan[]) => DayPlan[]) {
    const prev = port.load();
    const next = transform(prev);
    port.save(next);
    return { prev, next };
  }

  it('add → the port now holds the added item; load() reflects the save', () => {
    const port = makeFakePort([]);
    commit(port, (base) => addItem(base, NEPAL_DATE, item('a')));
    expect(port.load()[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('two chained commits each read the FRESHEST persisted base (D-031 through the port)', () => {
    const port = makeFakePort([
      day(NEPAL_DATE, [item('a'), item('b')]),
      day(JAPAN_DATE, [item('c')]),
    ]);

    // Commit 1: move 'b' Nepal→Japan.
    commit(port, (base) => moveItem(base, 'b', NEPAL_DATE, JAPAN_DATE));
    // Commit 2 reads port.load() — which now returns commit 1's persisted result, NOT the
    // original seed — so the reorder sees 'b' present in Japan and composes cleanly.
    commit(port, (base) => reorderItems(base, JAPAN_DATE, ['b', 'c']));

    expect(port.load().find((d) => d.date === JAPAN_DATE)!.items.map((i) => i.id)).toEqual([
      'b',
      'c',
    ]);
    expect(port.saves).toBe(2);
  });

  it('delete-all through the port persists [] (empty survives — D-091 via the port)', () => {
    const port = makeFakePort([day(NEPAL_DATE, [item('a')])]);
    commit(port, (base) => removeItem(base, NEPAL_DATE, 'a'));
    expect(port.load()[0].items).toEqual([]);
    // The port physically holds the emptied day — no length gate, [] is a real state.
    expect(port.has()).toBe(true);
  });
});
