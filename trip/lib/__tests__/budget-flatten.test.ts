// S143 — PURE unit suite for the budget ⇄ leaf-field bridge (core/budget/flatten.ts) + the
// normalizeModel round-trip of the additive sync.fieldHlc (a DoD line). Proves, on a real run:
//   - flattenBudget covers EVERY leaf of a full model, incl. category budgets on BOTH legs;
//   - normalizeModel PRESERVES sync.fieldHlc when present and TOLERATES it absent (byte-identity);
//   - modelToFields / fieldsToModel round-trip a stamped model, with a stamped-null = cleared field;
//   - stampBudgetChanges advances the HLC of exactly the CHANGED leaf paths (added/edited/cleared).

import { describe, it, expect } from 'vitest';
import {
  flattenBudget,
  modelToFields,
  fieldsToModel,
  stampBudgetChanges,
} from '@/core/budget/flatten';
import { normalizeModel, type BudgetModel } from '@/core/budget/model';
import { mergeBudget, type BudgetFields } from '@/core/sync/merge-budget';

function fullModel(): BudgetModel {
  return {
    version: 1,
    homeCurrency: 'JPY',
    rates: { NPR: 140, JPY: 150 },
    legBudgets: { nepal: 13800, japan: 31000 },
    categoryBudgets: { nepal: { food: 2760, hotel: 5000 }, japan: { food: 9000 } },
  };
}

describe('flattenBudget — the CLOSED leaf-path set (fixed scalars + present categories, both legs)', () => {
  it('covers every leaf of a full model', () => {
    expect(flattenBudget(fullModel())).toEqual({
      homeCurrency: 'JPY',
      'rates.NPR': 140,
      'rates.JPY': 150,
      'legBudgets.nepal': 13800,
      'legBudgets.japan': 31000,
      'categoryBudgets.nepal.food': 2760,
      'categoryBudgets.nepal.hotel': 5000,
      'categoryBudgets.japan.food': 9000,
    });
  });

  it('a seeded default flattens to just the five fixed scalars (no category leaves)', () => {
    const seed: BudgetModel = {
      version: 1,
      homeCurrency: 'USD',
      rates: { NPR: 138, JPY: 155 },
      legBudgets: { nepal: 0, japan: 0 },
      categoryBudgets: {},
    };
    expect(Object.keys(flattenBudget(seed)).sort()).toEqual(
      ['homeCurrency', 'legBudgets.japan', 'legBudgets.nepal', 'rates.JPY', 'rates.NPR'].sort(),
    );
  });
});

describe('normalizeModel — round-trips sync.fieldHlc (present) + tolerates absent (D-038)', () => {
  it('PRESERVES sync.fieldHlc when present', () => {
    const withSync: BudgetModel = {
      ...fullModel(),
      sync: { fieldHlc: { 'rates.NPR': '000000000001000:000000:A', 'legBudgets.nepal': '000000000002000:000000:B' } },
    };
    const back = normalizeModel(withSync);
    expect(back.sync).toEqual(withSync.sync);
  });

  it('TOLERATES an absent sync (a dormant model normalizes with NO sync key — byte-identical)', () => {
    const dormant = fullModel();
    const back = normalizeModel(dormant);
    expect('sync' in back).toBe(false);
    expect(back).toEqual(dormant);
  });

  it('sanitizes a junk fieldHlc (non-string values dropped)', () => {
    const dirty = {
      ...fullModel(),
      sync: { fieldHlc: { 'rates.NPR': 'ok', 'rates.JPY': 42 as unknown as string } },
    };
    expect(normalizeModel(dirty).sync).toEqual({ fieldHlc: { 'rates.NPR': 'ok' } });
  });
});

describe('modelToFields / fieldsToModel — stamped round-trip + stamped-null clear', () => {
  it('round-trips a stamped model through the field-doc shape', () => {
    const model: BudgetModel = {
      ...fullModel(),
      sync: {
        fieldHlc: {
          homeCurrency: '000000000001000:000000:A',
          'rates.NPR': '000000000001001:000000:A',
          'rates.JPY': '000000000001002:000000:A',
          'legBudgets.nepal': '000000000001003:000000:A',
          'legBudgets.japan': '000000000001004:000000:A',
          'categoryBudgets.nepal.food': '000000000001005:000000:A',
          'categoryBudgets.nepal.hotel': '000000000001006:000000:A',
          'categoryBudgets.japan.food': '000000000001007:000000:A',
        },
      },
    };
    const fields = modelToFields(model);
    expect(fields['legBudgets.nepal']).toEqual({ v: 13800, hlc: '000000000001003:000000:A' });
    // full round-trip reconstructs the same normalized model.
    expect(fieldsToModel(fields)).toEqual(normalizeModel(model));
  });

  it('a stamped path with no live value becomes a stamped null, and fieldsToModel drops it', () => {
    const clearedModel: BudgetModel = {
      ...fullModel(),
      categoryBudgets: { nepal: {}, japan: { food: 9000 } }, // nepal.food/hotel cleared
      sync: {
        fieldHlc: {
          'categoryBudgets.nepal.food': '000000000009000:000000:A', // stamped clear
        },
      },
    };
    const fields = modelToFields(clearedModel);
    expect(fields['categoryBudgets.nepal.food']).toEqual({ v: null, hlc: '000000000009000:000000:A' });
    // Rebuilt model has no nepal.food category (null = absent).
    expect(fieldsToModel(fields).categoryBudgets.nepal?.food).toBeUndefined();
  });

  it('an UNSTAMPED live field gets an oldest-possible seed HLC (loses to any real edit)', () => {
    const fields = modelToFields(fullModel()); // no sync ⇒ every field seeded
    expect(fields['rates.NPR'].hlc).toBe('000000000000000:000000:'); // pt 0, empty actor
  });
});

