// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  loadItinerary,
  saveItinerary,
  hasStoredItinerary,
  type VaultConfig,
} from '@/core/vault/load-save';
import {
  runItineraryMigrations,
  itineraryMigrations,
  CURRENT_ITINERARY_VERSION,
} from '@/core/vault/migrations';
import { makeEnvelope } from '@/core/vault/envelope';
import { parseItineraryPayload } from '@/core/vault/schema';
import { isSourceType, toItineraryDraft, type SourceType } from '@/lib/itinerary-adapter';
import type { DayPlan } from '../trip-data';

/**
 * Trip Vault unit suite (S90; D-095 + D-096 LOCKED).
 *
 * Exercises the framework-free Vault directly (via a test-owned VaultConfig) — separate
 * from lib/__tests__/itinerary-storage.test.ts, which proves the public delegating API
 * is byte-identical. Together they cover the whole read/write path.
 *
 * The on-disk states (D-018 through the envelope):
 *   A absent → sample; B legacy bare array (v2) → migrate→v3 verbatim (incl. []);
 *   C valid v3 envelope → payload verbatim (incl. []);
 *   D corrupt/parse-fail/lenient-Zod-fail/migrate-throw → quarantine raw → sample.
 * A future schemaVersion > current is read leniently, never down-converted/quarantined.
 */

const STORAGE_KEY = 'test_vault_itinerary';
const QUARANTINE_KEY = 'test_vault_itinerary_corrupt';

// A distinctive fallback so "fell back to sample" is unambiguous in assertions.
const FALLBACK: DayPlan[] = [
  { date: '3000-01-01', city: 'FallbackCity', country: 'nepal', items: [] },
];

