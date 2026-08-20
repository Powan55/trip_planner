// @vitest-environment jsdom
//
// S329 / D-234 — client `validateOps` (state-validity) and `applyOp` (execution + undo).
// validateOps is exercised against a fixed LIVE-plans fixture covering every drop rule; applyOp is
// exercised against a FAKE store (plain call-capturing object) so the CRUD routing + undo-capture
// are proven without React/localStorage (the real store integration has its own proof in
// concierge-ops.integration.test.ts). jsdom only for crypto.randomUUID in generateItemId.

import { describe, it, expect, vi } from 'vitest';
import { validateOps, applyOp, describeOp, dropReason, type DropCode, type Op } from '@/lib/concierge-ops';
import { TRIP_DATES, formatDate } from '@/core/dates';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

const D0 = TRIP_DATES[0];
const D1 = TRIP_DATES[1];
const OFF_TRIP = '2025-01-01'; // not in TRIP_DATES

// LIVE plans: one live item on D0, one TOMBSTONED item on D0 (must be treated as absent).
const PLANS: DayPlan[] = [
  {
    date: D0,
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'live-1', title: 'Boudhanath Stupa', category: 'sightseeing', startMinutes: 540 },
      { id: 'dead-1', title: 'Cancelled tour', category: 'sightseeing', deleted: true },
    ],
  },
  { date: D1, city: 'Kathmandu', country: 'nepal', items: [] },
];