// A leaf a NEWER build minted, arriving from a peer through `budgetDocToFields` (which retains
// unknown paths). `unflattenBudget` rebuilds a closed path set, so its VALUE is dropped on the way
// into the model while `fieldsToModel` keeps its `hlc` — the state `modelToFields` used to write
// back as a stamped-null clear carrying the peer's own stamp. This is the lazily-updating-PWA
// window (D-374), not a same-build case, so nothing else in either budget suite reaches it.
describe('a leaf THIS BUILD CANNOT NAME is a peer forward field, never a clear', () => {
  const PEER_HLC = '000000000005000:000000:PEER';
  const FORWARD = 'rates.EUR';
  const peerFields = (): BudgetFields => ({
    ...modelToFields(fullModel()),
    [FORWARD]: { v: 400000, hlc: PEER_HLC },
  });

  it('the value is dropped from the model but NO stamped null is emitted for it', () => {
    const local = fieldsToModel(peerFields());
    expect(local.sync!.fieldHlc[FORWARD]).toBe(PEER_HLC); // the stamp is kept…
    expect(modelToFields(local)[FORWARD]).toBeUndefined(); // …and must not become {v:null}
  });

  it("the peer's value survives the snapshot merge AND this device's next push", () => {
    // Snapshot: mergeBudget(local, remote) → fieldsToModel → saveBudget.
    const local = fieldsToModel(mergeBudget(modelToFields(fullModel()), peerFields()));
    // Next push: pushBudgetMerged re-reads the remote doc in a transaction and merges local on top.
    const pushed = mergeBudget(modelToFields(local), peerFields());
    expect(pushed[FORWARD]).toEqual({ v: 400000, hlc: PEER_HLC });
  });

  it('and survives the SAME tie re-run in the reverse direction (it did not self-heal)', () => {
    const local = fieldsToModel(mergeBudget(modelToFields(fullModel()), peerFields()));
    const other = mergeBudget(peerFields(), modelToFields(local));
    expect(other[FORWARD]).toEqual({ v: 400000, hlc: PEER_HLC });
  });

  it('a path for a leg outside the active pack is treated the same way', () => {
    const fields: BudgetFields = {
      ...modelToFields(fullModel()),
      'legBudgets.antarctica': { v: 900, hlc: PEER_HLC },
      'categoryBudgets.antarctica.food': { v: 25, hlc: PEER_HLC },
    };
    const pushedBack = modelToFields(fieldsToModel(fields));
    expect(pushedBack['legBudgets.antarctica']).toBeUndefined();
    expect(pushedBack['categoryBudgets.antarctica.food']).toBeUndefined();
    expect(mergeBudget(pushedBack, fields)['legBudgets.antarctica']).toEqual({ v: 900, hlc: PEER_HLC });
  });
});

describe('stampBudgetChanges — advances ONLY the changed leaf paths', () => {
  it('an edit to one leg budget stamps exactly that path (others keep their prior HLC)', () => {
    const prev: BudgetModel = {
      ...fullModel(),
      sync: { fieldHlc: { 'legBudgets.nepal': '000000000001000:000000:A', 'rates.NPR': '000000000001000:000000:A' } },
    };
    const next: BudgetModel = { ...prev, legBudgets: { ...prev.legBudgets, nepal: 22000 } };
    const stamped = stampBudgetChanges(prev, next, 5_000_000_000, 'B');
    expect(stamped.sync!.fieldHlc['rates.NPR']).toBe('000000000001000:000000:A'); // untouched
    expect(stamped.sync!.fieldHlc['legBudgets.nepal']).not.toBe('000000000001000:000000:A'); // advanced
    expect(stamped.sync!.fieldHlc['legBudgets.nepal'] > '000000000001000:000000:A').toBe(true); // monotonic
  });

  it('clearing a category stamps that (now-absent) path so the clear propagates', () => {
    const prev: BudgetModel = { ...fullModel(), sync: { fieldHlc: {} } };
    const next: BudgetModel = { ...prev, categoryBudgets: { nepal: { hotel: 5000 }, japan: { food: 9000 } } };
    const stamped = stampBudgetChanges(prev, next, 5_000_000_000, 'B');
    expect(stamped.sync!.fieldHlc['categoryBudgets.nepal.food']).toBeDefined(); // the cleared path is stamped
  });
});
