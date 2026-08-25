// @vitest-environment jsdom
//
// Issue #228 — the local-only booking-override store (`core/bookings/override.ts`) + its reactive
// hook (`hooks/use-booking-overrides.ts`). Three things this slice must prove for real:
//   1. an override merges correctly onto the static `lib/booking-data.ts` shapes for display;
//   2. `lib/booking-data.ts`'s own exported consts are NEVER mutated by that merge;
//   3. an override persists across a reload (mount -> set -> unmount+remount).

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  sanitizeBookingOverrides,
  applyJourneyOverride,
  applyStayOverride,
  upsertOverride,
  removeOverride,
  type BookingOverride,
  type BookingOverrideMap,
} from '@/core/bookings/override';
import { useBookingOverrides, type BookingOverridesApi } from '@/hooks/use-booking-overrides';
import { JOURNEYS, BOOKED_STAYS, OUTBOUND_JOURNEY, NEPAL_STAY, type Journey, type Stay } from '@/lib/booking-data';

const KEY = 'nepal_japan_booking_overrides';

const OVERRIDE: Omit<BookingOverride, 'updatedAt'> = {
  provider: 'Nova Air 812',
  confirmationNumber: 'ABC123',
  primaryLabel: '9:00am Mon Dec 21',
  secondaryLabel: '10:15am Mon Dec 21',
  note: 'Booked last minute',
};

describe('applyJourneyOverride / applyStayOverride — pure merge, never mutates the source', () => {
  it('no override -> returns the EXACT SAME reference (zero-cost passthrough)', () => {
    for (const journey of JOURNEYS) {
      expect(applyJourneyOverride(journey)).toBe(journey);
    }
    for (const stay of BOOKED_STAYS) {
      expect(applyStayOverride(stay)).toBe(stay);
    }
  });

  it('a journey override flips status to booked and overlays the first leg only', () => {
    const before = JSON.parse(JSON.stringify(OUTBOUND_JOURNEY)) as Journey;
    const merged = applyJourneyOverride(OUTBOUND_JOURNEY, { ...OVERRIDE, updatedAt: '2026-12-01T00:00:00.000Z' });

    expect(merged).not.toBe(OUTBOUND_JOURNEY);
    expect(merged.status).toBe('booked');
    expect(merged.legs[0].flightNumber).toBe('Nova Air 812');
    expect(merged.legs[0].departLabel).toBe('9:00am Mon Dec 21');
    expect(merged.legs[0].arriveLabel).toBe('10:15am Mon Dec 21');
    // Every other leg is untouched.
    expect(merged.legs.slice(1)).toEqual(before.legs.slice(1));
    expect(merged.layovers).toEqual(before.layovers);
    expect(merged.totalDuration).toBe(before.totalDuration);

    // The SOURCE object is byte-identical to before the call.
    expect(OUTBOUND_JOURNEY).toEqual(before);
  });

  it('a stay override flips status to booked and overlays name/checkIn/checkOut/note', () => {
    const before = JSON.parse(JSON.stringify(NEPAL_STAY)) as Stay;
    const merged = applyStayOverride(NEPAL_STAY, { ...OVERRIDE, updatedAt: '2026-12-01T00:00:00.000Z' });

    expect(merged).not.toBe(NEPAL_STAY);
    expect(merged.status).toBe('booked');
    expect(merged.name).toBe('Nova Air 812');
    expect(merged.checkIn).toBe('9:00am Mon Dec 21');
    expect(merged.checkOut).toBe('10:15am Mon Dec 21');
    expect(merged.note).toBe('Booked last minute');
    // Fields the override didn't touch survive verbatim.
    expect(merged.city).toBe(before.city);
    expect(merged.address).toBe(before.address);

    expect(NEPAL_STAY).toEqual(before);
  });

  it('a partial override (only confirmationNumber) leaves the untouched display fields as-is', () => {
    const merged = applyJourneyOverride(OUTBOUND_JOURNEY, {
      confirmationNumber: 'ONLY-THIS',
      updatedAt: '2026-12-01T00:00:00.000Z',
    });
    expect(merged.legs[0].flightNumber).toBe(OUTBOUND_JOURNEY.legs[0].flightNumber);
    expect(merged.legs[0].departLabel).toBe(OUTBOUND_JOURNEY.legs[0].departLabel);
    expect(merged.status).toBe('booked');
  });

  it('the full JOURNEYS/BOOKED_STAYS export arrays are unchanged after many merge calls (D-034)', () => {
    const journeysBefore = JSON.stringify(JOURNEYS);
    const staysBefore = JSON.stringify(BOOKED_STAYS);
    for (const j of JOURNEYS) applyJourneyOverride(j, { ...OVERRIDE, updatedAt: 'x' });
    for (const s of BOOKED_STAYS) applyStayOverride(s, { ...OVERRIDE, updatedAt: 'x' });
    expect(JSON.stringify(JOURNEYS)).toBe(journeysBefore);
    expect(JSON.stringify(BOOKED_STAYS)).toBe(staysBefore);
  });
});

