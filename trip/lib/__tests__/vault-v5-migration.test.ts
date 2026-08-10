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
import { itineraryEnvelopeV5, parseItineraryPayload } from '@/core/vault/schema';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * Vault v4→v5 migration unit suite (S124; D-139 LOCKED). THE risky slice —
 * a migration over real, live, sync-enabled trip data. Proves the appended v4→v5 step is:
 * LOSSLESS (only ADDS `startMinutes` where parseable), NEVER-CLOBBER, IDEMPOTENT, PURE / NO
 * CLOCK, and total on well-formed input. Mirrors the v3→v4 suite's structure.
 */

const STORAGE_KEY = 'test_v5_itinerary';
const QUARANTINE_KEY = 'test_v5_itinerary_corrupt';
const FALLBACK: DayPlan[] = [{ date: '3000-01-01', city: 'Fallback', country: 'nepal', items: [] }];

// A v4-shaped item carrying every legacy field (incl. the sync-v2 fields) — the realistic
// live-data shape the migration runs over. `time: '06:00'` is parseable → startMinutes 360.
const RICH_ITEM: ItineraryItem = {
  id: 'a1',
  title: 'Sunrise at Swayambhunath',
  category: 'photography',
  time: '06:00',
  duration: '2h', // NEVER parsed by this migration (decided gap, D-139)
  notes: '365 steps',
  location: 'Swayambhu Hill',
  sourceId: 'rec-42',
  sourceType: 'recommendation',
  createdBy: 'Alex',
  updatedBy: 'Sam',
  updatedAt: '2026-07-01T10:00:00.000Z',
  rev: 3,
  hlc: 'hlc-abc',
  deleted: false,
  done: true,
};

function v4Day(items: ItineraryItem[]): DayPlan[] {
  return [{ date: '2026-12-09', city: 'Kathmandu', country: 'nepal', items }];
}

let cfg: VaultConfig;

