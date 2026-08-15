// @vitest-environment jsdom
//
// S408 — "claim my old name", extended from the itinerary (S396/Q3) to the two other stores that
// carry a display name: EXPENSES (`createdBy`/`updatedBy`) and DOCUMENTS (`updatedBy`). Exercised
// by RENDERING the real hooks (the same renderHook shim the sibling use-expenses-*/use-docs suites
// use — no new dependency) and reading back through the StoragePort, i.e. what a reload would show.
//
// ── 🔴 THE MONEY GUARD IS THE POINT OF THIS FILE ─────────────────────────────────────────────
// `Expense.paidBy` and `Expense.split[]` hold DISPLAY-NAME STRINGS, not stable ids — the field
// comment in core/budget/expenses.ts calls them "TRAVELERS id" and it reads safer than the code is
// (e2e/expenses.spec.ts pins ['Powan','Sushil','Uttam'] literally). So a name rewrite genuinely
// COULD reach them. It must not: `core/budget/settlement.ts` de-duplicates the split members before
// dividing —
//     const members = uniq(e.split.filter(…));  …  const share = amount / members.length;
// — so renaming 'Traveler' → 'Powan' inside a split that ALREADY contains 'Powan' collapses two
// members into one, DROPS THE DIVISOR, and silently re-points every balance and every transfer.
// The seed below is built to make exactly that happen if the rewrite ever widens: `exp-shared` is
// paid by 'Traveler', split ['Traveler','Powan'].
//
// ── AND THE SYNC STAMP, PROVEN NOT ASSERTED ──────────────────────────────────────────────────
// Neither store has a migration mechanism or a version field, and both merge last-write-wins on
// `hlc`/`rev` (core/sync/merge-items.ts). A rewrite that does not bump those passes every test and
// is silently unwound by the next remote snapshot. So the merge is RUN here against a stale peer
// copy, with a negative control showing what happens WITHOUT the bump.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ExpenseStore } from '@/hooks/use-expenses';
import type { DocsStore } from '@/hooks/use-docs';
import type { Expense } from '@/core/budget/expenses';
import type { DocItem } from '@/core/docs/model';

const state = vi.hoisted(() => ({ remoteOn: true }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
// Keep the fan-out off firebase — this suite exercises the STORES' local rewrite + stamping only.
vi.mock('@/lib/expenses-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/expenses-ports')>();
  return {
    ...orig,
    expensesSyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => state.remoteOn },
  };
});
vi.mock('@/lib/docs-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/docs-ports')>();
  return {
    ...orig,
    docsSyncPort: { push: async () => {}, subscribe: () => () => {}, isConfigured: () => state.remoteOn },
  };
});

import { useExpenses } from '@/hooks/use-expenses';
import { useDocs } from '@/hooks/use-docs';
import { settle } from '@/core/budget/settlement';
import { mergeItems } from '@/core/sync/merge-items';
import { serialize } from '@/core/sync/hlc';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { setUserName } from '@/lib/identity';

const DOCS_KEY = 'nepal_japan_docs_checklist';
const OLD = 'Traveler'; // the login placeholder AND, ambiguously, the owner's pre-rename name
const ME = 'Powan';
const ROSTER = [ME, 'Sushil', 'Uttam'];
/** A peer's stamp from BEFORE the claim — the "stale remote copy" the merge must lose to. */
const SEED_HLC = serialize({ pt: Date.parse('2026-01-05T09:00:00.000Z'), ct: 0, actor: 'peer-device' });