describe('upsertOverride / removeOverride — pure map ops', () => {
  it('upsert adds a stamped entry without mutating the input map', () => {
    const map: BookingOverrideMap = {};
    const next = upsertOverride(map, 'outbound', OVERRIDE);
    expect(map).toEqual({});
    expect(next.outbound).toMatchObject(OVERRIDE);
    expect(typeof next.outbound.updatedAt).toBe('string');
  });

  it('remove is a no-op (same reference) when the id is absent', () => {
    const map: BookingOverrideMap = { a: { updatedAt: 'x' } };
    expect(removeOverride(map, 'nope')).toBe(map);
  });

  it('remove drops the entry without mutating the input map', () => {
    const map: BookingOverrideMap = { a: { updatedAt: 'x' }, b: { updatedAt: 'y' } };
    const next = removeOverride(map, 'a');
    expect(map).toHaveProperty('a');
    expect(next).toEqual({ b: { updatedAt: 'y' } });
  });
});

describe('sanitizeBookingOverrides — never throws, drops garbage', () => {
  it('non-object / array / null degrades to {}', () => {
    expect(sanitizeBookingOverrides(null)).toEqual({});
    expect(sanitizeBookingOverrides([1, 2])).toEqual({});
    expect(sanitizeBookingOverrides('nope')).toEqual({});
  });

  it('drops an entry missing updatedAt, keeps a valid sibling', () => {
    const out = sanitizeBookingOverrides({
      bad: { provider: 'X' },
      good: { provider: 'Y', updatedAt: '2026-01-01T00:00:00.000Z' },
    });
    expect(out).toEqual({ good: { provider: 'Y', updatedAt: '2026-01-01T00:00:00.000Z' } });
  });

  it('drops non-string fields inside an otherwise-valid entry', () => {
    const out = sanitizeBookingOverrides({
      a: { updatedAt: 't', provider: 42, note: null, confirmationNumber: 'OK' },
    });
    expect(out).toEqual({ a: { updatedAt: 't', confirmationNumber: 'OK' } });
  });
});

// ── useBookingOverrides — real DOM mount, mirrors lib/__tests__/use-favorites.test.ts's harness ──

interface HookHandle {
  current: BookingOverridesApi;
  run: (fn: (store: BookingOverridesApi) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>; // unmount + remount = a "reload" (re-reads localStorage)
  unmount: () => void;
}

function renderBookingOverrides(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: BookingOverridesApi } = { current: null as unknown as BookingOverridesApi };

  function Probe() {
    ref.current = useBookingOverrides();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useBookingOverrides (#228)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty + hydrated after mount', async () => {
    const h = renderBookingOverrides();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.overrides).toEqual({});
    h.unmount();
  });

  it('setOverride persists to the gateway key-40 slot, keyed by id', async () => {
    const h = renderBookingOverrides();
    await h.run((store) => store.setOverride('outbound', OVERRIDE));
    expect(h.current.overrides.outbound).toMatchObject(OVERRIDE);
    const onDisk = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(onDisk.outbound).toMatchObject(OVERRIDE);
    h.unmount();
  });

  it('RELOAD (unmount + remount) — a set override survives', async () => {
    const h = renderBookingOverrides();
    await h.run((store) => store.setOverride('nepal-hotel', OVERRIDE));
    await h.rerenderFresh();
    expect(h.current.overrides['nepal-hotel']).toMatchObject(OVERRIDE);
    h.unmount();
  });

  it('clearOverride removes it, and the removal survives a reload too', async () => {
    const h = renderBookingOverrides();
    await h.run((store) => store.setOverride('outbound', OVERRIDE));
    await h.run((store) => store.clearOverride('outbound'));
    expect(h.current.overrides.outbound).toBeUndefined();
    await h.rerenderFresh();
    expect(h.current.overrides.outbound).toBeUndefined();
    expect(window.localStorage.getItem(KEY)).toBe('{}');
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent (mirrors favorites)', async () => {
    const a = renderBookingOverrides();
    const b = renderBookingOverrides();
    await a.run((store) => store.setOverride('outbound', OVERRIDE));
    expect(b.current.overrides.outbound).toMatchObject(OVERRIDE);
    a.unmount();
    b.unmount();
  });

  it('a corrupt persisted slot degrades to {} on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderBookingOverrides();
    await h.run(() => {});
    expect(h.current.overrides).toEqual({});
    h.unmount();
  });
});
