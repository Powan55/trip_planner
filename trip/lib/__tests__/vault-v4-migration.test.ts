// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadItinerary,
  saveItinerary,
  type VaultConfig,
} from '@/core/vault/load-save';
import {
  runItineraryMigrations,
  itineraryMigrations,
  CURRENT_ITINERARY_VERSION,
} from '@/core/vault/migrations';
import { itineraryEnvelopeV4, parseItineraryPayload } from '@/core/vault/schema';
import { seedHlcFromLegacy } from '@/core/sync/hlc';
import type { DayPlan } from '@/lib/trip-data';

/**
 * Sync v2 — Vault v3→v4 migration unit suite (S96; D-104 LOCKED).
 *
 * Proves the appended v3→v4 backfill is a LOSSLESS additive migration: every legacy item
 * gains defaulted `rev`/`hlc`/`deleted` while every original field is preserved verbatim, and
 * a legacy `DayPlan[]` round-trips through saveItinerary/loadItinerary without loss. The
 * migration is PURE (no clock): `hlc` is DERIVED from `updatedAt` via `seedHlcFromLegacy`.
 */

const STORAGE_KEY = 'test_v4_itinerary';
const QUARANTINE_KEY = 'test_v4_itinerary_corrupt';
const FALLBACK: DayPlan[] = [{ date: '3000-01-01', city: 'Fallback', country: 'nepal', items: [] }];

// A realistic LEGACY (pre-Sync-v2) itinerary: NO rev/hlc/deleted on any item.
const LEGACY: DayPlan[] = [
  {
    date: '2026-12-09',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      {
        id: 'a1',
        title: 'Sunrise at Swayambhunath',
        category: 'photography',
        time: '06:00',
        duration: '2h',
        notes: '365 steps',
        location: 'Swayambhu Hill',
        sourceId: 'rec-42',
        sourceType: 'recommendation',
        createdBy: 'Alex',
        updatedBy: 'Sam',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ],
  },
  {
    date: '2026-12-19',
    city: 'Tokyo',
    country: 'japan',
    items: [{ id: 'b1', title: 'Ramen', category: 'food' }], // no updatedAt → hlc seeds pt=0
  },
];

let cfg: VaultConfig;

beforeEach(() => {
  localStorage.clear();
  cfg = { storageKey: STORAGE_KEY, quarantineKey: QUARANTINE_KEY, fallback: FALLBACK };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('v3→v4 migration step', () => {
  it('is APPEND-ONLY: the shipped chain is [v2→v3, v3→v4, v4→v5] and CURRENT is 5 (D-095 append rule)', () => {
    // S124 appended v4→v5 (D-139) and bumped CURRENT 4→5 — this change-detector tracks it in
    // lockstep. The v3→v4 behavioral assertions in this file are byte-unchanged.
    expect(CURRENT_ITINERARY_VERSION).toBe(5);
    expect(itineraryMigrations.map((m) => [m.from, m.to])).toEqual([[2, 3], [3, 4], [4, 5]]);
  });

  it('backfills each item losslessly: rev=1, hlc=seedHlcFromLegacy(updatedAt), deleted=false', () => {
    // Run only the v3→v4 step (from a v3 payload = the legacy DayPlan[]).
    const out = runItineraryMigrations(LEGACY, 3) as DayPlan[];
    const a1 = out[0].items[0];
    // Original fields preserved verbatim.
    expect(a1).toMatchObject(LEGACY[0].items[0]);
    // Defaults added.
    expect(a1.rev).toBe(1);
    expect(a1.deleted).toBe(false);
    expect(a1.hlc).toBe(seedHlcFromLegacy('2026-07-01T10:00:00.000Z')); // derived, deterministic
    // Item with no updatedAt seeds hlc from pt=0 (still a valid stamp).
    const b1 = out[1].items[0];
    expect(b1).toMatchObject(LEGACY[1].items[0]);
    expect(b1.hlc).toBe(seedHlcFromLegacy(undefined));
  });

  it('is DETERMINISTIC (no clock): running it twice yields byte-identical output', () => {
    const first = runItineraryMigrations(LEGACY, 3);
    const second = runItineraryMigrations(LEGACY, 3);
    expect(first).toEqual(second);
  });

  it('an empty [] and a day with no items survive the v3→v4 step', () => {
    expect(runItineraryMigrations([], 3)).toEqual([]);
    const noItems: DayPlan[] = [{ date: '2026-12-10', city: 'K', country: 'nepal', items: [] }];
    expect(runItineraryMigrations(noItems, 3)).toEqual(noItems);
  });

  it('#123 in the CHAIN: one unusable row is dropped, not fatal — a pre-v5 vault keeps its good days', () => {
    // The steps are whole-array `map`s, so `null.items` threw, `runItineraryMigrations` threw, and
    // loadItinerary quarantined the WHOLE vault back to the fallback — while the same bytes stamped
    // v5 (no migrations to run) lost only the bad row. `items: 5` is the same trap one level down.
    const good: DayPlan = { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] };
    const dirty = [null, good, { date: '2026-12-11', city: 'K', country: 'nepal', items: 5 }];

    expect(() => runItineraryMigrations(dirty, 3)).not.toThrow();
    expect(runItineraryMigrations(dirty, 3)).toEqual([good]);

    // End to end through the read path: v3 on disk ⇒ 1 day, no quarantine (NOT the 1-day FALLBACK).
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 3, updatedAt: 'x', payload: dirty }),
    );
    expect(loadItinerary(cfg)).toEqual([good]);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('respects an already-present field (does not clobber an item that already has rev/hlc/deleted)', () => {
    const already: DayPlan[] = [
      {
        date: '2026-12-10',
        city: 'K',
        country: 'nepal',
        items: [{ id: 'z', title: 'Z', category: 'food', rev: 7, hlc: 'existing', deleted: true }],
      },
    ];
    const out = runItineraryMigrations(already, 3) as DayPlan[];
    expect(out[0].items[0]).toMatchObject({ rev: 7, hlc: 'existing', deleted: true });
  });
});

