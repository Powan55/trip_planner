// @vitest-environment jsdom
//
// CONTENT-2 — `/safety/` renders `components/travel-safety-kit.tsx`, which hard-codes
// `(['Nepal', 'Japan'] as const).map(...)` over Nepal Police 100 / Japan 110 / the Kathmandu
// embassy switchboards plus a Nepali/Japanese phrasebook, under a header that presents it as the
// ACTIVE trip's kit ("works offline once loaded"). It is the one surface whose content is
// explicitly flagged safety-critical, and it was the one N*J template the custom-trip sweep
// missed: no `DefaultTripOnly`, no `defaultTripOnly` nav flag.
//
// The nav half is pinned in nav-items.test.ts. This is the typed-URL half — the page itself must
// give a custom trip the same honest empty state /nepal, /japan, /guides and /flights give.
//
// Renders the real route component. `SafetyKit` is a `dynamic(ssr:false)` island, so its content
// never loads here; what matters is which of the two branches DefaultTripOnly commits, and the
// empty state has a testid precisely so it can be asserted.

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import SafetyPage from '@/app/safety/page';
import { setActiveTripId, DEFAULT_TRIP_ID, STORAGE_KEYS } from '@/core/storage/gateway';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    async settle() {
      // DefaultTripOnly reads the pointer through a LAZY `import('@/core/storage/gateway')`
      // inside its effect (bundle discipline), so the gate resolves a microtask hop after mount.
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

const emptyState = (c: HTMLElement) =>
  c.querySelector('[data-testid="default-trip-only-empty-state"]');

beforeEach(() => {
  localStorage.clear();
});

describe('/safety/ is gated to the default trip (CONTENT-2)', () => {
  it('shows the honest empty state on a CUSTOM trip instead of another country’s emergency numbers', async () => {
    setActiveTripId('trip-cusco-2027');
    expect(localStorage.getItem(STORAGE_KEYS.activeTrip)).toBe('trip-cusco-2027');
    const r = render(createElement(SafetyPage));
    await r.settle();
    expect(emptyState(r.container)).not.toBeNull();
    expect(emptyState(r.container)!.textContent).toContain('This page belongs to the Nepal × Japan trip');
    // Note: `PageHeader` sits OUTSIDE the gate here, as it does on /nepal, /japan, /guides and
    // /flights — so its N*J wording is still on screen above the empty state. Same house pattern,
    // flagged rather than changed.
    r.unmount();
  });

  it('renders the kit on the DEFAULT trip (no empty state)', async () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    const r = render(createElement(SafetyPage));
    await r.settle();
    expect(emptyState(r.container)).toBeNull();
    // The page header is outside the gate on every gated route, so it is present either way.
    expect(r.container.textContent).toContain('Travel Safety Kit');
    r.unmount();
  });
});
