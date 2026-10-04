// @vitest-environment jsdom
//
// #789 / #791: the story stays locked while the hero's day is still the last trip day, and a page
// left open over that midnight unlocks on the shared tick without a remount.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const h = vi.hoisted(() => ({ now: '2027-01-09' }));

vi.mock('@/lib/trip-now', () => ({ getTripDayDate: () => h.now }));
vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ getDayPlan: () => ({ items: [] }), hydrated: true }),
}));
vi.mock('@/hooks/use-journal', () => ({ useJournal: () => ({ getEntry: () => null, hydrated: true }) }));
vi.mock('@/hooks/use-expenses', () => ({ useExpenses: () => ({ expenses: [], hydrated: true }) }));
vi.mock('@/hooks/use-photos', () => ({ usePhotos: () => ({ photosFor: () => [], hydrated: true }) }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const article = ({ initial, animate, whileInView, viewport, transition, ...rest }: Record<string, unknown>) =>
    React.createElement('article', rest);
  return { m: { article }, useReducedMotion: () => true };
});

import TripStoryRecap from '@/components/trip-story-recap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TripStoryRecap — unlock follows the hero day', () => {
  it('is locked on the last trip day and unlocks on the tick after midnight', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(TripStoryRecap)));
    expect(container.querySelector('[data-testid="trip-story-locked"]')).not.toBeNull();

    h.now = '2027-01-10';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(container.querySelector('[data-testid="trip-story-locked"]')).toBeNull();
    expect(container.querySelector('[data-testid="story-day-2027-01-09"]')).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
