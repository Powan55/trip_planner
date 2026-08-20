// @vitest-environment jsdom
//
// A-12 — proves the safety-content gate on `TravelEssentialsCard`
// (`components/travel-essentials-card.tsx`) actually fires: a non-default (custom) trip must
// NEVER render Japan/Nepal's real emergency contacts or the confirmed-flight journeys block —
// both are default-pack-only content, and showing them to a traveler who isn't on that trip is a
// safety defect. Mirrors `nightlife-section-gate.test.tsx`'s harness (plain `react-dom/client`
// render via `act`, no `@testing-library/react` in this repo) and
// `itinerary-remote-guest-gate.test.ts`'s `importOriginal` partial-mock style for `@/core/trips`
// (only `isDefaultTrip` is overridden — `getActiveTrip`/date-backbone resolution stays real, so
// the day still resolves to a real Nepal/Japan date under the unchanged default pointer).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({ isDefault: true }));

vi.mock('@/core/trips', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/trips')>();
  return { ...orig, isDefaultTrip: () => state.isDefault };
});

import TravelEssentialsCard from '@/components/travel-essentials-card';
import { EMERGENCY_CONTACTS } from '@/core/content/safety';

function render(date: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(createElement(TravelEssentialsCard, { date })));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  state.isDefault = true;
  // No real network from a unit test — fetchWeather/fetchCurrencyRate are documented total
  // (never throw/reject), so a rejected fetch just resolves their 'unavailable' branch async;
  // assertions below run synchronously right after render and never depend on that settling.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in unit test'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TravelEssentialsCard — safety-content gate (A-12)', () => {
  it('non-default (custom) trip: renders the static fallback, never a real emergency contact or the flights block', () => {
    state.isDefault = false;
    const r = render('2026-12-10'); // a Nepal day on the default date backbone

    expect(
      r.container.querySelector('[data-testid="travel-essentials-safety-unavailable"]'),
    ).not.toBeNull();
    expect(r.container.querySelector('[data-testid="travel-essentials-flights"]')).toBeNull();
    expect(r.container.querySelectorAll('a[href^="tel:"]').length).toBe(0);
    for (const c of EMERGENCY_CONTACTS) {
      expect(
        r.container.querySelector(`[data-testid="travel-essentials-safety-${c.id}"]`),
        `real contact ${c.id} must not render on a non-default trip`,
      ).toBeNull();
    }

    r.unmount();
  });

  it('default trip: the SAME day renders the real Nepal emergency contacts, not the fallback (before/after proof)', () => {
    state.isDefault = true;
    const r = render('2026-12-10');

    expect(
      r.container.querySelector('[data-testid="travel-essentials-safety-unavailable"]'),
    ).toBeNull();
    expect(
      r.container.querySelector('[data-testid="travel-essentials-safety-np-police"]'),
    ).not.toBeNull();
    expect(
      r.container.querySelector('[data-testid="travel-essentials-safety-np-ambulance"]'),
    ).not.toBeNull();
    expect(
      r.container.querySelector('[data-testid="travel-essentials-safety-np-fire"]'),
    ).not.toBeNull();
    expect(r.container.querySelectorAll('a[href^="tel:"]').length).toBeGreaterThan(0);

    r.unmount();
  });
});