// ── The renderHook shim (verbatim shape of use-expenses-sync.test.ts / use-docs.test.ts) ──────
function renderStore<S>(useStore: () => S) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: S } = { current: null as unknown as S };
  function Probe() {
    ref.current = useStore();
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    get current() {
      return ref.current;
    },
    async run(fn: (store: S) => void) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Six expenses, seeded straight to disk so the test controls every byte.
 * The money in here is REAL: `exp-shared` is a 3000 NPR bill fronted by 'Traveler' and split with
 * 'Powan'. Claiming the NAME must leave that settlement untouched.
 *
 * The last two rows exist because the fixture was too narrow to prove what this file claims:
 * `exp-dead` was the ONLY row with `paidBy` absent, and the rewrite skips a tombstone BEFORE any
 * money field is read — so deleting the `paidBy` handling entirely would have left it green. And
 * every row carried `SEED_HLC`, so nothing exercised a row the sync stamps have never touched.
 */
function seedExpenses(): Expense[] {
  return [
    // 🔴 The dangerous row. `paidBy` is the old name; `split` contains BOTH the old name and the
    // claiming name — so a widened rewrite would produce ['Powan','Powan'] → uniq → 1 member.
    {
      id: 'exp-shared',
      leg: 'nepal',
      category: 'food',
      amount: 3000,
      createdAt: '2026-01-05T09:00:00.000Z',
      paidBy: OLD,
      split: [OLD, ME],
      createdBy: OLD,
      updatedBy: OLD,
      rev: 1,
      hlc: SEED_HLC,
    },
    // Attribution is the old name, but the money names are someone else's entirely.
    {
      id: 'exp-mine',
      leg: 'nepal',
      category: 'transportation',
      amount: 1200,
      createdAt: '2026-01-05T10:00:00.000Z',
      paidBy: 'Sushil',
      split: ['Sushil', 'Uttam'],
      createdBy: OLD,
      updatedBy: 'Sushil',
      rev: 1,
      hlc: SEED_HLC,
    },
    // Nobody else's row may be touched.
    {
      id: 'exp-other',
      leg: 'japan',
      category: 'food',
      amount: 4000,
      createdAt: '2026-01-05T11:00:00.000Z',
      paidBy: 'Uttam',
      split: ['Uttam', 'Sushil'],
      createdBy: 'Uttam',
      updatedBy: 'Uttam',
      rev: 1,
      hlc: SEED_HLC,
    },
    // A tombstone stamped with the old name: invisible to the UI and to the count the user
    // approved, so it must be skipped (not rewritten, not revived, not re-stamped).
    {
      id: 'exp-dead',
      leg: 'nepal',
      category: 'food',
      amount: 500,
      createdAt: '2026-01-05T12:00:00.000Z',
      createdBy: OLD,
      updatedBy: OLD,
      deleted: true,
      rev: 2,
      hlc: SEED_HLC,
    },
    // 🔴 A LIVE row with NO `paidBy` — the shape the dialog writes when the payer was left implicit
    // ("absent ⇒ the current traveler", core/budget/expenses.ts:57). This is the row that gives the
    // absent-field case discriminating power: it IS claimed, so the rewrite reaches it, and a
    // rewrite that "helpfully" filled the field in would show up in `moneyBytes` as an added key.
    // It carries a real 800 NPR and a real two-person split, and since D-328 `settle()` attributes
    // it to NOBODY — the reason a rename can no longer move its balance (see the settle test below).
    {
      id: 'exp-nopayer',
      leg: 'nepal',
      category: 'sightseeing',
      amount: 800,
      createdAt: '2026-01-05T13:00:00.000Z',
      split: [OLD, ME],
      createdBy: OLD,
      updatedBy: OLD,
      rev: 1,
      hlc: SEED_HLC,
    },
    // A LEGACY row: written before sync existed, so it carries NEITHER `rev` NOR `hlc`. The stamp
    // helpers are total over that (`prev?.hlc ? parse(…) : null`, `(prev?.rev ?? 1) + 1`), and
    // `mergeItems` seeds a missing `hlc` from `updatedAt`, which an Expense does not have — so the
    // peer's un-rewritten copy sits at pt 0 and the claimed row must win the merge outright.
    {
      id: 'exp-legacy',
      leg: 'japan',
      category: 'shopping',
      amount: 2500,
      createdAt: '2026-01-05T14:00:00.000Z',
      paidBy: OLD,
      split: [OLD, 'Uttam'],
      createdBy: OLD,
      updatedBy: OLD,
    },
  ];
}

function seedDocs(): DocItem[] {
  return [
    {
      id: 'passport-validity',
      section: 'critical',
      label: 'Passport valid 6+ months beyond Jan 2027',
      checked: true,
      updatedBy: OLD,
      updatedAt: '2026-01-05T09:00:00.000Z',
      rev: 1,
      hlc: SEED_HLC,
    },
    {
      id: 'nepal-visa',
      section: 'critical',
      label: 'Nepal visa on arrival (or pre-approval) sorted',
      checked: true,
      note: 'USD 50 on arrival',
      updatedBy: OLD,
      updatedAt: '2026-01-05T09:30:00.000Z',
      rev: 3,
      hlc: SEED_HLC,
    },
    {
      id: 'online-checkin',
      section: 'dayzero',
      label: 'Online check-in completed',
      checked: true,
      updatedBy: 'Sushil',
      updatedAt: '2026-01-05T10:00:00.000Z',
      rev: 1,
      hlc: SEED_HLC,
    },
  ];
}

function storedExpenses(): Expense[] {
  const blob = localStorage.getItem(STORAGE_KEYS.expenses);
  return blob ? (JSON.parse(blob) as Expense[]) : [];
}
function storedExpense(id: string): Expense | undefined {
  return storedExpenses().find((e) => e.id === id);
}
function storedDocs(): DocItem[] {
  const blob = localStorage.getItem(DOCS_KEY);
  return blob ? (JSON.parse(blob) as DocItem[]) : [];
}
function storedDoc(id: string): DocItem | undefined {
  return storedDocs().find((i) => i.id === id);
}

/** The exact money bytes of every row, as a string — the byte-identity assertion's subject. */
function moneyBytes(list: readonly Expense[]): string {
  return JSON.stringify(list.map((e) => ({ id: e.id, paidBy: e.paidBy, split: e.split })));
}

/**
 * Every key whose value DIFFERS between two rows, sorted — derived by diffing, never by listing
 * the fields we expect to be equal.
 *
 * That direction is the whole point. The money guard above pins `paidBy`/`split`, but they are not
 * the only fields that matter: `expensesToSpent` (core/budget/expenses.ts) rolls the budget up from
 * `category` + `amount`, and `settle()` cannot see `category` at all — so a claim that corrupted
 * `category` on a CLAIMED row would sail past both the byte-identity check and the settle check.
 * The `exp-other` assertion does not cover it either: that row is never touched.
 *
 * The key set is the UNION of both objects' keys, so a field ADDED or DROPPED by the rewrite shows
 * up as changed too, and a field added to `Expense`/`DocItem` in some future slice is covered here
 * automatically instead of silently escaping the check.
 */
function changedKeys(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

beforeEach(() => {
  localStorage.clear();
  setUserName(ME); // the rename already happened; this is who he is now
  localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(seedExpenses()));
  localStorage.setItem(DOCS_KEY, JSON.stringify(seedDocs()));
  state.remoteOn = true;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('S408 expenses — the money guard: a claim rewrites attribution and NOTHING that settles', () => {
  it('leaves paidBy and split BYTE-IDENTICAL while createdBy/updatedBy are actually rewritten', async () => {
    const before = moneyBytes(seedExpenses());
    const h = renderStore(useExpenses);
    let claimed = -1;
    await h.run((s) => {
      claimed = s.claimAuthorship(OLD);
    });

    // Four LIVE rows carry the old name in an attribution field (the tombstone is skipped).
    expect(claimed).toBe(4);
    // The guard would be vacuous if the claim had done nothing — prove it ran, on the two rows
    // amendment 7 added as well as the originals.
    expect(storedExpense('exp-shared')?.createdBy).toBe(ME);
    expect(storedExpense('exp-shared')?.updatedBy).toBe(ME);
    expect(storedExpense('exp-mine')?.createdBy).toBe(ME);
    expect(storedExpense('exp-nopayer')?.updatedBy).toBe(ME);
    expect(storedExpense('exp-legacy')?.updatedBy).toBe(ME);
    // The absent field STAYS absent: the rewrite never invents a payer for the implicit-payer row.
    expect('paidBy' in (storedExpense('exp-nopayer') as Expense)).toBe(false);
    // Per FIELD: Sushil keeps the edit that is genuinely his.
    expect(storedExpense('exp-mine')?.updatedBy).toBe('Sushil');

    // 🔴 …and not one byte of the money names moved.
    expect(moneyBytes(storedExpenses())).toBe(before);
    expect(storedExpense('exp-shared')?.paidBy).toBe(OLD);
    expect(storedExpense('exp-shared')?.split).toEqual([OLD, ME]);
    h.unmount();
  });

  it('settle() returns the IDENTICAL balances and transfers before and after the claim', async () => {
    const before = settle(seedExpenses(), ROSTER);
    // A vacuous guard would pass on two empty arrays — pin that there is real money at stake.
    expect(before.length).toBeGreaterThan(0);
    expect(before.flatMap((l) => l.transfers).length).toBeGreaterThan(0);

    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));

    expect(settle(storedExpenses(), ROSTER)).toEqual(before);
    h.unmount();
  });

  it('REGRESSION (D-328): the two sides of the rename settle IDENTICALLY', async () => {
    // `exp-nopayer` is live, split ['Traveler','Powan'] and worth 800 NPR — everything a settling
    // row needs except a payer. It used to be attributed to the signed-in traveller, so a claim,
    // which changes who is signed in from 'Traveler' to 'Powan', moved 800 NPR of balance onto the
    // new name while every byte of `paidBy`/`split` sat still. The byte-identity guard above is
    // blind to that by construction: no byte moved. This is the assertion that sees it.
    //
    // 🔴 The identity has to be SUPPLIED to be disproved. The removed `self` was optional, so the
    // defective code also returned the right answer when called with two arguments — see the long
    // note in `settlement.test.ts`. Both calls below carry an identity; on the pre-D-328 code they
    // differ by that 800, which is the defect this test exists for.
    const settleAs = settle as unknown as (
      expenses: readonly Expense[],
      travelers: readonly string[],
      self?: string,
    ) => unknown;
    expect(settleAs(seedExpenses(), ROSTER, OLD)).toEqual(settleAs(seedExpenses(), ROSTER, ME));

    // …and the row is genuinely inert, not merely equal on both sides: dropping it changes nothing.
    const before = settle(seedExpenses(), ROSTER);
    expect(settle(seedExpenses().filter((e) => e.id !== 'exp-nopayer'), ROSTER)).toEqual(before);

    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));
    expect(settle(storedExpenses(), ROSTER)).toEqual(before);
    expect(storedExpense('exp-nopayer')?.split).toEqual([OLD, ME]); // still a real, still-split row
    h.unmount();
  });

  it('spares other travellers and tombstones, and never re-stamps createdAt', async () => {
    const seed = seedExpenses();
    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));

    expect(storedExpense('exp-other')).toEqual(seed[2]); // untouched, byte for byte
    const dead = storedExpense('exp-dead');
    expect(dead?.deleted).toBe(true);
    expect(dead?.createdBy).toBe(OLD);
    expect(dead?.rev).toBe(2); // not re-stamped
    // `createdAt` is the list's sort key — a claim must not re-date an old expense.
    expect(storedExpense('exp-shared')?.createdAt).toBe(seed[0].createdAt);
    expect(storedExpense('exp-mine')?.createdAt).toBe(seed[1].createdAt);
    h.unmount();
  });

  it('a CLAIMED row differs from its seed in EXACTLY the attribution + sync keys, nothing else', async () => {
    const seed = seedExpenses();
    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));

    // Both author fields matched → both flip, plus the two ordering stamps. `category`, `amount`,
    // `leg`, `createdAt`, `paidBy`, `split`, `id` are all in the diff's scope and all absent from
    // this list, so corrupting ANY of them fails here.
    expect(changedKeys(seed[0], storedExpense('exp-shared') as Expense)).toEqual([
      'createdBy',
      'hlc',
      'rev',
      'updatedBy',
    ]);
    // Only `createdBy` matched on this one — proof the rewrite is per FIELD, from the same diff.
    expect(changedKeys(seed[1], storedExpense('exp-mine') as Expense)).toEqual([
      'createdBy',
      'hlc',
      'rev',
    ]);
    // The `paidBy`-absent row. `changedKeys` unions BOTH key sets, so `paidBy` appearing out of
    // nowhere lands in this list and fails here — the discriminating power the tombstone never had.
    expect(changedKeys(seed[4], storedExpense('exp-nopayer') as Expense)).toEqual([
      'createdBy',
      'hlc',
      'rev',
      'updatedBy',
    ]);
    // The legacy row: `hlc` and `rev` are ADDED (absent in the seed), which the union catches the
    // same way — a claim that left an unstamped row unstamped would come back missing them.
    expect(changedKeys(seed[5], storedExpense('exp-legacy') as Expense)).toEqual([
      'createdBy',
      'hlc',
      'rev',
      'updatedBy',
    ]);
    expect(storedExpense('exp-legacy')?.rev).toBe(2); // (undefined ?? 1) + 1

    // Same invariant for a document: `updatedBy` is its only identity field.
    const hd = renderStore(useDocs);
    await hd.run((s) => s.claimAuthorship(OLD));
    expect(changedKeys(seedDocs()[0], storedDoc('passport-validity') as DocItem)).toEqual([
      'hlc',
      'rev',
      'updatedBy',
    ]);
    hd.unmount();
    h.unmount();
  });

  it('refuses the no-op cases (blank / own name / nobody) and writes nothing at all', async () => {
    const h = renderStore(useExpenses);
    let blank = -1;
    let own = -1;
    let unknown = -1;
    await h.run((s) => {
      blank = s.claimAuthorship('   ');
      own = s.claimAuthorship(ME);
      unknown = s.claimAuthorship('Nobody');
    });
    expect([blank, own, unknown]).toEqual([0, 0, 0]);
    expect(storedExpenses()).toEqual(seedExpenses());
    h.unmount();
  });

  it('DORMANT (D-038): rewrites the names with NO rev/hlc advanced', async () => {
    state.remoteOn = false;
    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));
    expect(storedExpense('exp-shared')?.createdBy).toBe(ME);
    expect(storedExpense('exp-shared')?.rev).toBe(1); // unchanged from the seed
    expect(storedExpense('exp-shared')?.hlc).toBe(SEED_HLC);
    expect(moneyBytes(storedExpenses())).toBe(moneyBytes(seedExpenses()));
    h.unmount();
  });
});

