// @vitest-environment jsdom
//
// #270 — recap's description named Nepal and Japan on every custom trip. Mirrors
// packing-header.tsx's own fix (#240): mount-gated copy switch on `isDefaultTrip()`.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const isDefaultTrip = vi.fn();
vi.mock('@/core/trips', () => ({ isDefaultTrip: () => isDefaultTrip() }));

const tripDay = vi.fn(() => '');
vi.mock('@/core/recap/model', () => ({ isPostTrip: (d: string) => d > '2027-01-01' }));
vi.mock('@/hooks/use-trip-day', () => ({ useTripDay: () => tripDay() }));

import RecapHeader from '@/components/recap-header';

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

describe('RecapHeader trip-aware copy (#270)', () => {
  it('renders the default Nepal × Japan description on the default trip', () => {
    isDefaultTrip.mockReturnValue(true);
    const r = render(createElement(RecapHeader));
    expect(r.container.textContent).toContain('A day-by-day narrative of Nepal and Japan');
    r.unmount();
  });

  it('renders the generic description on a custom trip, after mount', () => {
    isDefaultTrip.mockReturnValue(false);
    const r = render(createElement(RecapHeader));
    expect(r.container.textContent).toContain('A day-by-day narrative of your trip');
    expect(r.container.textContent).not.toContain('Nepal and Japan');
    r.unmount();
  });
});

describe('RecapHeader unlock line follows trip phase (#1122)', () => {
  it.each([
    ['before', '2026-11-01', true],
    ['during', '2026-12-20', true],
    ['after', '2027-01-15', false],
  ])('%s the trip', (_p, day, shows) => {
    isDefaultTrip.mockReturnValue(true);
    tripDay.mockReturnValue(day);
    const r = render(createElement(RecapHeader));
    expect(r.container.textContent?.includes('Unlocks once the trip wraps')).toBe(shows);
    r.unmount();
  });
});