// A realistic v2 payload exercising every ItineraryItem field, incl. optionals + attribution.
const REAL_V2: DayPlan[] = [
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
        notes: '365 steps for a 360° panorama',
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
    items: [{ id: 'b1', title: 'Ramen', category: 'food' }],
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

describe('Trip Vault — migration runner', () => {
  it('migration #1 (v2→v3) is a payload IDENTITY — deep-equal every DayPlan/ItineraryItem field', () => {
    // S96: target v3 explicitly so this pins migration #1's identity in isolation (the
    // suite's original intent). Running the FULL chain to CURRENT (now 4) would additionally
    // apply the v3→v4 backfill — proven separately in the v3→v4 suite below. The v2→v3
    // identity assertion itself is byte-unchanged.
    const out = runItineraryMigrations(REAL_V2, 2, itineraryMigrations, 3);
    // Lossless: no field added, dropped, renamed, or reinterpreted.
    expect(out).toEqual(REAL_V2);
  });

  it('the shipped migration chain is exactly [v2→v3, v3→v4, v4→v5] and CURRENT is 5', () => {
    // S96 → S124: the chain-MANIFEST assertion (a change-detector), updated in lockstep with
    // each intentional, decision-backed append — S96 appended v3→v4 (D-104, CURRENT 3→4),
    // S124 appended v4→v5 (D-139, CURRENT 4→5). NOT a behavioral change: every behavioral
    // assertion in this suite (losslessness, quarantine, the four-state read) is byte-unchanged.
    expect(CURRENT_ITINERARY_VERSION).toBe(5);
    expect(itineraryMigrations.map((m) => [m.from, m.to])).toEqual([[2, 3], [3, 4], [4, 5]]);
  });

  it('an empty [] survives the v2→v3 migration (returns [] verbatim)', () => {
    expect(runItineraryMigrations([], 2)).toEqual([]);
  });

  it('a missing step in the chain throws (so the load path quarantines, never half-migrates)', () => {
    // Ask to migrate from a version with no matching `from` step.
    expect(() => runItineraryMigrations(REAL_V2, 5, itineraryMigrations, 7)).toThrow();
  });
});

describe('Trip Vault — lenient Zod schema', () => {
  it('keeps an item with an UNKNOWN category string (category is z.string(), not z.enum)', () => {
    const withUnknownCat: DayPlan[] = [
      {
        date: '2026-12-10',
        city: 'Kathmandu',
        country: 'nepal',
        // `category` is a string the current build's enum does not contain.
        items: [{ id: 'c1', title: 'Mystery', category: 'teleportation' as never }],
      },
    ];
    const parsed = parseItineraryPayload(withUnknownCat);
    expect(parsed).not.toBeNull();
    expect(parsed![0].items[0].category).toBe('teleportation');
  });

  it('.passthrough() preserves unknown future fields on an item', () => {
    const raw = [
      {
        date: '2026-12-10',
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 'd1', title: 'X', category: 'food', futureField: { a: 1 } }],
      },
    ];
    const parsed = parseItineraryPayload(raw) as unknown as Array<{
      items: Array<Record<string, unknown>>;
    }>;
    expect(parsed).not.toBeNull();
    expect(parsed[0].items[0].futureField).toEqual({ a: 1 });
  });

  // #123 — REPLACES 'returns null for a genuinely malformed payload (missing required id)'.
  // That assertion pinned the all-or-nothing parse that was the bug: one item with no `id` made
  // the whole payload null, the caller quarantined it, and every good day was replaced by the
  // fallback shells. The trust boundary is still the same lenient schema; only the blast radius
  // of one bad row changed.
  it('drops ONLY the malformed item — the rest of the day (and the payload) survives', () => {
    const mixed = [
      {
        date: '2026-12-10',
        city: 'K',
        country: 'nepal',
        items: [{ title: 'no id' }, { id: 'ok', title: 'Kept', category: 'food' }, null],
      },
      { date: '2026-12-11', city: 'P', country: 'nepal', items: [] },
    ];
    const parsed = parseItineraryPayload(mixed);
    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(2);
    expect(parsed![0].items).toEqual([{ id: 'ok', title: 'Kept', category: 'food' }]);
    expect(parsed![1].date).toBe('2026-12-11');
  });

  it('drops ONLY the malformed day — a bad day never takes its neighbours with it', () => {
    const mixed = [
      { date: '2026-12-10', city: 'K', country: 'nepal', items: [] },
      { city: 'no date', country: 'nepal', items: [] }, // fails dayPlanSchema
      { date: '2026-12-11', city: 'P', country: 'nepal' }, // `items` absent → dropped, not emptied
      null,
      { date: '2026-12-12', city: 'B', country: 'nepal', items: [] },
    ];
    const parsed = parseItineraryPayload(mixed);
    expect(parsed!.map((d) => d.date)).toEqual(['2026-12-10', '2026-12-12']);
  });

  // #139 — `sourceType` was the ONE non-lenient field in this deliberately lenient schema, so a
  // fifth source family from a newer build dropped the whole row (silently, since #123 made the
  // drop per-item) at both the on-disk and remote read boundaries.
  it('keeps an item with an UNRECOGNISED sourceType (sourceType is z.string(), not z.enum)', () => {
    const raw = [
      {
        date: '2026-12-10',
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 'v1', title: 'Screening', category: 'cultural', sourceId: 'vid-1', sourceType: 'video' },
          { id: 'm1', title: 'Ramen', category: 'food', sourceType: 'map' },
        ],
      },
    ];
    const parsed = parseItineraryPayload(raw);
    expect(parsed).not.toBeNull();
    expect(parsed![0].items.map((i) => i.id)).toEqual(['v1', 'm1']);
    expect((parsed![0].items[0] as { sourceType?: string }).sourceType).toBe('video');
  });

  it('an unrecognised sourceType survives a save → load round trip (it syncs, not drops)', () => {
    const plans = [
      {
        date: '2026-12-10',
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 'v1', title: 'Screening', category: 'cultural', sourceType: 'video' }],
      },
    ] as unknown as DayPlan[];
    saveItinerary(plans, cfg);
    expect(loadItinerary(cfg)).toEqual(plans);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('the adapter switch still has a DEFINED behaviour for a value the union does not cover', () => {
    expect(isSourceType('map')).toBe(true);
    expect(isSourceType('video')).toBe(false);
    expect(isSourceType(undefined)).toBe(false);
    // Not a silent fall-through returning `undefined` — an unnarrowed value throws by name.
    expect(() => toItineraryDraft({} as unknown, 'video' as unknown as SourceType)).toThrow(
      /unknown sourceType "video"/,
    );
    // …and the guard is the way a caller avoids it.
    expect(toItineraryDraft({ id: 'r1', name: 'Boudha' } as unknown, 'recommendation').sourceType).toBe(
      'recommendation',
    );
  });

  it('returns null ONLY for a non-array payload — the caller still has a real quarantine trigger', () => {
    expect(parseItineraryPayload('nope')).toBeNull();
    expect(parseItineraryPayload({ days: [] })).toBeNull();
    expect(parseItineraryPayload(null)).toBeNull();
    expect(parseItineraryPayload(undefined)).toBeNull();
    // An array whose every day is malformed is NOT corrupt — it is an empty (valid) itinerary.
    expect(parseItineraryPayload([{ nope: true }])).toEqual([]);
  });
});