describe('S408 documents — updatedBy is the only identity field, and the only one that moves', () => {
  it('rewrites updatedBy per row, preserves updatedAt/note/checked, spares other travellers', async () => {
    const seed = seedDocs();
    const h = renderStore(useDocs);
    let claimed = -1;
    await h.run((s) => {
      claimed = s.claimAuthorship(OLD);
    });

    expect(claimed).toBe(2);
    expect(storedDoc('passport-validity')?.updatedBy).toBe(ME);
    expect(storedDoc('nepal-visa')?.updatedBy).toBe(ME);
    expect(storedDoc('online-checkin')).toEqual(seed[2]); // Sushil's row, byte for byte

    // `updatedAt` is the SyncedRow legacy-HLC seed AND the itinerary claim's precedent: a name
    // fix must never re-date the edit.
    expect(storedDoc('passport-validity')?.updatedAt).toBe(seed[0].updatedAt);
    expect(storedDoc('nepal-visa')?.updatedAt).toBe(seed[1].updatedAt);
    expect(storedDoc('nepal-visa')?.note).toBe('USD 50 on arrival');
    expect(storedDoc('nepal-visa')?.checked).toBe(true);
    h.unmount();
  });

  it('refuses the no-op cases and writes nothing at all', async () => {
    const h = renderStore(useDocs);
    let blank = -1;
    let own = -1;
    let unknown = -1;
    await h.run((s) => {
      blank = s.claimAuthorship('  ');
      own = s.claimAuthorship(ME);
      unknown = s.claimAuthorship('Nobody');
    });
    expect([blank, own, unknown]).toEqual([0, 0, 0]);
    expect(storedDocs()).toEqual(seedDocs());
    h.unmount();
  });

  it('DORMANT (D-038): rewrites updatedBy with NO rev/hlc advanced', async () => {
    state.remoteOn = false;
    const h = renderStore(useDocs);
    await h.run((s) => s.claimAuthorship(OLD));
    expect(storedDoc('passport-validity')?.updatedBy).toBe(ME);
    expect(storedDoc('passport-validity')?.rev).toBe(1);
    expect(storedDoc('passport-validity')?.hlc).toBe(SEED_HLC);
    h.unmount();
  });
});

