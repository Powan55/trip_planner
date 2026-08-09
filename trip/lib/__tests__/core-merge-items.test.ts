import { describe, it, expect } from 'vitest';
import {
  mergeItems,
  resolvePair,
  gcTombstoneRows,
  DEFAULT_GC_HORIZON_MS,
  type SyncedRow,
  type MergePolicy,
} from '@/core/sync/merge-items';
import { serialize, type Hlc } from '@/core/sync/hlc';

/**
 * S142 — the id-keyed row merge (`core/sync/merge-items.ts`, D-149). This is the
 * generalization `mergeDay` now delegates to; here it is exercised DIRECTLY over a minimal
 * `SyncedRow` (id + rev/hlc/deleted) so the merge algebra is proven independent of the itinerary
 * `DayPlan` wrapper — the same algebra expenses reuse. Covers: concurrent add/edit/delete
 * convergence, HLC tie-break, tombstone-beats-stale-edit, non-vacuity, commutativity + idempotence.
 */

interface Row extends SyncedRow {
  id: string;
  label: string;
}

const H = (pt: number, ct: number, actor: string): Hlc => ({ pt, ct, actor });

function row(id: string, hlc: Hlc, extra: Partial<Row> = {}): Row {
  return { id, label: `row-${id}`, rev: 1, hlc: serialize(hlc), deleted: false, ...extra };
}

function rowMap(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((r) => [r.id, r]));
}

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

describe('mergeItems — concurrent add: different ids on each side both survive (the headline fix)', () => {
  it('local adds A, remote adds B → merged set has both', () => {
    const merged = mergeItems([row('A', H(100, 0, 'L'))], [row('B', H(200, 0, 'R'))]);
    expect(merged.map((r) => r.id).sort()).toEqual(['A', 'B']);
  });
});

describe('gcTombstoneRows — the id-keyed GC analog for expenses (S145, D-153): prunes old, keeps live+recent', () => {
  const now = 1_000_000_000_000;

  it('drops a tombstone older than the horizon that no live row references', () => {
    const oldPt = now - DEFAULT_GC_HORIZON_MS - 1;
    const rows = [
      row('LIVE', H(now, 0, 'a')),
      row('OLDGHOST', H(oldPt, 0, 'a'), { deleted: true }),
    ];
    expect(gcTombstoneRows(rows, now).map((r) => r.id)).toEqual(['LIVE']);
  });

  it('KEEPS a recent tombstone (inside the horizon) so it can still propagate', () => {
    const recentPt = now - 1000;
    const rows = [row('RECENTGHOST', H(recentPt, 0, 'a'), { deleted: true })];
    expect(gcTombstoneRows(rows, now).map((r) => r.id)).toEqual(['RECENTGHOST']);
  });

  it('NEVER drops a live row, however old its stamp (structurally unable to lose a live row)', () => {
    const ancient = now - DEFAULT_GC_HORIZON_MS * 10;
    const rows = [row('ANCIENTLIVE', H(ancient, 0, 'a'), { deleted: false })];
    expect(gcTombstoneRows(rows, now).map((r) => r.id)).toEqual(['ANCIENTLIVE']);
  });

  it('KEEPS an old tombstone that IS referenced by a live row of the same id', () => {
    const oldPt = now - DEFAULT_GC_HORIZON_MS - 1;
    const rows = [
      row('A', H(now, 0, 'a'), { deleted: false }),
      row('A', H(oldPt, 0, 'a'), { deleted: true }),
    ];
    expect(gcTombstoneRows(rows, now)).toHaveLength(2);
  });

  it('empty/absent input is a safe no-op', () => {
    expect(gcTombstoneRows([], now)).toEqual([]);
  });
});

describe('mergeItems — concurrent edit: same id, higher HLC wins (deterministic, arg-order-free)', () => {
  it('remote higher HLC → remote content wins; loser fully replaced', () => {
    const local = [row('A', H(100, 0, 'L'), { label: 'old' })];
    const remote = [row('A', H(300, 0, 'R'), { label: 'new' })];
    expect(mergeItems(local, remote)[0].label).toBe('new');
    expect(mergeItems(remote, local)[0].label).toBe('new'); // commutative on the collision
  });

  it('equal pt+ct → higher ACTOR string wins (final deterministic tie-break)', () => {
    const a = [row('A', H(100, 0, 'actorA'), { label: 'fromA' })];
    const b = [row('A', H(100, 0, 'actorB'), { label: 'fromB' })];
    expect(mergeItems(a, b)[0].label).toBe('fromB'); // 'actorB' > 'actorA'
    expect(mergeItems(b, a)[0].label).toBe('fromB');
  });
});