describe('Trip Vault — load/save four-state resolution (D-018 via envelope)', () => {
  it('STATE A — key ABSENT: returns fallback; hasStored=false; nothing quarantined', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadItinerary(cfg)).toEqual(FALLBACK);
    expect(hasStoredItinerary(cfg)).toBe(false);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('STATE B — legacy bare v2 array: migrates LOSSLESSLY (v2→v3→v4), preserves every original field', () => {
    // Pre-seed the on-disk v2 format: a bare DayPlan[] JSON array, no envelope.
    // S96 (D-104): the chain now runs to v4, so items gain defaulted sync fields. The
    // migrate is still LOSSLESS — a superset, nothing dropped. Assert original fields
    // preserved (matchObject) + the not-fallback / no-quarantine guarantees byte-unchanged.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(REAL_V2));
    const loaded = loadItinerary(cfg);
    expect(loaded[0].items[0]).toMatchObject(REAL_V2[0].items[0]); // every original field survives
    expect(loaded[1].items[0]).toMatchObject(REAL_V2[1].items[0]);
    expect(loaded[0].items[0].rev).toBe(1); // defaulted
    expect(loaded).not.toEqual(FALLBACK);
    expect(hasStoredItinerary(cfg)).toBe(true);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull(); // successful migrate ⇒ no quarantine
  });

  it('STATE B — an empty [] legacy array survives migration AND reload (the #1 invariant)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    expect(loadItinerary(cfg)).toEqual([]); // NOT the fallback
    expect(hasStoredItinerary(cfg)).toBe(true);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('STATE C — valid v3 envelope: read + migrated v3→v4, preserves payload (incl. attribution)', () => {
    // S96 (D-104): a v3 envelope now upgrades v3→v4 on read (detected 3 < CURRENT 4), so
    // items gain defaulted sync fields — lossless superset, attribution untouched.
    const envelope = makeEnvelope(3, REAL_V2, '2026-07-05T00:00:00.000Z');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    const loaded = loadItinerary(cfg);
    expect(loaded[0].items[0]).toMatchObject(REAL_V2[0].items[0]);
    expect(loaded[1].items[0]).toMatchObject(REAL_V2[1].items[0]);
    expect(loaded[0].items[0].deleted).toBe(false); // defaulted
  });

  it('STATE C — a v3 envelope wrapping [] returns [] (empty survives the enveloped path)', () => {
    const envelope = makeEnvelope(3, [], '2026-07-05T00:00:00.000Z');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    expect(loadItinerary(cfg)).toEqual([]);
    expect(hasStoredItinerary(cfg)).toBe(true);
  });

  it('STATE C — an envelope whose payload contains an unknown category is read leniently (not destroyed)', () => {
    const payload = [
      { date: '2026-12-10', city: 'K', country: 'nepal', items: [{ id: 'z1', title: 'Q', category: 'brand-new-cat' }] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeEnvelope(3, payload, 'x')));
    const loaded = loadItinerary(cfg);
    // S96 (D-104): v3→v4 backfill adds defaulted sync fields; the unknown category and every
    // original field survive the lenient read untouched (not destroyed — the whole point).
    expect(loaded[0].items[0]).toMatchObject({ id: 'z1', title: 'Q', category: 'brand-new-cat' });
    expect(loaded[0].items[0].category).toBe('brand-new-cat');
    expect(loaded[0].items[0].rev).toBe(1);
  });

  it('FUTURE VERSION — schemaVersion 99 is read LENIENTLY, NEVER down-converted or quarantined', () => {
    const futurePayload = [
      { date: '2026-12-10', city: 'K', country: 'nepal', items: [{ id: 'f1', title: 'FromNewerBuild', category: 'food' }] },
    ];
    const futureEnvelope = { schemaVersion: 99, updatedAt: 'x', payload: futurePayload };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(futureEnvelope));
    const loaded = loadItinerary(cfg) as unknown as typeof futurePayload;
    expect(loaded).toEqual(futurePayload); // returned verbatim, read-only-safe
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull(); // NOT quarantined
  });

  it('STATE D — corrupt (parse error): quarantines the raw string, then falls back to sample', () => {
    const raw = '{not valid json';
    localStorage.setItem(STORAGE_KEY, raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadItinerary(cfg)).toEqual(FALLBACK);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(raw);
    expect(warn).toHaveBeenCalled();
  });

  it('STATE D — non-array, non-envelope object (no schemaVersion): quarantine → sample', () => {
    const raw = JSON.stringify({ foo: 1 });
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadItinerary(cfg)).toEqual(FALLBACK);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(raw);
  });

  it('STATE D — a MIGRATION STEP THAT THROWS routes to quarantine (raw preserved) → sample', () => {
    // Poison migration #1 so a v2 array triggers a throwing migrate step on the live path.
    const spy = vi
      .spyOn(itineraryMigrations[0], 'migrate')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    const raw = JSON.stringify(REAL_V2); // legacy v2 → runs the (now throwing) migration
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadItinerary(cfg)).toEqual(FALLBACK);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(raw); // original bytes preserved
    expect(spy).toHaveBeenCalled();
  });

  // #123 — REPLACES 'STATE D — enveloped payload that fails the lenient Zod schema: quarantine
  // → sample'. One malformed item is no longer state D at all: it is a good payload with one
  // unusable row, and quarantining it cost the user every other day on the trip.
  it('one malformed ITEM is NOT state D — the good days load and nothing is quarantined', () => {
    const raw = JSON.stringify({
      schemaVersion: 5,
      updatedAt: 'x',
      payload: [
        {
          date: '2026-12-10',
          city: 'K',
          country: 'nepal',
          items: [{ title: 'no id' }, { id: 'ok', title: 'Kept', category: 'food' }],
        },
        { date: '2026-12-11', city: 'P', country: 'nepal', items: [] },
      ],
    });
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loaded = loadItinerary(cfg);
    expect(loaded).not.toEqual(FALLBACK);
    expect(loaded.map((d) => d.date)).toEqual(['2026-12-10', '2026-12-11']);
    expect(loaded[0].items).toEqual([{ id: 'ok', title: 'Kept', category: 'food' }]);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('STATE D — an enveloped payload that is not an array at all: quarantine → sample', () => {
    // Still a real state-D trigger after #123: `parseItineraryPayload` returns null only here.
    const raw = JSON.stringify({ schemaVersion: 5, updatedAt: 'x', payload: 'not-a-list' });
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadItinerary(cfg)).toEqual(FALLBACK);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(raw);
  });

  it("don't-clobber-first: a second corruption does NOT overwrite the first quarantined bytes", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = '{"original":"users real trip, corrupted"}';
    localStorage.setItem(STORAGE_KEY, first);
    loadItinerary(cfg);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(first);

    const second = '{"different":"corruption"}';
    localStorage.setItem(STORAGE_KEY, second);
    loadItinerary(cfg);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe(first); // still the FIRST capture
  });
});

