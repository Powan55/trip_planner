// @vitest-environment jsdom
//
// REACT-2 — with the "Planned" chip active, the results grid went stale when a placement was
// added or removed. `filtered` calls `findPlacements(i.id)` but listed neither it nor
// `matchesSearch` in its deps, behind a blanket `eslint-disable react-hooks/exhaustive-deps`.
// `findPlacements` comes from the itinerary store and gets a NEW identity on every commit
// (`useCallback(..., [plans])`), so removing a place from the plan left its card in the Planned
// results while the chip count beside it — a plain per-render expression — dropped to 0. The
// screen contradicted itself until some other filter changed.
//
// The disable existed to silence the `matchesSearch` CLOSURE (whose only free variable, `q`, was
// listed). Hoisting it into a `useCallback` keyed on `q` removed the need for all three disables
// in the file and let the real missing dependency be declared.
//
// This drives the real component: the "Planned" chip is clicked, then the store's
// `findPlacements` is swapped for a new identity returning nothing, and a parent re-render is
// forced. Before the fix the card survives that; after it, the grid and the chip agree.

import { describe, it, expect, vi } from 'vitest';
import { createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { Recommendation } from '@/lib/nepal-data';

const h = vi.hoisted(() => ({
  // Swapped wholesale (new identity + new answer) to imitate an itinerary commit.
  findPlacements: (id: string) => (id === 'rec-a' ? [{ date: '2026-12-10' }] : []),
}));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    plans: [],
    addItem: () => {},
    findPlacements: (id: string) => h.findPlacements(id),
  }),
}));

// framer-motion is used for real EXCEPT `useReducedMotion`, which is forced on so the card tilt
// and the motion features stay inert in jsdom. A wholesale mock is not viable here: `useCardTilt`
// also pulls `useMotionValue`/`useSpring`.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import RecommendationSection from '@/components/recommendation-section';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `useCardTilt` and the section's own chrome read matchMedia; jsdom has no implementation.
window.matchMedia = ((q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

function rec(id: string, name: string): Recommendation {
  return {
    id,
    name,
    category: 'Temple',
    description: `${name} description`,
    bestTime: 'Morning',
    duration: '2h',
    photoRating: 5,
    notes: '',
    location: 'Boudha, Kathmandu',
  };
}

const ITEMS = [rec('rec-a', 'Boudhanath'), rec('rec-b', 'Patan Durbar')];

/** Renders the section under a parent that owns unrelated state, so a re-render can be forced
 *  without changing any prop — exactly what an itinerary commit does to this section. */
function renderWithForcedRerender(make: () => ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let bump: () => void = () => {};

  function Probe() {
    const [, setTick] = useState(0);
    bump = () => setTick((t) => t + 1);
    // A FRESH element each render: React bails out of re-rendering a child whose element is
    // referentially identical, which would make this harness prove nothing.
    return make();
  }

  act(() => root.render(createElement(Probe)));
  return {
    container,
    rerender() {
      act(() => bump());
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const cardIds = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid^="guide-card-"]')].map((n) =>
    n.getAttribute('data-testid'),
  );

describe('RecommendationSection — the Planned filter tracks the itinerary store (REACT-2)', () => {
  it('drops a card from the Planned results when its placement is removed', () => {
    h.findPlacements = (id: string) => (id === 'rec-a' ? [{ date: '2026-12-10' }] : []);

    const r = renderWithForcedRerender(() =>
      createElement(RecommendationSection, {
        id: 'nepal-attractions',
        title: 'Attractions',
        titleGradient: '',
        subtitle: '',
        items: ITEMS,
        categories: ['All', 'Temple'],
        accentColor: '',
        glassClass: '',
      }),
    );

    // The facets live in a sheet (it portals, so query the document).
    const openFilters = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="guide-filters-trigger"]',
    );
    expect(openFilters).not.toBeNull();
    act(() => openFilters!.click());

    // Turn the "Planned" chip on: one planned place, one card.
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="guide-filter-planned"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('1');
    act(() => chip!.click());
    expect(cardIds(r.container)).toEqual(['guide-card-rec-a']);

    // An itinerary commit: `findPlacements` is a NEW function that no longer places rec-a.
    h.findPlacements = () => [];
    r.rerender();

    // The chip count is unmemoized and always updated; the memoized grid used to disagree.
    expect(document.querySelector('[data-testid="guide-filter-planned"]')).toBeNull();
    expect(cardIds(r.container)).toEqual([]);

    r.unmount();
  });
});