describe('mergeItems — tombstone beats a STALE live edit; a STRICTLY-LATER edit resurrects', () => {
  it('a tombstone with the higher HLC keeps a lower-HLC live edit deleted (delete wins)', () => {
    const deleted = [row('A', H(300, 0, 'L'), { deleted: true })];
    const staleEdit = [row('A', H(100, 0, 'R'), { deleted: false, label: 'stale' })];
    const merged = mergeItems(deleted, staleEdit);
    expect(merged.filter((r) => r.deleted !== true)).toHaveLength(0); // hidden from the live view
    expect(rowMap(merged).get('A')!.deleted).toBe(true);
  });

  it('a strictly-later live edit (higher HLC) resurrects the item (policy hlc default)', () => {
    const deleted = [row('A', H(100, 0, 'L'), { deleted: true })];
    const laterEdit = [row('A', H(500, 0, 'R'), { deleted: false, label: 'restored' })];
    const merged = mergeItems(deleted, laterEdit);
    expect(merged[0].deleted).toBe(false);
    expect(merged[0].label).toBe('restored');
  });

  it("policy 'always' → any tombstone beats any concurrent edit regardless of HLC", () => {
    const policy: MergePolicy = { deleteWins: 'always' };
    const deleted = [row('A', H(100, 0, 'L'), { deleted: true })];
    const laterEdit = [row('A', H(999, 0, 'R'), { deleted: false })];
    expect(mergeItems(deleted, laterEdit, policy)[0].deleted).toBe(true);
    expect(mergeItems(laterEdit, deleted, policy)[0].deleted).toBe(true);
  });
});

describe('mergeItems — NON-VACUOUS: a wrong-HLC expectation actually fails', () => {
  it('the LOWER-HLC edit does NOT win (guards against a merge that ignores hlc)', () => {
    const lower = [row('A', H(100, 0, 'L'), { label: 'lower' })];
    const higher = [row('A', H(200, 0, 'R'), { label: 'higher' })];
    const merged = mergeItems(lower, higher);
    // If the merge were vacuous (e.g. always kept `local`), this assertion would fail.
    expect(merged[0].label).toBe('higher');
    expect(merged[0].label).not.toBe('lower');
  });
});

describe('mergeItems — ordering: live rows hlc-asc, tombstones appended (id tie-break)', () => {
  it('merged live rows are sorted by winning hlc ascending; tombstones trail', () => {
    const local = [row('C', H(300, 0, 'x')), row('GHOST', H(50, 0, 'x'), { deleted: true })];
    const remote = [row('A', H(100, 0, 'x')), row('B', H(200, 0, 'x'))];
    const merged = mergeItems(local, remote);
    expect(merged.filter((r) => !r.deleted).map((r) => r.id)).toEqual(['A', 'B', 'C']);
    expect(merged.map((r) => r.id)).toEqual(['A', 'B', 'C', 'GHOST']);
  });
});

describe('mergeItems — COMMUTATIVITY + IDEMPOTENCE (the convergence proof)', () => {
  it('over 500 randomized row-set pairs: merge(a,b) ≡ merge(b,a) AND merge is idempotent', () => {
    const r = rng(9182);
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const actors = ['u1', 'u2', 'u3'];
    const randRow = (id: string): Row =>
      row(id, H(Math.floor(r() * 6), Math.floor(r() * 3), actors[Math.floor(r() * actors.length)]), {
        deleted: r() < 0.25,
        label: `l-${id}-${Math.floor(r() * 1000)}`,
      });
    const randSet = (): Row[] => ids.filter(() => r() < 0.6).map(randRow);

    let commutativeFailures = 0;
    let idempotenceFailures = 0;
    for (let trial = 0; trial < 500; trial++) {
      const a = randSet();
      const b = randSet();
      const ab = mergeItems(a, b);
      const ba = mergeItems(b, a);
      const key = (m: Row[]) => JSON.stringify([...rowMap(m).entries()].sort());
      if (key(ab) !== key(ba)) commutativeFailures++;
      if (key(mergeItems(a, ab)) !== key(ab)) idempotenceFailures++;
    }
    expect(commutativeFailures).toBe(0);
    expect(idempotenceFailures).toBe(0);
  });
});

describe('resolvePair — the extracted per-id resolver is exported + generic', () => {
  it('picks the higher-HLC row for a same-id collision (the whole conflict decision)', () => {
    const a = row('A', H(100, 0, 'L'), { label: 'a' });
    const b = row('A', H(200, 0, 'R'), { label: 'b' });
    expect(resolvePair(a, b, { deleteWins: 'hlc' }).label).toBe('b');
    expect(resolvePair(b, a, { deleteWins: 'hlc' }).label).toBe('b');
  });
});
