// @vitest-environment jsdom
//
// #564 — the "Saved" chip filters the map to favorited markers, but the chip that toggles
// `savedOnly` off is only RENDERED while `savedCount > 0` (see map-section.tsx). Unfavoriting
// the last saved place used to leave `savedOnly` stuck true with no control left to clear it,
// so the map went permanently blank. This pins the fix: the filter is gated on `savedCount`
// too, so losing the last favorite falls back to the full curated set.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MAP_MARKERS } from '@/lib/map-data';
import { favoritesStore } from '@/core/storage/gateway';
import { FAVORITES_CHANGED_EVENT } from '@/hooks/use-favorites';

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ plans: [], addItem: () => {}, findPlacements: () => [] }),
}));

// TripMap owns the real MapLibre GL canvas — unrenderable under jsdom. MapSection already
// exposes the filtered count on its own host div (`data-visible-count`), so the stub only
// needs to exist, not draw anything.
vi.mock('@/components/trip-map', () => ({
  __esModule: true,
  default: () => null,
  CATEGORY_STYLES: {},
}));

import MapSection from '@/components/map-section';

function render(el: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setFavorites(ids: string[]) {
  act(() => {
    favoritesStore.set(ids);
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  });
}

describe('MapSection "Saved" filter (#564)', () => {
  it('falls back to all markers once the last favorite is removed while savedOnly is on', () => {
    const firstId = MAP_MARKERS[0].id;
    setFavorites([firstId]);

    const r = render(createElement(MapSection));
    const shell = () => r.container.querySelector('[data-testid="map-shell"]')!;

    expect(shell().getAttribute('data-visible-count')).toBe(String(MAP_MARKERS.length));

    const savedChip = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="map-filter-saved"]',
    )!;
    act(() => savedChip.click());
    expect(shell().getAttribute('data-visible-count')).toBe('1');

    // unfavorite the only saved place — savedCount drops to 0 mid-filter
    setFavorites([]);

    expect(shell().getAttribute('data-visible-count')).toBe(String(MAP_MARKERS.length));

    r.unmount();
  });
});
