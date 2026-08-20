// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportItinerary, importItinerary } from '@/core/vault/export-import';
import {
  loadPlans,
  savePlans,
  ITINERARY_STORAGE_KEY,
  ITINERARY_QUARANTINE_KEY,
} from '@/lib/itinerary-storage';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { makeEnvelope } from '@/core/vault/envelope';
import { CURRENT_ITINERARY_VERSION } from '@/core/vault/migrations';
import type { DayPlan } from '@/lib/trip-data';

/**
 * Whole-trip export/import unit suite (S92; D-098 LOCKED).
 *
 * Exercises `core/vault/export-import.ts` against the REAL Vault-backed storage
 * (`loadPlans`/`savePlans` on the real `nepal_japan_itinerary` key), so these tests
 * prove the actual write path, quarantine, and same-tab event — not a mock.
 *
 * The four required cases:
 *   1. export → import ROUND-TRIP identity (lossless, the reuse-the-schema guarantee).
 *   2. malformed import → {ok:false} AND the current data is BYTE-UNCHANGED (D-098 fail-safe).
 *   3. a v2 bare-array "export" imports → migrates → v3 envelope on disk.
 *   4. an empty [] round-trips (delete-everything is a legitimate, portable state).
 */

// A realistic itinerary exercising every ItineraryItem field incl. attribution + an optional-less item.
const REAL_PLANS: DayPlan[] = [
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
    items: [{ id: 'b1', title: 'Ramen crawl', category: 'food' }],
  },
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S92 exportItinerary', () => {
  it('serializes the current itinerary as a v3 Vault envelope { schemaVersion, updatedAt, payload }', () => {
    savePlans(REAL_PLANS);
    const parsed = JSON.parse(exportItinerary());
    expect(parsed.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
    expect(typeof parsed.updatedAt).toBe('string');
    expect(parsed.payload).toEqual(REAL_PLANS);
    // Exact envelope key set — no gold-plating.
    expect(Object.keys(parsed).sort()).toEqual(['payload', 'schemaVersion', 'updatedAt']);
  });
});

describe('S92 export → import round-trip identity', () => {
  it('exporting then importing the same JSON reproduces the itinerary byte-for-byte', () => {
    savePlans(REAL_PLANS);
    const exported = exportItinerary();

    // Wipe to a different state so a no-op could not masquerade as success.
    savePlans([]);
    expect(loadPlans()).toEqual([]);

    const result = importItinerary(exported);
    expect(result.ok).toBe(true);
    expect(loadPlans()).toEqual(REAL_PLANS);
  });

  it('a successful import dispatches ITINERARY_CHANGED_EVENT so the live UI refreshes (D-026)', () => {
    savePlans(REAL_PLANS);
    const exported = exportItinerary();
    savePlans([]);

    const onChange = vi.fn();
    window.addEventListener(ITINERARY_CHANGED_EVENT, onChange);
    const result = importItinerary(exported);
    window.removeEventListener(ITINERARY_CHANGED_EVENT, onChange);

    expect(result.ok).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('S92 fail-safe — a bad import NEVER destroys current data (D-098)', () => {
  it('malformed JSON → {ok:false} AND the on-disk itinerary is BYTE-UNCHANGED', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    expect(before).not.toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = importItinerary('{ this is not valid json');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
    // The single most important assertion: the main key's bytes did not move.
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
    // And loadPlans still returns the original trip.
    expect(loadPlans()).toEqual(REAL_PLANS);
  });

  it('a structurally-recognized but MALFORMED payload (item missing required id) → {ok:false} + data unchanged', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A valid v3 envelope shape, but the payload fails the lenient Zod schema (no `id`).
    const badEnvelope = makeEnvelope(
      3,
      [{ date: '2026-12-10', city: 'K', country: 'nepal', items: [{ title: 'no id' }] }] as never,
      'x',
    );
    const result = importItinerary(JSON.stringify(badEnvelope));

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
    expect(loadPlans()).toEqual(REAL_PLANS);
  });

  // #123 made `parseItineraryPayload` degrade per day/per item — correct for the ON-DISK read,
  // but it was wired into the import boundary too. An array of pure garbage then validated as
  // `[]`, the import reported {ok:true}, and `savePlans([])` deleted the live trip; under sync
  // `restorePlans([])` propagated that as tombstones. Import validates strictly again
  // (`parseItineraryPayloadStrict`); the next two pin the exact shapes that regression admitted.
  it('an array of pure GARBAGE never validates as an empty trip → {ok:false} + data unchanged + quarantined', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const raw = JSON.stringify({
      schemaVersion: 5,
      updatedAt: 'x',
      payload: [{ nope: true }, 1, null],
    });
    const result = importItinerary(raw);

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
    expect(loadPlans()).toEqual(REAL_PLANS);
    expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
  });

  it('a PARTIALLY malformed backup (day 2 has a numeric date) is rejected whole, not silently truncated', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The realistic mangled-file case. Accepting the good half would replace the live two-day
    // trip with a one-day copy of itself and still report success — the silent-truncation hole.
    const mangled = makeEnvelope(
      CURRENT_ITINERARY_VERSION,
      [REAL_PLANS[0], { ...REAL_PLANS[1], date: 12 }] as never,
      'x',
    );
    const result = importItinerary(JSON.stringify(mangled));

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
    expect(loadPlans()).toEqual(REAL_PLANS);
  });

  it('a payload that is not an array at all → {ok:false} + data unchanged', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Envelope shape is recognized, but the payload can no longer be read as days at all —
    // the one remaining reject-and-quarantine trigger.
    const badEnvelope = { schemaVersion: 5, updatedAt: 'x', payload: 'not-a-list' };
    const result = importItinerary(JSON.stringify(badEnvelope));

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
    expect(loadPlans()).toEqual(REAL_PLANS);
  });

  it('an unrecognized shape (a bare JSON object, not array/envelope) → {ok:false} + data unchanged', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = importItinerary(JSON.stringify({ foo: 'bar' }));

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before);
  });

  it('a rejected import is quarantined verbatim (D-096) without touching the main key', () => {
    savePlans(REAL_PLANS);
    const before = localStorage.getItem(ITINERARY_STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const badRaw = '{ not json at all';
    const result = importItinerary(badRaw);

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(badRaw); // preserved
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).toBe(before); // main untouched
  });
});

