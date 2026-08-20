// @vitest-environment jsdom
//
// S234 — multi-trip isolation: sync-path spot check + local-storage scope probe.
//
// TWO independent proofs, both on a REAL run (real gateway, real getTripId, real save paths;
// only the firebase SDK is faked so the write TARGET can be observed):
//
//   PART A (remote write path) — every *-remote module composes `doc(db, 'trips', getTripId(), …)`.
//     Proves the getTripId() wiring flips with the active-pack pointer: a NON-default pack's remote
//     writes target `trips/{token}/…` and NEVER the default's `trips/nepal-japan-2026/…` (and the
//     default pack targets its own remote token). This is the D-205 capability-path guarantee.
//
//   PART B (local storage scope regression) — S235 FIXED the S234-F1 bleed: EVERY trip-scoped
//     domain's gateway accessor now routes through `keyFor(slot)` (not the raw `STORAGE_KEYS.x`
//     literal), so on a non-default pack every domain namespaces to `trip:{token}:{slot}` and NEVER
//     touches the default pack's legacy literal key. This suite is TABLE-DRIVEN over the whole
//     `TripScopedSlot` union so a future slot that forgets `keyFor` regresses HERE, and it proves
//     the D-172 grandfather (default pack → the exact legacy literal, byte-identical). Inverts the
//     old S234 probe that pinned the buggy behavior. See docs/multi-trip-audit.md + D-214/D-218.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

import {
  setActiveTripId,
  DEFAULT_TRIP_ID,
  keyFor,
  STORAGE_KEYS,
  weatherCache,
  budgetStore,
  expensesStore,
  journalStore,
  favoritesStore,
  photosStore,
  packingStore,
  dayAnchorStore,
  shareInboxStore,
  docsStore,
  TRIP_SCOPED_SLOTS,
  type TripScopedSlot,
} from '@/core/storage/gateway';
import { getTripId, isTripRemoteConfigured } from '@/lib/firebase-config';
import { pushChunkMerged } from '@/lib/expenses-remote';
import { pushDayMerged } from '@/lib/itinerary-remote';
import { savePlans } from '@/lib/itinerary-storage';
import type { Expense } from '@/core/budget/expenses';
import type { DayPlan } from '@/lib/trip-data';

const CAP_TOKEN = 'cap-token-aaaa-bbbb-cccc-dddddddddddd';

// A minimal fake `fs` (doc + runTransaction) that records the doc path a write targets. pushChunkMerged
// / pushDayMerged take `db` + `fs` by injection and only call `getTripId()` internally — so nothing
// else needs faking to observe the path.
function makeFakeFs() {
  const writtenPaths: string[] = [];
  const fs = {
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    runTransaction: async (
      _db: unknown,
      update: (tx: {
        get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => undefined }>;
        set: (ref: { path: string }, data: unknown) => void;
      }) => Promise<void>,
    ) => {
      await update({
        get: async (_ref) => ({ exists: () => false, data: () => undefined }),
        set: (ref) => writtenPaths.push(ref.path),
      });
    },
  };
  return { fs: fs as unknown as Parameters<typeof pushChunkMerged>[1], writtenPaths };
}