describe('validateOps (D-234)', () => {
  it('Rule 1 — empty ops array is valid (pure chat) and a non-array yields []', () => {
    expect(validateOps([], PLANS)).toEqual([]);
    expect(validateOps(undefined, PLANS)).toEqual([]);
    expect(validateOps(null, PLANS)).toEqual([]);
    expect(validateOps('nope', PLANS)).toEqual([]);
  });

  it('Rule 2 — drops an op whose type is not one of the four verbs', () => {
    const ops = [
      { type: 'clearDay', date: D0 },
      { type: 'copyDay', date: D0 },
      { type: 'addItem', date: D0, title: 'Momo lunch', category: 'food' }, // valid — survives
    ];
    const out = validateOps(ops, PLANS);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('addItem');
  });

  it('Rule 3 — drops ops missing per-type required fields', () => {
    const ops = [
      { type: 'addItem', title: 'no date', category: 'food' }, // add missing date
      { type: 'addItem', date: D0, category: 'food' }, // add missing title
      { type: 'addItem', date: D0, title: 'no category' }, // add missing category
      { type: 'updateItem', date: D0, title: 'x' }, // update missing itemId
      { type: 'removeItem', date: D0 }, // remove missing itemId
      { type: 'moveItem', itemId: 'live-1', fromDate: D0 }, // move missing toDate
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
    // S342: `date`/`fromDate` are no longer REQUIRED on update/remove/move — the target (and its
    // day) resolve from the id alone, so an op that omits them entirely is still actionable.
    expect(validateOps([{ type: 'removeItem', itemId: 'live-1' }], PLANS)).toHaveLength(1);
  });

  it('Rule 4 (S342-amended) — a non-trip date drops addItem.date and moveItem.toDate (the dates that ADDRESS a new day)', () => {
    const ops = [
      { type: 'addItem', date: OFF_TRIP, title: 'x', category: 'food' },
      { type: 'moveItem', itemId: 'live-1', fromDate: D0, toDate: OFF_TRIP },
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
    // …but NOT the pure-hint dates (removeItem.date, moveItem.fromDate) — see the Rule 6 case below.
    const hints = [
      { type: 'removeItem', itemId: 'live-1', date: OFF_TRIP },
      { type: 'moveItem', itemId: 'live-1', fromDate: OFF_TRIP, toDate: D1 },
    ];
    expect(validateOps(hints, PLANS)).toHaveLength(2);
  });

  it('Rule 5 — drops an op whose category is not in the D-012 10-set', () => {
    const ops = [
      { type: 'addItem', date: D0, title: 'x', category: 'brunch' }, // not a category
      { type: 'updateItem', itemId: 'live-1', date: D0, category: 'wandering' }, // bad patch category
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
  });

  it('Rule 6 — drops update/remove/move whose itemId is not a LIVE item (incl. tombstone exclusion)', () => {
    const ops = [
      { type: 'updateItem', itemId: 'ghost', date: D0, title: 'x' }, // no such id
      { type: 'removeItem', itemId: 'ghost', date: D0 },
      { type: 'moveItem', itemId: 'ghost', fromDate: D0, toDate: D1 },
      { type: 'updateItem', itemId: 'dead-1', date: D0, title: 'x' }, // exists but TOMBSTONED
      { type: 'removeItem', itemId: 'dead-1', date: D0 }, // tombstoned → treated as absent
      { type: 'moveItem', itemId: 'dead-1', fromDate: D0, toDate: D1 },
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
  });

  // S342 amendment: the target is resolved by id across ALL dates (ids are globally unique — the
  // D-018 merge invariant puts a given id in exactly one DayPlan.items[]), so a stated date that
  // disagrees with where the item actually lives is a HINT, not part of the key.
  it('Rule 6 (S342) — a live item is resolved by id even when the op states the WRONG date', () => {
    const ops = [
      { type: 'updateItem', itemId: 'live-1', date: D1, title: 'x' }, // live on D0, op says D1
      { type: 'removeItem', itemId: 'live-1', date: D1 },
      { type: 'moveItem', itemId: 'live-1', fromDate: D1, toDate: TRIP_DATES[2] },
    ];
    expect(validateOps(ops, PLANS).map((o) => o.type)).toEqual(['updateItem', 'removeItem', 'moveItem']);
  });

  it('moveItem is still dropped when the resolved current day equals toDate (no-op move)', () => {
    // fromDate lies (D1), but the item really is on D0 — and toDate is D0, so the move is a no-op.
    expect(validateOps([{ type: 'moveItem', itemId: 'live-1', fromDate: D1, toDate: D0 }], PLANS)).toEqual([]);
  });

  it('Rule 7 — drops startMinutes out of [0,1439] and durationMinutes ≤ 0', () => {
    const ops = [
      { type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 1440 },
      { type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: -1 },
      { type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 12.5 },
      { type: 'addItem', date: D0, title: 'x', category: 'food', durationMinutes: 0 },
      { type: 'addItem', date: D0, title: 'x', category: 'food', durationMinutes: -30 },
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
    // boundary values 0 and 1439 are IN range → survive
    const ok = validateOps(
      [{ type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 0, durationMinutes: 1 }],
      PLANS,
    );
    expect(ok).toHaveLength(1);
    const ok2 = validateOps(
      [{ type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 1439 }],
      PLANS,
    );
    expect(ok2).toHaveLength(1);
  });

  it('Rule 8 — drops an updateItem that carries no non-null patch field', () => {
    const ops = [
      { type: 'updateItem', itemId: 'live-1', date: D0 }, // no patch
      { type: 'updateItem', itemId: 'live-1', date: D0, notes: null, title: null }, // all-null patch
    ];
    expect(validateOps(ops, PLANS)).toEqual([]);
  });

  // ── S342 DIAGNOSIS ─────────────────────────────────────────────────────────────────────────
  // Reported: "Concierge AI still can't modify my plans." These reproduce the ranked silent-drop causes
  // from the S342 triage against the LIVE-plans fixture, and pin which ones the CLIENT can fix
  // (target resolution) vs which are only fixable in the WORKER PROMPT (a date the client cannot
  // interpret) and therefore stay dropped — now with a visible "didn't match" line in the UI.
  describe('S342 diagnosis — the ranked silent-drop causes', () => {
    it('CAUSE 1a (non-ISO date) — addItem STILL drops (prompt-side fix); update/remove no longer do', () => {
      // A human-readable date can't be mapped to a trip date, so an addItem carrying one is
      // unrecoverable client-side — the Worker prompt now states the ISO format + range.
      expect(validateOps([{ type: 'addItem', date: 'Dec 20', title: 'Ramen', category: 'food' }], PLANS)).toEqual([]);
      expect(validateOps([{ type: 'addItem', date: '12/20/2026', title: 'Ramen', category: 'food' }], PLANS)).toEqual([]);
      // update/remove address a target that already HAS a date, so the bad date is simply ignored.
      const out = validateOps(
        [
          { type: 'updateItem', itemId: 'live-1', date: 'Dec 9', notes: 'bring cash' },
          { type: 'removeItem', itemId: 'live-1', date: 'December 9' },
        ],
        PLANS,
      );
      expect(out.map((o) => o.type)).toEqual(['updateItem', 'removeItem']);
    });

    it('CAUSE 1b (wrong YEAR) — addItem STILL drops (prompt-side fix); update/remove survive', () => {
      const wrongYear = D0.replace('2026', '2025');
      expect(validateOps([{ type: 'addItem', date: wrongYear, title: 'Ramen', category: 'food' }], PLANS)).toEqual([]);
      const out = validateOps([{ type: 'updateItem', itemId: 'live-1', date: wrongYear, notes: 'x' }], PLANS);
      expect(out).toHaveLength(1);
    });

    it('CAUSE 3a (updateItem carrying the NEW date instead of moveItem) — survives, applied to the item’s REAL day', () => {
      const op = { type: 'updateItem', itemId: 'live-1', date: D1, startMinutes: 600 };
      const out = validateOps([op], PLANS);
      expect(out).toHaveLength(1);
      // and it must WRITE to D0 (where the item actually lives), not to the date the model invented
      const store = fakeStore();
      applyOp(out[0], store, PLANS);
      expect(store.calls[0].args[0]).toBe(D0);
      expect(describeOp(out[0], PLANS)).toContain('Boudhanath Stupa');
    });

    it('CAUSE 3b (truncated / mangled itemId) — still drops: there is nothing to resolve', () => {
      const ops = [
        { type: 'updateItem', itemId: 'live', date: D0, title: 'x' }, // truncated
        { type: 'removeItem', itemId: 'live-1 ', date: D0 }, // trailing space
        { type: 'moveItem', itemId: '#live-1', fromDate: D0, toDate: D1 }, // kept the '#' sigil
      ];
      expect(validateOps(ops, PLANS)).toEqual([]);
    });
  });

  // ── #13 — the same rules, now ANSWERABLE ───────────────────────────────────────────────────
  // `dropReason` holds the logic and `isValidOp` is its boolean wrapper, so this table IS the
  // validation table: a rule that stopped firing would show up here as `undefined`, and a rule
  // that fired for the wrong reason would show up as the wrong code. Codes only — the sentences
  // live in `components/concierge-chat.tsx` and are asserted in concierge-op-feedback.test.ts.
  describe('dropReason — one code per cause (#13)', () => {
    const CASES: Array<[string, unknown, DropCode | undefined]> = [
      ['not an object', 'nope', 'unreadable'],
      ['null', null, 'unreadable'],
      ['unknown verb', { type: 'clearDay', date: D0 }, 'unknown-verb'],
      ['startMinutes out of range', { type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 1440 }, 'bad-time'],
      ['startMinutes not an integer', { type: 'addItem', date: D0, title: 'x', category: 'food', startMinutes: 12.5 }, 'bad-time'],
      ['durationMinutes ≤ 0', { type: 'addItem', date: D0, title: 'x', category: 'food', durationMinutes: 0 }, 'bad-duration'],
      // The three ANDed addItem checks, told apart — this split is the point of the slice.
      ['addItem off-trip date', { type: 'addItem', date: OFF_TRIP, title: 'x', category: 'food' }, 'date-not-in-trip'],
      ['addItem blank title', { type: 'addItem', date: D0, title: '  ', category: 'food' }, 'no-title'],
      ['addItem unknown category', { type: 'addItem', date: D0, title: 'x', category: 'brunch' }, 'bad-category'],
      ['updateItem with no itemId', { type: 'updateItem', date: D0, title: 'x' }, 'no-such-item'],
      ['updateItem on a ghost id', { type: 'updateItem', itemId: 'ghost', title: 'x' }, 'no-such-item'],
      ['updateItem on a TOMBSTONE', { type: 'updateItem', itemId: 'dead-1', title: 'x' }, 'no-such-item'],
      ['updateItem with a blank title patch', { type: 'updateItem', itemId: 'live-1', title: '' }, 'no-title'],
      ['updateItem with a bad category patch', { type: 'updateItem', itemId: 'live-1', category: 'wandering' }, 'bad-category'],
      ['updateItem with a non-string notes patch', { type: 'updateItem', itemId: 'live-1', notes: 42 }, 'unreadable'],
      ['updateItem with no patch at all', { type: 'updateItem', itemId: 'live-1', date: D0 }, 'nothing-to-change'],
      ['updateItem with an all-null patch', { type: 'updateItem', itemId: 'live-1', notes: null, title: null }, 'nothing-to-change'],
      ['removeItem with no itemId', { type: 'removeItem', date: D0 }, 'no-such-item'],
      ['removeItem on a ghost id', { type: 'removeItem', itemId: 'ghost' }, 'no-such-item'],
      ['moveItem with an off-trip toDate', { type: 'moveItem', itemId: 'live-1', toDate: OFF_TRIP }, 'date-not-in-trip'],
      ['moveItem on a ghost id', { type: 'moveItem', itemId: 'ghost', toDate: D1 }, 'no-such-item'],
      ['moveItem to the day it is already on', { type: 'moveItem', itemId: 'live-1', fromDate: D1, toDate: D0 }, 'already-there'],
      // …and the valid ones answer `undefined`, which is what `isValidOp` filters on.
      ['a valid addItem', { type: 'addItem', date: D0, title: 'Momo', category: 'food' }, undefined],
      ['a valid updateItem', { type: 'updateItem', itemId: 'live-1', notes: 'bring cash' }, undefined],
      ['a valid removeItem', { type: 'removeItem', itemId: 'live-1' }, undefined],
      ['a valid moveItem', { type: 'moveItem', itemId: 'live-1', toDate: D1 }, undefined],
    ];

    for (const [name, op, expected] of CASES) {
      it(`${name} → ${expected ?? 'valid'}`, () => {
        expect(dropReason(op, PLANS)).toBe(expected);
        // The wrapper can never disagree with the predicate it wraps.
        expect(validateOps([op], PLANS)).toHaveLength(expected === undefined ? 1 : 0);
      });
    }
  });

  it('valid ops of each verb survive (order preserved), and a bad op does not nuke a good one', () => {
    const ops = [
      { type: 'addItem', date: D1, title: 'Momo lunch', category: 'food', startMinutes: 720 },
      { type: 'clearDay' }, // dropped
      { type: 'updateItem', itemId: 'live-1', date: D0, notes: 'bring cash' },
      { type: 'removeItem', itemId: 'live-1', date: D0 },
      { type: 'moveItem', itemId: 'live-1', fromDate: D0, toDate: D1 },
    ];
    const out = validateOps(ops, PLANS);
    expect(out.map((o) => o.type)).toEqual(['addItem', 'updateItem', 'removeItem', 'moveItem']);
  });
});

// ── FAKE store: captures each CRUD call so applyOp's routing + undo can be asserted. ──
//
// `landedId` models what the REAL store returns from `moveItem` (S389-A). This recorder holds no
// state, so ANY assertion made only on its call ARGS is unfalsifiable for a move — that is exactly
// how the old `undo moves it back` test passed on code whose undo was a live no-op. The return
// value is the one piece of real store behaviour a stateless fake CAN carry, so the move tests
// below assert against it: under sync `hooks/use-itinerary.ts` → `moveItem` mints a FRESH target id
// via `freshCopyOf`, so the id the item lands on is NOT the id that was passed in. Omit `landedId`
// to model a move that did not land at all.
function fakeStore(landedId?: string) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
  };
  return {
    calls,
    addItem: rec('addItem'),
    updateItem: rec('updateItem'),
    removeItem: rec('removeItem'),
    moveItem: (...args: unknown[]) => {
      calls.push({ fn: 'moveItem', args });
      return landedId;
    },
    restoreItem: rec('restoreItem'),
  };
}

describe('applyOp (D-234 — execution + undo)', () => {
  it('addItem MINTS a fresh id (never trusts an agent id) and undo removes exactly that id', () => {
    const store = fakeStore();
    const op: Op = {
      type: 'addItem',
      date: D0,
      title: 'Ramen',
      category: 'food',
      itemId: 'AGENT-SUPPLIED-ID', // must be ignored
      startMinutes: 1140,
      notes: 'spicy',
    };
    const { message, undo } = applyOp(op, store, PLANS);

    expect(store.calls).toHaveLength(1);
    const [date, item] = store.calls[0].args as [string, ItineraryItem];
    expect(store.calls[0].fn).toBe('addItem');
    expect(date).toBe(D0);
    expect(item.id).not.toBe('AGENT-SUPPLIED-ID'); // minted, not the agent's
    expect(item.id).toEqual(expect.any(String));
    expect(item.title).toBe('Ramen');
    expect(item.category).toBe('food');
    expect(item.startMinutes).toBe(1140);
    expect(item.notes).toBe('spicy');
    expect(message).toContain('Ramen');

    undo();
    expect(store.calls[1]).toEqual({ fn: 'removeItem', args: [D0, item.id] });
  });

  it('updateItem applies the non-null patch and undo restores the prior values of those keys', () => {
    const store = fakeStore();
    const op: Op = { type: 'updateItem', itemId: 'live-1', date: D0, startMinutes: 600, notes: 'new' };
    const { undo } = applyOp(op, store, PLANS);

    expect(store.calls[0].fn).toBe('updateItem');
    expect(store.calls[0].args).toEqual([D0, 'live-1', { startMinutes: 600, notes: 'new' }]);

    undo();
    // prior startMinutes was 540; prior notes was undefined → restored as such
    expect(store.calls[1]).toEqual({
      fn: 'updateItem',
      args: [D0, 'live-1', { startMinutes: 540, notes: undefined }],
    });
  });

  it('removeItem removes the item and undo restores the captured pre-state item', () => {
    const store = fakeStore();
    const op: Op = { type: 'removeItem', itemId: 'live-1', date: D0 };
    const { undo } = applyOp(op, store, PLANS);

    expect(store.calls[0]).toEqual({ fn: 'removeItem', args: [D0, 'live-1'] });
    undo();
    expect(store.calls[1].fn).toBe('restoreItem');
    const [date, item] = store.calls[1].args as [string, ItineraryItem];
    expect(date).toBe(D0);
    expect(item.id).toBe('live-1'); // the full captured item
    expect(item.title).toBe('Boudhanath Stupa');
  });

  // S389-A. The test this REPLACES asserted `store.calls[1]` was `['live-1', D1, D0]` — an inverse
  // by the ORIGINAL id, which IS the defect: under sync the target copy has a fresh id, so that
  // inverse resolves nothing and the undo toast shows while doing nothing. The old assertion could
  // not fail, because the fake store never moved anything for the inverse to miss.
  it('moveItem inverts by the id the store ACTUALLY landed the item on, not the original (S389-A)', () => {
    const store = fakeStore('fresh-target-id'); // sync-on: freshCopyOf minted a new id
    const op: Op = { type: 'moveItem', itemId: 'live-1', fromDate: D0, toDate: D1 };
    const { undo } = applyOp(op, store, PLANS);

    expect(store.calls[0]).toEqual({ fn: 'moveItem', args: ['live-1', D0, D1] });
    undo();
    expect(store.calls[1]).toEqual({ fn: 'moveItem', args: ['fresh-target-id', D1, D0] });
  });

  it('moveItem undo dispatches NOTHING when the move did not land (store returned no id)', () => {
    const store = fakeStore(); // the move was a no-op — there is no target to move back
    const { undo } = applyOp(
      { type: 'moveItem', itemId: 'live-1', fromDate: D0, toDate: D1 },
      store,
      PLANS,
    );
    undo();
    expect(store.calls).toHaveLength(1); // the forward call only — no phantom inverse
  });
});

describe('describeOp — chip labels', () => {
  it('labels each verb, resolving the live title for update/remove/move', () => {
    expect(describeOp({ type: 'addItem', date: D0, title: 'Ramen', category: 'food', startMinutes: 1140 }, PLANS)).toContain('Add “Ramen”');
    expect(describeOp({ type: 'updateItem', itemId: 'live-1', date: D0, notes: 'x' }, PLANS)).toContain('Boudhanath Stupa');

    expect(describeOp({ type: 'removeItem', itemId: 'live-1', date: D0 }, PLANS)).toContain('Remove “Boudhanath Stupa”');
    expect(describeOp({ type: 'moveItem', itemId: 'live-1', fromDate: D0, toDate: D1 }, PLANS)).toContain('Move “Boudhanath Stupa”');
  });

  // S389-B — the updateItem chip must NAME the change. It previously read
  // `Update “Boudhanath Stupa” on Wed, Dec 9` for every patch, whatever it contained: the
  // traveller was asked to confirm a mutation whose content was invisible.
  describe('updateItem names what it changes (S389-B)', () => {
    const label = (op: Op) => describeOp(op, PLANS);

    it('names each patchable field in the chip', () => {
      expect(label({ type: 'updateItem', itemId: 'live-1', startMinutes: 870 })).toContain('set time to 2:30 PM');
      expect(label({ type: 'updateItem', itemId: 'live-1', durationMinutes: 90 })).toContain('set duration to 1h 30m');
      expect(label({ type: 'updateItem', itemId: 'live-1', title: 'Swayambhunath' })).toContain('rename to “Swayambhunath”');
      expect(label({ type: 'updateItem', itemId: 'live-1', category: 'photography' })).toContain('set category to photography');
      expect(label({ type: 'updateItem', itemId: 'live-1', notes: 'bring cash' })).toContain('set notes');
      expect(label({ type: 'updateItem', itemId: 'live-1', location: 'Boudha' })).toContain('set location to “Boudha”');
    });

    it('distinguishes clearing a field from setting one', () => {
      expect(label({ type: 'updateItem', itemId: 'live-1', notes: '' })).toContain('clear notes');
      expect(label({ type: 'updateItem', itemId: 'live-1', location: '' })).toContain('clear location');
    });

    it('still names the item and the day it lands on', () => {
      const out = label({ type: 'updateItem', itemId: 'live-1', date: D1, startMinutes: 870 });
      expect(out).toContain('Boudhanath Stupa');
      expect(out).toContain(formatDate(D0)); // the item's REAL day, not the op's hint (S342)
    });

    it('summarises a wide patch instead of dumping every clause', () => {
      const out = label({
        type: 'updateItem',
        itemId: 'live-1',
        title: 'New',
        category: 'food',
        notes: 'n',
        location: 'l',
        startMinutes: 600,
      });
      expect(out).toContain('rename to “New”');
      expect(out).toContain('set category to food');
      expect(out).toContain('+ 3 more');
      expect(out).not.toContain('set time to'); // beyond the cap — summarised, not dumped
    });

    it('does NOT append a bare time suffix for a patch that is not changing the time', () => {
      // The old label appended ` · <time>` from `op.startMinutes` regardless of verb, so a
      // notes-only edit still read as though the time were part of the change.
      const out = label({ type: 'updateItem', itemId: 'live-1', notes: 'bring cash' });
      expect(out).toBe(`Update “Boudhanath Stupa” on ${formatDate(D0)} · set notes`);
    });
  });
});

// silence: no console output expected from this module (D-152) — a spy guards it.
it('logs nothing (D-152)', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  validateOps([{ type: 'clearDay' }, { type: 'addItem', date: D0, title: 'x', category: 'food' }], PLANS);
  // #13 — explaining a drop must not become a reason to log one.
  dropReason({ type: 'clearDay' }, PLANS);
  applyOp({ type: 'addItem', date: D0, title: 'x', category: 'food' }, fakeStore(), PLANS);
  expect(spy).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  spy.mockRestore();
  warn.mockRestore();
});
