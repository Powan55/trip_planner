// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadItinerary,
  saveItinerary,
  type VaultConfig,
} from '@/core/vault/load-save';
import { CURRENT_ITINERARY_VERSION } from '@/core/vault/migrations';
import { itineraryItemSchema, parseItineraryPayload } from '@/core/vault/schema';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * S98 — Done-tracking: the `done?: boolean` field is an additive OPTIONAL that
 * round-trips through the Vault with NO migration and NO version bump.
 *
 * Proves:
 *  1. the lenient item schema accepts an item WITH `done` (true/false) and one WITHOUT it;
 *  2. `done` survives a saveItinerary → loadItinerary round-trip (both true and false);
 *  3. a LEGACY item with no `done` loads fine (absent = not done, `done === undefined`);
 *  4. adding `done` did NOT bump the on-disk version — the written envelope is still v4
 *     (CURRENT_ITINERARY_VERSION === 4), which is exactly what keeps the `schemaVersion`
 *     E2E/unit assertions on `toBe(4)`.
 */

const STORAGE_KEY = 'test_done_itinerary';
const QUARANTINE_KEY = 'test_done_itinerary_corrupt';
const FALLBACK: DayPlan[] = [{ date: '3000-01-01', city: 'Fallback', country: 'nepal', items: [] }];

// A day whose items exercise done=true, done=false, and done absent (legacy).
const PLANS_WITH_DONE: DayPlan[] = [
  {
    date: '2026-12-12',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'd-true', title: 'Boudhanath at dawn', category: 'photography', time: '06:00', done: true },
      { id: 'd-false', title: 'Thamel wander', category: 'sightseeing', done: false },
      // Legacy item — NO `done` key at all (the live-users case pre-S98).
      { id: 'd-absent', title: 'Momo lunch', category: 'food' },
    ],
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

describe('S98 — `done` field is a lenient, additive OPTIONAL (schema)', () => {
  it('accepts an item WITH done:true', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', done: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.done).toBe(true);
  });

  it('accepts an item WITH done:false', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', done: false });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.done).toBe(false);
  });

  it('accepts a LEGACY item with NO done key (done stays undefined = not done)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.done).toBeUndefined();
  });

  it('rejects a non-boolean done (typed, not free-form)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', done: 'yes' });
    expect(parsed.success).toBe(false);
  });

  it('parseItineraryPayload preserves done across a mixed (true/false/absent) day', () => {
    const parsed = parseItineraryPayload(PLANS_WITH_DONE);
    expect(parsed).not.toBeNull();
    const [t, f, absent] = parsed![0].items as ItineraryItem[];
    expect(t.done).toBe(true);
    expect(f.done).toBe(false);
    expect(absent.done).toBeUndefined();
  });
});

describe('S98 — `done` round-trips through the Vault (save → load) with NO version bump', () => {
  it('save then load preserves done (true, false, and absent-stays-absent)', () => {
    saveItinerary(PLANS_WITH_DONE, cfg);
    const loaded = loadItinerary(cfg);
    const items = loaded[0].items as ItineraryItem[];
    expect(items.find((i) => i.id === 'd-true')!.done).toBe(true);
    expect(items.find((i) => i.id === 'd-false')!.done).toBe(false);
    // Absent stays absent (falsy) — no backfill, unlike the Sync-v2 fields.
    expect(items.find((i) => i.id === 'd-absent')!.done).toBeUndefined();
  });

  it('`done` needs no dedicated migration/version bump — it rides the CURRENT envelope', () => {
    // `done` still adds no migration + no version of its own (it's tolerated by the lenient
    // passthrough read). The write path emits the CURRENT version (now 5 since S124's time-model
    // migration) — asserted via the constant so this pins "writes the current version", not a
    // frozen literal. The `done`-tracking behavior above is byte-unchanged.
    saveItinerary(PLANS_WITH_DONE, cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
  });

  it('a legacy bare-array (v2) itinerary with no `done` loads fine — done is undefined post-migration', () => {
    // The pre-S98 on-disk shape: a bare DayPlan[] with items that have no `done`.
    const legacy: DayPlan[] = [
      { date: '2026-12-19', city: 'Tokyo', country: 'japan', items: [{ id: 'leg', title: 'Ramen', category: 'food' }] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const loaded = loadItinerary(cfg);
    const leg = loaded[0].items[0] as ItineraryItem;
    // Original field preserved; done absent (not done). The v2→v3→v4 migration adds the
    // Sync-v2 defaults but touches NOTHING about done (there is no done backfill).
    expect(leg.title).toBe('Ramen');
    expect(leg.done).toBeUndefined();
  });

  it('toggling done in place round-trips: a saved done:true, re-saved as done:false, reads false', () => {
    // Mirrors what the Today panel does via updateItem: flip done, persist, re-read.
    saveItinerary(PLANS_WITH_DONE, cfg);
    const loaded = loadItinerary(cfg);
    const flipped: DayPlan[] = loaded.map((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === 'd-true' ? { ...it, done: false } : it)),
    }));
    saveItinerary(flipped, cfg);
    const reloaded = loadItinerary(cfg);
    expect((reloaded[0].items.find((i) => i.id === 'd-true') as ItineraryItem).done).toBe(false);
  });
});