describe('S92 migration on import — a v2-era export upgrades to v3 (D-095/D-098)', () => {
  it('a legacy bare DayPlan[] JSON (v2, no envelope) imports → migrates → CURRENT envelope on disk', () => {
    // Simulate a file produced by (or hand-crafted from) a pre-Vault v2 build.
    // S96 (D-104): the import now runs the full chain v2→v3→v4, so items gain the defaulted
    // sync fields — a LOSSLESS superset (every original field preserved). Assert the version
    // via the constant and the lossless-superset property (matchObject), not byte-identity.
    const v2Json = JSON.stringify(REAL_PLANS);
    const result = importItinerary(v2Json);

    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(localStorage.getItem(ITINERARY_STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
    // Lossless: every original field on every item is preserved (defaults added, nothing lost).
    const loaded = loadPlans();
    expect(loaded[0].items[0]).toMatchObject(REAL_PLANS[0].items[0]);
    expect(loaded[1].items[0]).toMatchObject(REAL_PLANS[1].items[0]);
    expect(loaded[0].items[0].rev).toBe(1); // backfilled default
    expect(loaded[0].items[0].deleted).toBe(false);
  });
});

describe('S124 migration on import — a v4-era export upgrades through migration #3 (D-139)', () => {
  it('a v4 envelope (items with `time`, no `startMinutes`) imports → gains startMinutes losslessly', () => {
    // A file produced by a v4 build: no startMinutes on any item.
    const v4Envelope = makeEnvelope(4, REAL_PLANS, '2026-07-05T00:00:00.000Z');
    const result = importItinerary(JSON.stringify(v4Envelope));

    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(localStorage.getItem(ITINERARY_STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION); // now 5
    const loaded = loadPlans();
    // Lossless: every original field preserved; the '06:00' item gains startMinutes 360.
    expect(loaded[0].items[0]).toMatchObject(REAL_PLANS[0].items[0]);
    expect(loaded[0].items[0].startMinutes).toBe(360);
    // The item with no time gains nothing.
    expect(loaded[1].items[0].startMinutes).toBeUndefined();
  });
});

describe('S92 empty-itinerary round-trip (delete-everything is portable)', () => {
  it('exporting an empty [] then importing it yields [] (NOT re-seeded sample)', () => {
    savePlans([]);
    const exported = exportItinerary();
    // Sanity: the exported envelope wraps an empty payload.
    expect(JSON.parse(exported).payload).toEqual([]);

    // Move to a non-empty state, then import the empty export back.
    savePlans(REAL_PLANS);
    expect(loadPlans()).toEqual(REAL_PLANS);

    const result = importItinerary(exported);
    expect(result.ok).toBe(true);
    expect(loadPlans()).toEqual([]); // empty survived the round-trip
    // Key present (not absent) → hasStored semantics hold; [] is a durable state.
    expect(localStorage.getItem(ITINERARY_STORAGE_KEY)).not.toBeNull();
  });
});
