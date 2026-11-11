// @vitest-environment jsdom
// The "More" toggle on place-card notes exists only while the clamped note overflows.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/components/add-to-plan-button', () => ({ default: () => null }));
vi.mock('@/components/itinerary-provider', () => ({ useItineraryContext: () => ({ findPlacements: () => [] }) }));
vi.mock('@/hooks/use-favorites', () => ({ useFavorites: () => ({ favorites: [], toggle: () => {}, hydrated: true }) }));

import RecommendationSection from '@/components/recommendation-section';
import { NEPAL_ATTRACTIONS, NEPAL_CATEGORIES } from '@/lib/nepal-data';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});
afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

function render(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scroll });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => client });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const items = NEPAL_ATTRACTIONS.filter((a) => a.notes).slice(0, 1);
  act(() =>
    createRoot(el).render(
      createElement(RecommendationSection, { id: 't', title: 't', subtitle: 's', items, categories: NEPAL_CATEGORIES }),
    ),
  );
  return el.querySelector<HTMLButtonElement>('[data-testid^="guide-notes-toggle-"]');
}

describe('guide card notes toggle', () => {
  it('is absent when the notes fit', () => {
    expect(render(40, 40)).toBeNull();
  });

  it('shows when clipped and flips aria-expanded', () => {
    const btn = render(120, 60)!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toMatch(/^More/);
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toMatch(/^Less/);
  });

  it('measures from the ResizeObserver callback, not on mount', () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      expect(render(120, 60)).toBeNull();
      expect(callbacks.length).toBeGreaterThan(0);
      act(() => callbacks.forEach((cb) => cb()));
      const root = document.body.lastElementChild!;
      expect(root.querySelector('[data-testid^="guide-notes-toggle-"]')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
