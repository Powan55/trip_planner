// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadItinerary,
  saveItinerary,
  type VaultConfig,
} from '@/core/vault/load-save';
import { CURRENT_ITINERARY_VERSION } from '@/core/vault/migrations';
import { itineraryItemSchema, parseItineraryPayload } from '@/core/vault/schema';
import { addItem, updateItem } from '@/core/itinerary/crud';
import { clashingItemIds } from '@/lib/sort-items-by-time';
// S391 (TD-07): clash overlap is judged on the absolute instant, so every call carries the
// day + the day's offset. These span cases are all single-zone, so the offset is a constant.
import { NPT_OFFSET_MIN } from '@/core/dates';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * S148 — Multi-day items: `endDate?` is an additive OPTIONAL that round-trips through the
 * Vault with NO migration and NO version bump (the S137 `lat`/`lng` precedent, one field over).
 *
 * The load-bearing guarantee is THE MERGE INVARIANT (D-018): a spanning item is stored in
 * EXACTLY ONE `DayPlan.items[]` — its start day — and is NEVER copied onto the days it covers.
 * The span is a pure view-layer render derivation; the store/crud are untouched. If a future
 * edit ever multi-homed a spanning item, the merge-invariant test below would fail.
 */

const STORAGE_KEY = 'test_span_itinerary';
const QUARANTINE_KEY = 'test_span_itinerary_corrupt';
const FALLBACK: DayPlan[] = [{ date: '3000-01-01', city: 'Fallback', country: 'nepal', items: [] }];

const DAY_A = '2026-12-09';
const DAY_B = '2026-12-10';
const DAY_C = '2026-12-11';

function basePlans(): DayPlan[] {
  return [
    { date: DAY_A, city: 'Kathmandu', country: 'nepal', items: [] },
    { date: DAY_B, city: 'Kathmandu', country: 'nepal', items: [] },
    { date: DAY_C, city: 'Kathmandu', country: 'nepal', items: [] },
  ];
}

/** Count, across ALL days, how many DayPlan.items[] entries carry `id`. The invariant is 1. */
function countHomesOf(plans: DayPlan[], id: string): number {
  return plans.reduce((n, p) => n + (p.items ?? []).filter((i) => i.id === id).length, 0);
}

let cfg: VaultConfig;
beforeEach(() => {
  localStorage.clear();
  cfg = { storageKey: STORAGE_KEY, quarantineKey: QUARANTINE_KEY, fallback: FALLBACK };
});

describe('S148 — `endDate` is a lenient, additive OPTIONAL (schema)', () => {
  it('accepts an item WITH endDate', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'Trek', category: 'nature', endDate: DAY_C });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.endDate).toBe(DAY_C);
  });

  it('accepts a single-day item with NO endDate (unaffected)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'Lunch', category: 'food' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.endDate).toBeUndefined();
  });

  it('rejects a non-string endDate (typed)', () => {
    const parsed = itineraryItemSchema.safeParse({ id: 'x', title: 'X', category: 'food', endDate: 20261211 });
    expect(parsed.success).toBe(false);
  });

  it('parseItineraryPayload preserves endDate across a mixed (span/single) day', () => {
    const plans: DayPlan[] = [
      {
        date: DAY_A, city: 'Kathmandu', country: 'nepal',
        items: [
          { id: 'span', title: 'Everest trek', category: 'nature', endDate: DAY_C },
          { id: 'single', title: 'Momo lunch', category: 'food' },
        ],
      },
    ];
    const parsed = parseItineraryPayload(plans);
    expect(parsed).not.toBeNull();
    const [span, single] = parsed![0].items as ItineraryItem[];
    expect(span.endDate).toBe(DAY_C);
    expect(single.endDate).toBeUndefined();
  });
});

describe('S148 — `endDate` round-trips through the Vault (save -> load) with NO version bump', () => {
  it('save then load preserves endDate (and single-day-stays-single)', () => {
    const plans: DayPlan[] = [
      {
        date: DAY_A, city: 'Kathmandu', country: 'nepal',
        items: [
          { id: 'span', title: 'Everest trek', category: 'nature', endDate: DAY_C },
          { id: 'single', title: 'Momo lunch', category: 'food' },
        ],
      },
    ];
    saveItinerary(plans, cfg);
    const loaded = loadItinerary(cfg);
    const items = loaded[0].items as ItineraryItem[];
    expect(items.find((i) => i.id === 'span')!.endDate).toBe(DAY_C);
    expect(items.find((i) => i.id === 'single')!.endDate).toBeUndefined();
  });

  it('`endDate` needs no migration/version bump — CURRENT_ITINERARY_VERSION stays 5', () => {
    expect(CURRENT_ITINERARY_VERSION).toBe(5);
    saveItinerary(basePlans(), cfg);
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(onDisk.schemaVersion).toBe(5);
    expect(onDisk.schemaVersion).toBe(CURRENT_ITINERARY_VERSION);
  });

  it('an old client that treats endDate as an unknown field preserves it round-trip (passthrough, D-095)', () => {
    // Simulate a client that never declared `endDate`: it still survives parse -> serialize ->
    // parse because `.passthrough()` keeps unknown keys.
    const raw = { id: 'span', title: 'Hotel stay', category: 'hotel', endDate: DAY_C, futureField: 'keep-me' };
    const parsed = itineraryItemSchema.parse(raw);
    const round = itineraryItemSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect((round as ItineraryItem).endDate).toBe(DAY_C);
    expect((round as Record<string, unknown>).futureField).toBe('keep-me');
  });
});