describe('S408 — the claim SURVIVES a remote merge (run, not asserted)', () => {
  /** The peer still holds the pre-claim row: same id, same seed stamp, still the old name. */
  const stalePeerExpense = () => seedExpenses().find((e) => e.id === 'exp-shared') as Expense;
  const stalePeerDoc = () => seedDocs().find((i) => i.id === 'passport-validity') as DocItem;

  it('a claimed EXPENSE beats the peer’s un-rewritten copy through mergeItems', async () => {
    const h = renderStore(useExpenses);
    await h.run((s) => s.claimAuthorship(OLD));
    const local = storedExpense('exp-shared') as Expense;

    // The real merge — the one lib/expenses-remote.ts runs on EVERY remote snapshot — keeps the
    // claim, in BOTH argument orders (the merge is commutative, D-106). Asserted FIRST so that
    // deleting the rev/hlc bump fails on the OUTCOME (the claim is unwound), not on a proxy.
    expect(mergeItems([local], [stalePeerExpense()])[0].createdBy).toBe(ME);
    expect(mergeItems([stalePeerExpense()], [local])[0].createdBy).toBe(ME);
    // …and the money still did not move through the merge either.
    expect(mergeItems([local], [stalePeerExpense()])[0].split).toEqual([OLD, ME]);

    // The mechanism that makes the above true.
    expect(local.rev).toBe(2);
    expect((local.hlc ?? '') > SEED_HLC).toBe(true);

    // Same, for the LEGACY row that had no `hlc` to advance from: the peer's copy still has none,
    // so `mergeItems` seeds it from an absent `updatedAt` (pt 0) and the claim wins outright.
    const legacy = storedExpense('exp-legacy') as Expense;
    const stalePeerLegacy = seedExpenses().find((e) => e.id === 'exp-legacy') as Expense;
    expect(stalePeerLegacy.hlc).toBeUndefined();
    expect(mergeItems([legacy], [stalePeerLegacy])[0].createdBy).toBe(ME);
    expect(mergeItems([stalePeerLegacy], [legacy])[0].createdBy).toBe(ME);
    expect(mergeItems([legacy], [stalePeerLegacy])[0].paidBy).toBe(OLD); // money, still the old name
    h.unmount();
  });

  it('a claimed DOCUMENT beats the peer’s un-rewritten copy through mergeItems', async () => {
    const h = renderStore(useDocs);
    await h.run((s) => s.claimAuthorship(OLD));
    const local = storedDoc('passport-validity') as DocItem;

    expect(mergeItems([local], [stalePeerDoc()])[0].updatedBy).toBe(ME);
    expect(mergeItems([stalePeerDoc()], [local])[0].updatedBy).toBe(ME);

    expect(local.rev).toBe(2);
    expect((local.hlc ?? '') > SEED_HLC).toBe(true);
    h.unmount();
  });

  it('NEGATIVE CONTROL: the same rename WITHOUT the rev/hlc bump is unwound by that merge', () => {
    // Exactly what a "rename the field and move on" implementation would produce: the new name,
    // the OLD stamp. With equal HLCs `resolvePair` falls through to its last-resort content
    // fingerprint tie-break — i.e. the winner is decided by something the claim does not control,
    // and here the peer's stale copy takes the row straight back.
    const unbumped: Expense = { ...stalePeerExpense(), createdBy: ME, updatedBy: ME };
    expect(mergeItems([unbumped], [stalePeerExpense()])[0].createdBy).toBe(OLD);

    const unbumpedDoc: DocItem = { ...stalePeerDoc(), updatedBy: ME };
    expect(mergeItems([unbumpedDoc], [stalePeerDoc()])[0].updatedBy).toBe(OLD);
  });
});
