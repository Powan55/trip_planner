// @vitest-environment jsdom
//
// CONTENT-1 — `/map/` rendered the 27 curated Kathmandu-Valley/Japan places (`lib/map-data.ts`'s
// `MAP_MARKERS`) on EVERY trip and fitted the camera to them, with a masthead reading "every
// place across the Kathmandu Valley and Japan". Map is one of only four primary tabs on a custom
// trip (`primaryItemsForActiveTrip()` → Today · Plan · Map · Journal), so someone planning Cusco
// opened their Map tab onto Kathmandu and Tokyo. Every other N*J content surface is gated;
// this one had no trip gate at all.
//
// The gate lives at the ONE place the curated set enters the component (`curatedFor`), so the
// search hits, the saved count and the category chips empty with it. `data-visible-count` on the
// map shell is the existing assertion seam for what is DRAWN (the pins live in a WebGL canvas
// and there is no other observable signal), which is what this asserts.
//
// `<TripMap>` is module-mocked: it statically imports the maplibre stylesheet and lazily imports
// the ~200 kB GL runtime, none of which a gate test needs. `useItineraryContext` is stubbed the
// same way `components/__tests__/nightlife-section-gate.test.tsx` stubs it, and for the same
// reason — a real provider would mean localStorage hydration and remote sync just to reach a
// render decision.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/components/trip-map', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { MARKER_CATEGORIES } = await vi.importActual<typeof import('@/lib/map-data')>(
    '@/lib/map-data',
  );
  const Stub = React.forwardRef(() => null);
  Stub.displayName = 'TripMapStub';
  const CATEGORY_STYLES = Object.fromEntries(
    MARKER_CATEGORIES.map((c) => [c, { icon: () => null, badge: '' }]),
  );
  return { __esModule: true, default: Stub, CATEGORY_STYLES };
});

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ plans: [], addItem: () => {}, findPlacements: () => [] }),
}));

import MapSection from '@/components/map-section';
import { MAP_MARKERS } from '@/lib/map-data';
import { setActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const visibleCount = (c: HTMLElement) =>
  c.querySelector('[data-testid="map-shell"]')?.getAttribute('data-visible-count');

beforeEach(() => {
  localStorage.clear();
});

describe('/map/ curated pins are gated to the default trip (CONTENT-1)', () => {
  it('draws NO curated pins on a custom trip', async () => {
    setActiveTripId('trip-cusco-2027');
    const r = render(createElement(MapSection));
    await r.settle();
    expect(visibleCount(r.container)).toBe('0');
    r.unmount();
  });

  it('still draws all 156 curated pins on the default Nepal x Japan trip', async () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    const r = render(createElement(MapSection));
    await r.settle();
    expect(visibleCount(r.container)).toBe(String(MAP_MARKERS.length));
    // 74 until np-newa-lahana was folded back into np-newa-kitchen — one restaurant had been
    // entered twice, 293 m apart, because the dedupe list named it by marker id not by name.
    // 73 until the Japan rebuild took that leg from 14 markers to 97; Nepal is still 59.
    expect(MAP_MARKERS.length).toBe(156);
    r.unmount();
  });

  it('drops the category filter chips and the N x J masthead line with the pins', async () => {
    setActiveTripId('trip-cusco-2027');
    const custom = render(createElement(MapSection));
    await custom.settle();
    expect(custom.container.querySelector('[data-testid="map-filter-all"]')).toBeNull();
    expect(custom.container.textContent).not.toContain('Kathmandu Valley and Japan');
    custom.unmount();

    setActiveTripId(DEFAULT_TRIP_ID);
    const def = render(createElement(MapSection));
    await def.settle();
    expect(def.container.querySelector('[data-testid="map-filter-all"]')).not.toBeNull();
    expect(def.container.textContent).toContain('Kathmandu Valley and Japan');
    def.unmount();
  });
});