describe('S148 — THE MERGE INVARIANT: a spanning item lives in EXACTLY ONE DayPlan.items[]', () => {
  it('creating a spanning item (via the real crud add path) homes it on ONLY its start day', () => {
    // Drive the SAME pure mutator the store uses (core/itinerary/crud.addItem — verbatim from
    // use-itinerary). The item spans DAY_A..DAY_C but is added to DAY_A only.
    const spanItem: ItineraryItem = { id: 'trek', title: '3-day Everest trek', category: 'nature', endDate: DAY_C };
    const plans = addItem(basePlans(), DAY_A, spanItem);

    // Non-vacuous: the item exists, it spans 3 days, and it is homed EXACTLY once — on DAY_A.
    expect(countHomesOf(plans, 'trek')).toBe(1);
    expect(plans.find((p) => p.date === DAY_A)!.items.some((i) => i.id === 'trek')).toBe(true);
    expect(plans.find((p) => p.date === DAY_B)!.items.some((i) => i.id === 'trek')).toBe(false);
    expect(plans.find((p) => p.date === DAY_C)!.items.some((i) => i.id === 'trek')).toBe(false);
    // The covered days it does NOT own stay empty in the store (the span is view-layer only).
    expect(plans.find((p) => p.date === DAY_B)!.items).toHaveLength(0);
    expect(plans.find((p) => p.date === DAY_C)!.items).toHaveLength(0);
  });

  it('editing a single-day item to ADD an endDate does NOT multi-home it', () => {
    // Start single-day on DAY_A, then patch in an endDate via the real crud update path.
    let plans = addItem(basePlans(), DAY_A, { id: 'stay', title: 'Ryokan stay', category: 'hotel' });
    expect(countHomesOf(plans, 'stay')).toBe(1);
    plans = updateItem(plans, DAY_A, 'stay', { endDate: DAY_C });
    // Still exactly one home; the endDate patch only mutated the start-day copy.
    expect(countHomesOf(plans, 'stay')).toBe(1);
    expect(plans.find((p) => p.date === DAY_A)!.items.find((i) => i.id === 'stay')!.endDate).toBe(DAY_C);
    expect(plans.find((p) => p.date === DAY_B)!.items).toHaveLength(0);
  });

  it('the invariant survives a full Vault save -> load cycle (still one home after persistence)', () => {
    const plans = addItem(basePlans(), DAY_A, { id: 'trek', title: 'Trek', category: 'nature', endDate: DAY_C });
    saveItinerary(plans, cfg);
    const loaded = loadItinerary(cfg);
    expect(countHomesOf(loaded, 'trek')).toBe(1);
  });
});

describe('S148 — spanning items are EXCLUDED from clash warnings (clash v1)', () => {
  function mk(id: string, fields: Partial<ItineraryItem> = {}): ItineraryItem {
    return { id, title: id, category: 'sightseeing', ...fields };
  }

  it('a span that would otherwise overlap a timed item is NOT flagged as a clash', () => {
    // Both are timed 9:00-11:00 (would clash), but `span` carries an endDate → excluded.
    const span = mk('span', { startMinutes: 540, durationMinutes: 120, endDate: DAY_C }); // 9:00-11:00, spans
    const timed = mk('timed', { startMinutes: 600, durationMinutes: 30 }); // 10:00-10:30
    const result = clashingItemIds([span, timed], DAY_A, NPT_OFFSET_MIN);
    expect(result.has('span')).toBe(false);
    // The non-span counterpart is only in the set if it clashes with ANOTHER non-span; here it
    // had nothing else to clash with once the span is excluded.
    expect(result.has('timed')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('normal (non-span) clash behavior is UNCHANGED — two overlapping timed items still clash', () => {
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00
    const b = mk('b', { startMinutes: 570, durationMinutes: 60 }); // 9:30-10:30
    const result = clashingItemIds([a, b], DAY_A, NPT_OFFSET_MIN);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('a span excluded, but two OTHER timed items on the same day still clash (mixed day)', () => {
    const span = mk('span', { startMinutes: 540, durationMinutes: 600, endDate: DAY_C });
    const a = mk('a', { startMinutes: 540, durationMinutes: 60 }); // 9:00-10:00
    const b = mk('b', { startMinutes: 570, durationMinutes: 60 }); // 9:30-10:30
    const result = clashingItemIds([span, a, b], DAY_A, NPT_OFFSET_MIN);
    expect(result.has('span')).toBe(false);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });
});