describe('Trip Vault — write side (envelope on disk) + round-trip', () => {
  it('saveItinerary writes a well-formed CURRENT envelope: {schemaVersion, updatedAt, payload}', () => {
    // S96 (D-104): the write path always emits the CURRENT version (now 4). Asserted via
    // the CURRENT_ITINERARY_VERSION constant so this pins "writes the current version",
    // not a frozen literal — the envelope-shape guarantee is unchanged.
    const plans: DayPlan[] = [
      { date: '2026-12-15', city: 'Tokyo', country: 'japan', items: [{ id: 'x1', title: 'T', category: 'sightseeing' }] },
    ];
    saveItinerary(plans, { ...cfg, nowISO: () => '2026-07-05T12:00:00.000Z' });
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
    expect(onDisk.updatedAt).toBe('2026-07-05T12:00:00.000Z');
    expect(onDisk.payload).toEqual(plans);
    // Exact key set — no gold-plating (no id/checksum/history).
    expect(Object.keys(onDisk).sort()).toEqual(['payload', 'schemaVersion', 'updatedAt']);
  });

  it('saveItinerary([]) writes an enveloped empty payload (delete-everything is durable)', () => {
    saveItinerary([], cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
    expect(onDisk.payload).toEqual([]);
    expect(loadItinerary(cfg)).toEqual([]); // reads back [] (NOT the fallback)
    expect(hasStoredItinerary(cfg)).toBe(true);
  });

  it('v3 envelope ROUND-TRIP: saveItinerary then loadItinerary is identity', () => {
    saveItinerary(REAL_V2, cfg);
    expect(loadItinerary(cfg)).toEqual(REAL_V2);
  });

  it('S279: saveItinerary fires trip:quota-exceeded (and never throws) when the raw setItem rejects with a quota-shaped DOMException', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const handler = vi.fn();
    window.addEventListener('trip:quota-exceeded', handler);
    try {
      expect(() => saveItinerary(REAL_V2, cfg)).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('trip:quota-exceeded', handler);
    }
  });

  it('S279: does NOT fire trip:quota-exceeded on a non-quota save failure (disabled storage stays silent)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    const handler = vi.fn();
    window.addEventListener('trip:quota-exceeded', handler);
    try {
      expect(() => saveItinerary(REAL_V2, cfg)).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('trip:quota-exceeded', handler);
    }
  });

  it('legacy v2 on disk reads back LOSSLESSLY (pre-seeded bare array → loadItinerary, v2→v3→v4)', () => {
    // The live-users case: bytes written by the pre-Vault build. S96 (D-104): the load now
    // runs the full chain v2→v3→v4, so each item gains the DEFAULTED sync fields
    // (rev:1, hlc:<seeded from updatedAt>, deleted:false). Lossless SUPERSET: every original
    // field is preserved verbatim; nothing is dropped or reinterpreted. Assert both halves.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(REAL_V2));
    const loaded = loadItinerary(cfg);
    // Original fields preserved verbatim on the first item (attribution incl.).
    expect(loaded[0]).toMatchObject({
      date: '2026-12-09',
      city: 'Kathmandu',
      country: 'nepal',
    });
    const a1 = loaded[0].items[0];
    expect(a1).toMatchObject({ id: 'a1', title: 'Sunrise at Swayambhunath', category: 'photography', createdBy: 'Alex', updatedBy: 'Sam' });
    // Defaulted sync fields backfilled deterministically.
    expect(a1.rev).toBe(1);
    expect(a1.deleted).toBe(false);
    expect(typeof a1.hlc).toBe('string'); // seeded from updatedAt (pure, deterministic)
    // A legacy item with no updatedAt (b1) still gets a valid seeded hlc + defaults.
    const b1 = loaded[1].items[0];
    expect(b1).toMatchObject({ id: 'b1', title: 'Ramen', category: 'food', rev: 1, deleted: false });
    expect(typeof b1.hlc).toBe('string');
  });

  it('migrate-then-save upgrades the on-disk format to the CURRENT (v4) envelope transparently', () => {
    // Simulate use-itinerary commit(): prev = load (migrates v2→v3→v4), save(next).
    localStorage.setItem(STORAGE_KEY, JSON.stringify(REAL_V2));
    const prev = loadItinerary(cfg);
    // No data lost: every original field on every item is preserved (superset, defaults added).
    expect(prev[0].items[0]).toMatchObject(REAL_V2[0].items[0]);
    expect(prev[1].items[0]).toMatchObject(REAL_V2[1].items[0]);
    saveItinerary(prev, cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION); // format upgraded on first write (now 4)
    expect(onDisk.payload).toEqual(prev); // the (backfilled) payload round-trips verbatim
  });
});
