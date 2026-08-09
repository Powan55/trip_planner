// @vitest-environment jsdom
//
// S351B — closes a false coverage claim. `e2e/nightlife-gate.spec.ts`'s docstring says the
// render-gate's `traveler === null` branch (components/nightlife-section.tsx) "is covered at the
// unit level (`components/__tests__/` / gate-consumer tests)" — no such test existed anywhere
// under `lib/__tests__/` or `components/__tests__/`. This is that test. Mirrors the mock shape in
// `lib/__tests__/concierge-chat-gating.test.ts` (hoisted-safe `vi.mock` of the traveler hook).

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: null }),
}));

// NightlifeSection calls `useItineraryContext()` unconditionally, BEFORE its `!traveler` gate
// (it needs `findPlacements` further down for the signed-in render) — so a real
// `<ItineraryProvider>` (localStorage hydration, remote sync, etc.) would otherwise be required
// just to reach a branch that renders null. A minimal stub is the whole point of a unit test.
vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ findPlacements: () => [] }),
}));

import NightlifeSection from '@/components/nightlife-section';

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

describe('NightlifeSection visibility gate (S113; unit coverage added S351B)', () => {
  it('renders nothing when traveler is null (no guest mode, D-241)', () => {
    const r = render(createElement(NightlifeSection));
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });

  it('renders nothing with country scoped to Nepal either', () => {
    const r = render(createElement(NightlifeSection, { country: 'Nepal' }));
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });
});