const db = {} as unknown as Firestore;
const exp = (id: string): Expense => ({ id, leg: 'nepal', category: 'food', amount: 100, createdAt: 't', rev: 1, hlc: `1:0:${id}` });
const day = (): DayPlan => ({ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('S234 Part A — remote write path targets trips/{token} for the active pack', () => {
  it("DEFAULT pack: getTripId() is '' and the trip-scoped gate is closed (#10 — the sample has no remote path)", () => {
    // No pointer → getActiveTripId() === DEFAULT_TRIP_ID → getTripId() === '' (#10 retired the
    // NEXT_PUBLIC_TRIP_ID remote id; the default pack is a local-only sample). The old form of
    // this test drove pushChunkMerged/pushDayMerged here — those writers are now unreachable on
    // the default pack (every entry gate + the outbox check isTripRemoteConfigured), so the
    // load-bearing assertions are the empty id and the closed gate.
    expect(getTripId()).toBe('');
    expect(isTripRemoteConfigured()).toBe(false); // no firebase env in tests, AND no remote id
  });

  it('NON-default pack: writes target trips/{token} and NEVER the default remote path', async () => {
    setActiveTripId(CAP_TOKEN);
    expect(getTripId()).toBe(CAP_TOKEN);

    const { fs, writtenPaths } = makeFakeFs();
    await pushChunkMerged(db, fs, 'nepal', [exp('A')]);
    await pushDayMerged(db, fs, day());

    expect(writtenPaths).toEqual([
      `trips/${CAP_TOKEN}/expenses/nepal`,
      `trips/${CAP_TOKEN}/days/2026-12-10`,
    ]);
    // Belt-and-braces: the default trip's path segment appears nowhere.
    expect(writtenPaths.some((p) => p.includes(DEFAULT_TRIP_ID))).toBe(false);
  });
});

describe('S235 Part B — LOCAL storage scope: EVERY trip-scoped domain routes through keyFor', () => {
  // A write per domain, exercising the REAL accessor path (not keyFor directly), so a domain that
  // forgets keyFor writes the legacy literal and fails here. `savePlans`/`saveExpenses` go through
  // the same accessors as the rest; both are kept as the canonical public seams. `itineraryCorrupt`
  // and `syncOutbox` have no straightforward public setter (quarantine is corrupt-only; the outbox
  // self-gates on a configured build), so their keyFor mapping is covered by the union table below.
  const DOMAIN_WRITES: { slot: TripScopedSlot; write: () => void }[] = [
    { slot: 'itinerary', write: () => savePlans([]) },
    { slot: 'weatherCache', write: () => weatherCache.set('Kathmandu', { t: 1 }) },
    { slot: 'budget', write: () => budgetStore.set({ ok: 1 }) },
    { slot: 'expenses', write: () => expensesStore.set([exp('A')]) },
    { slot: 'journal', write: () => journalStore.set([{ date: '2026-12-10', text: 'x' }]) },
    { slot: 'favorites', write: () => favoritesStore.set(['na1']) },
    { slot: 'photos', write: () => photosStore.set([{ id: 'p1' }]) },
    { slot: 'packing', write: () => packingStore.set([{ id: 'k1' }]) },
    { slot: 'dayAnchors', write: () => dayAnchorStore.set({ '2026-12-10': 'm1' }) },
    { slot: 'shareInbox', write: () => shareInboxStore.set([{ id: 's1' }]) },
    { slot: 'docsChecklist', write: () => docsStore.set([{ id: 'd1' }]) },
  ];

  describe('DEFAULT pack — GRANDFATHER: writes land on the EXACT legacy literal, byte-identical (D-172)', () => {
    it.each(DOMAIN_WRITES)('$slot persists under its legacy literal, no trip: prefix', ({ slot, write }) => {
      write();
      const literal = STORAGE_KEYS[slot];
      expect(localStorage.getItem(literal)).not.toBeNull(); // legacy key present
      expect(keyFor(slot)).toBe(literal); // grandfather: keyFor returns the exact literal
      // No pack-scoped key was created for the default pack.
      expect(Object.keys(localStorage).some((k) => k.startsWith('trip:'))).toBe(false);
    });
  });

  describe('NON-default pack — every domain namespaces to trip:{token}:{slot}, NEVER the default key', () => {
    beforeEach(() => setActiveTripId(CAP_TOKEN));

    it.each(DOMAIN_WRITES)('$slot writes the scoped key and leaves the default literal untouched', ({ slot, write }) => {
      write();
      expect(localStorage.getItem(`trip:${CAP_TOKEN}:${slot}`)).not.toBeNull(); // scoped key written
      expect(localStorage.getItem(STORAGE_KEYS[slot])).toBeNull(); // default literal NOT touched
    });
  });

  // Full-union mapping guard — catches a slot added to TripScopedSlot that never gets an accessor
  // wired to keyFor (its write table entry can be missed, but its keyFor contract can't).
  // S352: the hand-maintained 13-slot copy formerly declared here is DELETED — it had already
  // drifted from the type (missing `myPlaces`, S284) — in favor of the canonical `TRIP_SCOPED_SLOTS`
  // export, so this guard covers whatever the union currently is (15 slots as of `expensesCorrupt`,
  // #100/A-10) automatically.

  it('DEFAULT pack: keyFor(slot) === the legacy literal for every slot (grandfather)', () => {
    for (const slot of TRIP_SCOPED_SLOTS) expect(keyFor(slot)).toBe(STORAGE_KEYS[slot]);
  });

  it('NON-default pack: keyFor(slot) === trip:{token}:{slot} for every slot, never the literal', () => {
    setActiveTripId(CAP_TOKEN);
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(keyFor(slot)).toBe(`trip:${CAP_TOKEN}:${slot}`);
      expect(keyFor(slot)).not.toBe(STORAGE_KEYS[slot]);
    }
  });
});
