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
 * S137 — Manual pin-drop: `lat?`/`lng?` are additive OPTIONALs that round-trip through the
 * Vault with NO migration and NO version bump (mirrors the S98 `done`-field precedent).
 *
 * Proves:
 *  1. the lenient item schema accepts an item WITH lat/lng and one WITHOUT them;
 *  2. lat/lng survive a saveItinerary -> loadItinerary round-trip;
 *  3. a LEGACY item with no lat/lng loads fine (absent = un-pinned);
 *  4. adding lat/lng did NOT bump the on-disk version — the written envelope is still v5
 *     (CURRENT_ITINERARY_VERSION === 5), which is exactly what keeps the `schemaVersion`
 *     E2E/unit assertions on `toBe(5)`.
 */

const STORAGE_KEY = 'test_pin_itinerary';
const QUARANTINE_KEY = 'test_pin_itinerary_corrupt';
const FALLBACK: DayPlan[] = [{ date: '3000-01-01', city: 'Fallback', country: 'nepal', items: [] }];

const PLANS_WITH_PIN: DayPlan[] = [
  {
    date: '2026-12-12',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'p-pinned', title: 'Secret rooftop cafe', category: 'food', lat: 27.7043, lng: 85.3072 },
      // Legacy item — NO lat/lng at all (the live-users case pre-S137).
      { id: 'p-absent', title: 'Momo lunch', category: 'food' },
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

describe('S137 — `lat`/`lng` are lenient, additive OPTIONALs (schema)', () => {
  it('accepts an item WITH lat/lng', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', lat: 27.7, lng: 85.3 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.lat).toBe(27.7);
    expect(parsed.success && parsed.data.lng).toBe(85.3);
  });

  it('accepts a LEGACY item with NO lat/lng (stays un-pinned)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.lat).toBeUndefined();
    expect(parsed.success && parsed.data.lng).toBeUndefined();
  });

  it('rejects a non-number lat/lng (typed, not free-form)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', lat: 'north' });
    expect(parsed.success).toBe(false);
  });

  // An out-of-WGS84 coordinate reaches `map.fitBounds` unchecked, and maplibre's LngLat
  // constructor throws on it — a dead map pane for every surface that renders the day.
  // `JSON.parse('1e999')` is Infinity, so a hand-edited backup gets there without trying.
  it.each([
    ['lat above 90', { lat: 500, lng: 85.3 }],
    ['lat below -90', { lat: -500, lng: 85.3 }],
    ['lng above 180', { lat: 27.7, lng: 900 }],
    ['lng below -180', { lat: 27.7, lng: -900 }],
    ['infinite lat', { lat: Number.POSITIVE_INFINITY, lng: 85.3 }],
    ['infinite lng', { lat: 27.7, lng: Number.NEGATIVE_INFINITY }],
  ])('drops an out-of-range coordinate (%s) but KEEPS the item', (_label, coords) => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'Rooftop', category: 'food', ...coords });
    expect(parsed.success).toBe(true);
    // The row survives — losing the plan over one bad number is the worse bug (D-363).
    expect(parsed.success && parsed.data.title).toBe('Rooftop');
    const bad = Object.entries(coords).find(([, v]) => !Number.isFinite(v) || Math.abs(v) > 180)![0];
    expect(parsed.success && parsed.data[bad as 'lat' | 'lng']).toBeUndefined();
  });

  it('keeps the exact WGS84 extremes', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', lat: -90, lng: 180 });
    expect(parsed.success && parsed.data.lat).toBe(-90);
    expect(parsed.success && parsed.data.lng).toBe(180);
  });

  it('drops an out-of-range tzOffsetMin but keeps a real one', () => {
    const wild = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', tzOffsetMin: 99999 });
    expect(wild.success && wild.data.tzOffsetMin).toBeUndefined();
    const real = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', tzOffsetMin: 840 });
    expect(real.success && real.data.tzOffsetMin).toBe(840);
  });

  it('parseItineraryPayload strips a bad pin without losing the day or the plan', () => {
    const parsed = parseItineraryPayload([
      {
        date: '2026-12-12',
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 'bad', title: 'Momo lunch', category: 'food', lat: 1e999, lng: 85.3 }],
      },
    ]);
    expect(parsed).toHaveLength(1);
    const [item] = parsed![0].items as ItineraryItem[];
    expect(item.title).toBe('Momo lunch');
    expect(item.lat).toBeUndefined();
  });

  it('parseItineraryPayload preserves lat/lng across a mixed (pinned/absent) day', () => {
    const parsed = parseItineraryPayload(PLANS_WITH_PIN);
    expect(parsed).not.toBeNull();
    const [pinned, absent] = parsed![0].items as ItineraryItem[];
    expect(pinned.lat).toBe(27.7043);
    expect(pinned.lng).toBe(85.3072);
    expect(absent.lat).toBeUndefined();
    expect(absent.lng).toBeUndefined();
  });
});

describe('S137 — `lat`/`lng` round-trip through the Vault (save -> load) with NO version bump', () => {
  it('save then load preserves lat/lng (and absent-stays-absent)', () => {
    saveItinerary(PLANS_WITH_PIN, cfg);
    const loaded = loadItinerary(cfg);
    const items = loaded[0].items as ItineraryItem[];
    expect(items.find((i) => i.id === 'p-pinned')!.lat).toBe(27.7043);
    expect(items.find((i) => i.id === 'p-pinned')!.lng).toBe(85.3072);
    expect(items.find((i) => i.id === 'p-absent')!.lat).toBeUndefined();
    expect(items.find((i) => i.id === 'p-absent')!.lng).toBeUndefined();
  });

  it('`lat`/`lng` need no dedicated migration/version bump — CURRENT_ITINERARY_VERSION stays 5', () => {
    expect(CURRENT_ITINERARY_VERSION).toBe(5);
    saveItinerary(PLANS_WITH_PIN, cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(5);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
  });

  it('a legacy bare-array (pre-S137) itinerary with no lat/lng loads fine — stays un-pinned post-load', () => {
    const legacy: DayPlan[] = [
      { date: '2026-12-19', city: 'Tokyo', country: 'japan', items: [{ id: 'leg', title: 'Ramen', category: 'food' }] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const loaded = loadItinerary(cfg);
    const leg = loaded[0].items[0] as ItineraryItem;
    expect(leg.title).toBe('Ramen');
    expect(leg.lat).toBeUndefined();
    expect(leg.lng).toBeUndefined();
  });

  it('setting a pin in place round-trips: save with lat/lng, re-save with pin cleared, reads absent', () => {
    // Mirrors what the ItemEditor does via updateItem: set a pin, persist, clear it, persist.
    saveItinerary(PLANS_WITH_PIN, cfg);
    const loaded = loadItinerary(cfg);
    const cleared: DayPlan[] = loaded.map((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === 'p-pinned' ? { ...it, lat: undefined, lng: undefined } : it)),
    }));
    saveItinerary(cleared, cfg);
    const reloaded = loadItinerary(cfg);
    expect((reloaded[0].items.find((i) => i.id === 'p-pinned') as ItineraryItem).lat).toBeUndefined();
    expect((reloaded[0].items.find((i) => i.id === 'p-pinned') as ItineraryItem).lng).toBeUndefined();
  });
});
