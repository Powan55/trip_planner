// @vitest-environment jsdom
// Cards that already show the place name as a heading must not repeat it as the photo's alt.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/components/add-to-plan-button', () => ({ default: () => null }));
vi.mock('@/components/itinerary-provider', () => ({ useItineraryContext: () => ({ findPlacements: () => [] }) }));
vi.mock('@/hooks/use-favorites', () => ({ useFavorites: () => ({ favorites: [], toggle: () => {}, hydrated: true }) }));

import RecommendationSection from '@/components/recommendation-section';
import CountryEssentials from '@/components/country-essentials';
import { NEPAL_ATTRACTIONS, NEPAL_CATEGORIES } from '@/lib/nepal-data';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});

function imgsOf(node: ReturnType<typeof createElement>) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(node));
  return Array.from(el.querySelectorAll('img'));
}

function expectNoNameAlts(imgs: HTMLImageElement[], names: string[]) {
  expect(imgs.length).toBeGreaterThan(0);
  const dupes = imgs.filter((i) => names.includes(i.alt));
  expect(dupes.map((i) => i.alt)).toEqual([]);
}

describe('guide card photo alt', () => {
  it('RecommendationSection cards use alt="" instead of the heading text', () => {
    const imgs = imgsOf(
      createElement(RecommendationSection, {
        id: 't', title: 't', subtitle: 's', items: NEPAL_ATTRACTIONS.filter((a) => a.image).slice(0, 6), categories: NEPAL_CATEGORIES,
      }),
    );
    expectNoNameAlts(imgs, NEPAL_ATTRACTIONS.map((a) => a.name));
  });

  it('CountryEssentials featured cards use alt="" instead of the heading text', () => {
    const imgs = imgsOf(createElement(CountryEssentials, { country: 'Nepal' }));
    const headings = Array.from(document.querySelectorAll('h4')).map((h) => h.textContent ?? '');
    expectNoNameAlts(imgs, headings);
  });
});