describe('v4 schema', () => {
  it('the v4 envelope validates a schemaVersion:4 wrapper with a backfilled payload', () => {
    const payload = runItineraryMigrations(LEGACY, 3) as DayPlan[];
    const envelope = { schemaVersion: 4, updatedAt: '2026-07-05T00:00:00.000Z', payload };
    expect(itineraryEnvelopeV4.safeParse(envelope).success).toBe(true);
  });

  it('parseItineraryPayload (now v4) accepts items WITH the new fields and items WITHOUT them', () => {
    const mixed: DayPlan[] = [
      {
        date: '2026-12-10',
        city: 'K',
        country: 'nepal',
        items: [
          { id: 'has', title: 'H', category: 'food', rev: 2, hlc: 'abc', deleted: false },
          { id: 'hasnot', title: 'N', category: 'food' }, // legacy shape still valid
        ],
      },
    ];
    const parsed = parseItineraryPayload(mixed);
    expect(parsed).not.toBeNull();
    expect(parsed![0].items[0].rev).toBe(2);
    expect(parsed![0].items[1].rev).toBeUndefined(); // absent stays absent (optional)
  });
});

describe('v3-blob → v3→v4 → LOSSLESS round-trip through saveItinerary/loadItinerary (hard-acceptance)', () => {
  it('a legacy DayPlan[] loads (migrating to v4), gains defaults, and round-trips without loss', () => {
    // 1. Seed a LEGACY bare DayPlan[] on disk (the pre-Sync-v2, v2-shaped live-user case).
    localStorage.setItem(STORAGE_KEY, JSON.stringify(LEGACY));

    // 2. loadItinerary runs the full chain v2→v3→v4 and backfills.
    const loaded = loadItinerary(cfg);
    expect(loaded[0].items[0]).toMatchObject(LEGACY[0].items[0]); // original fields intact
    expect(loaded[0].items[0].rev).toBe(1);
    expect(loaded[0].items[0].deleted).toBe(false);
    expect(loaded[0].items[0].hlc).toBe(seedHlcFromLegacy('2026-07-01T10:00:00.000Z'));

    // 3. Persist the migrated value; the write path emits the CURRENT envelope (now v5 since
    //    S124 — the save-version literal tracks CURRENT in lockstep; the round-trip losslessness
    //    proven below is byte-unchanged).
    saveItinerary(loaded, cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);

    // 4. Re-load: already-current on disk ⇒ no migration re-runs; value is byte-identical (lossless).
    const reloaded = loadItinerary(cfg);
    expect(reloaded).toEqual(loaded); // the round-trip is now an identity (idempotent upgrade)
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull(); // never quarantined a valid legacy blob
  });

  it('an EMPTY [] legacy blob round-trips to [] (delete-everything survives the v4 upgrade)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    const loaded = loadItinerary(cfg);
    expect(loaded).toEqual([]);
    saveItinerary(loaded, cfg);
    expect(loadItinerary(cfg)).toEqual([]);
  });
});