beforeEach(() => {
  localStorage.clear();
  cfg = { storageKey: STORAGE_KEY, quarantineKey: QUARANTINE_KEY, fallback: FALLBACK };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('matrix 1 — append-only chain', () => {
  it('the shipped chain is [v2→v3, v3→v4, v4→v5] and CURRENT is 5 (D-095 append rule)', () => {
    expect(CURRENT_ITINERARY_VERSION).toBe(5);
    expect(itineraryMigrations.map((m) => [m.from, m.to])).toEqual([[2, 3], [3, 4], [4, 5]]);
  });
});

describe('matrix 2 — each parseable `time` format → correct startMinutes', () => {
  const CASES: Array<[string, number]> = [
    ['06:00', 360],
    ['6:00', 360],
    ['23:59', 1439],
    ['14.30', 870],
    ['2pm', 840],
    ['2:15 PM', 855],
    ['12am', 0],
    ['12pm', 720],
    ['12:30 p.m.', 750],
    ['05:45', 345],
  ];
  it.each(CASES)('time %j → startMinutes %i', (time, mins) => {
    const out = runItineraryMigrations(v4Day([{ id: 'i', title: 'T', category: 'food', time }]), 4) as DayPlan[];
    expect(out[0].items[0].startMinutes).toBe(mins);
    expect(out[0].items[0].time).toBe(time); // legacy text byte-preserved
  });
});

describe('matrix 3 — unparseable `time` is preserved (startMinutes stays undefined)', () => {
  const BAD = ['2pm-ish', 'morning', '14:00-16:00', '1430', '24:00', '12:60', ''];
  it.each(BAD)('time %j → no startMinutes, original preserved verbatim', (time) => {
    const out = runItineraryMigrations(v4Day([{ id: 'i', title: 'T', category: 'food', time }]), 4) as DayPlan[];
    expect(out[0].items[0].startMinutes).toBeUndefined();
    expect(out[0].items[0].time).toBe(time); // byte-intact
  });

  it('an item with NO `time` gains nothing and is byte-preserved', () => {
    const noTime: ItineraryItem = { id: 'n', title: 'N', category: 'food' };
    const out = runItineraryMigrations(v4Day([noTime]), 4) as DayPlan[];
    expect(out[0].items[0]).toEqual(noTime);
    expect('startMinutes' in out[0].items[0]).toBe(false);
  });
});

describe('matrix 4 — LOSSLESS: only ADDS startMinutes, touches nothing else', () => {
  it('every original field survives verbatim; duration untouched; durationMinutes NOT set', () => {
    const out = runItineraryMigrations(v4Day([RICH_ITEM]), 4) as DayPlan[];
    const migrated = out[0].items[0];
    // Full original object preserved (nothing dropped/rewritten).
    expect(migrated).toMatchObject(RICH_ITEM);
    // The ONLY change is the addition of startMinutes.
    expect(migrated.startMinutes).toBe(360);
    expect(migrated.durationMinutes).toBeUndefined(); // duration is NOT parsed
    expect(migrated.duration).toBe('2h'); // legacy duration text untouched
    // Byte-precise: the migrated item = original + exactly one new key.
    expect(Object.keys(migrated).sort()).toEqual(
      [...Object.keys(RICH_ITEM), 'startMinutes'].sort(),
    );
  });
});

describe('matrix 5 — NEVER clobbers an existing startMinutes', () => {
  it('keeps an existing startMinutes verbatim (even one CONFLICTING with the time text)', () => {
    const conflicted: ItineraryItem = {
      id: 'c',
      title: 'C',
      category: 'food',
      time: '06:00', // would parse to 360…
      startMinutes: 999, // …but the existing value wins, untouched
    };
    const out = runItineraryMigrations(v4Day([conflicted]), 4) as DayPlan[];
    expect(out[0].items[0].startMinutes).toBe(999);
    expect(out[0].items[0]).toEqual(conflicted); // byte-identical
  });

  it('keeps an existing startMinutes of 0 (falsy but defined — not re-parsed)', () => {
    const midnight: ItineraryItem = { id: 'z', title: 'Z', category: 'food', time: '06:00', startMinutes: 0 };
    const out = runItineraryMigrations(v4Day([midnight]), 4) as DayPlan[];
    expect(out[0].items[0].startMinutes).toBe(0);
  });
});

describe('matrix 6 — IDEMPOTENT', () => {
  it('running v4→v5 twice ≡ once', () => {
    const once = runItineraryMigrations(v4Day([RICH_ITEM, { id: 'u', title: 'U', category: 'food', time: 'morning' }]), 4);
    const twice = runItineraryMigrations(once, 5, itineraryMigrations, 5); // re-enter at 5 (no step runs)
    expect(twice).toEqual(once);
    // Also: applying the step function directly a second time is an identity.
    const step = itineraryMigrations.find((m) => m.from === 4)!;
    expect(step.migrate(once)).toEqual(once);
  });
});

describe('matrix 7 — DETERMINISTIC / no clock', () => {
  it('two runs are byte-identical (no Date.now in the step)', () => {
    const a = runItineraryMigrations(v4Day([RICH_ITEM]), 4);
    const b = runItineraryMigrations(v4Day([RICH_ITEM]), 4);
    expect(a).toEqual(b);
  });

  it('the v4→v5 step source contains no clock read', () => {
    const step = itineraryMigrations.find((m) => m.from === 4)!;
    const src = step.migrate.toString();
    expect(src).not.toMatch(/Date\.now|new Date/);
  });
});

describe('matrix 8 — empty cases survive unchanged', () => {
  it('an empty [] and a day with items:[] are identities', () => {
    expect(runItineraryMigrations([], 4)).toEqual([]);
    const noItems: DayPlan[] = [{ date: '2026-12-10', city: 'K', country: 'nepal', items: [] }];
    expect(runItineraryMigrations(noItems, 4)).toEqual(noItems);
  });
});

describe('matrix 9 — full round-trip through loadItinerary / saveItinerary', () => {
  it('a legacy bare DayPlan[] (v2) walks v2→v3→v4→v5, gains startMinutes, saves v5, reloads identical', () => {
    // A pre-Vault v2 bare array with a parseable + an unparseable time.
    const LEGACY: DayPlan[] = [
      {
        date: '2026-12-09',
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 'p', title: 'Parseable', category: 'food', time: '06:00', updatedAt: '2026-07-01T10:00:00.000Z' },
          { id: 'u', title: 'Unparseable', category: 'food', time: 'morning' },
          { id: 'n', title: 'No time', category: 'food' },
        ],
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(LEGACY));

    const loaded = loadItinerary(cfg);
    // Original fields intact + sync-v2 defaults (from v3→v4) + startMinutes (from v4→v5).
    expect(loaded[0].items[0]).toMatchObject({ id: 'p', title: 'Parseable', time: '06:00', rev: 1, deleted: false });
    expect(loaded[0].items[0].startMinutes).toBe(360);
    expect(loaded[0].items[1].startMinutes).toBeUndefined(); // 'morning' unparseable
    expect(loaded[0].items[1].time).toBe('morning'); // preserved
    expect(loaded[0].items[2].startMinutes).toBeUndefined(); // no time

    // Persist → v5 envelope on disk.
    saveItinerary(loaded, cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(5);

    // Reload: already v5 ⇒ no re-migration; byte-identical (idempotent upgrade).
    expect(loadItinerary(cfg)).toEqual(loaded);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull(); // a valid legacy blob is never quarantined
  });

  it('the v5 envelope validates a schemaVersion:5 wrapper carrying a migrated payload', () => {
    const payload = runItineraryMigrations(v4Day([RICH_ITEM]), 4) as DayPlan[];
    const envelope = { schemaVersion: 5, updatedAt: '2026-07-05T00:00:00.000Z', payload };
    expect(itineraryEnvelopeV5.safeParse(envelope).success).toBe(true);
  });

  it('parseItineraryPayload (now v5) accepts items WITH and WITHOUT the new fields', () => {
    const mixed: DayPlan[] = [
      {
        date: '2026-12-10',
        city: 'K',
        country: 'nepal',
        items: [
          { id: 'has', title: 'H', category: 'food', startMinutes: 480, durationMinutes: 90 },
          { id: 'hasnot', title: 'N', category: 'food' },
        ],
      },
    ];
    const parsed = parseItineraryPayload(mixed);
    expect(parsed).not.toBeNull();
    expect(parsed![0].items[0].startMinutes).toBe(480);
    expect(parsed![0].items[1].startMinutes).toBeUndefined();
  });

  it('an out-of-range startMinutes is READ leniently (NOT quarantined) — degrades at runtime, not here', () => {
    const outOfRange: DayPlan[] = [
      { date: '2026-12-10', city: 'K', country: 'nepal', items: [{ id: 'o', title: 'O', category: 'food', startMinutes: 5000 }] },
    ];
    // The lenient read keeps it (plain z.number()); the ONE range check is effectiveStartMinutes.
    expect(parseItineraryPayload(outOfRange)).not.toBeNull();
  });
});
