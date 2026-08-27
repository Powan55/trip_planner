// @vitest-environment jsdom
//
// The travel agenda's explicit unplanned-gap rules: a rule is drawn between two adjacent timed
// rows only when the earlier one has an end and the interval clears the floor. Rendered through
// the same createRoot/act shim the other component tests use (no @testing-library dep).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import TripAgenda from '@/components/trip-agenda';
import type { ItineraryItem } from '@/lib/trip-data';

const DAY = '2026-12-10';
const CTX = { dayDate: DAY, placeOffsetMin: 345, nowUtcMs: Date.UTC(2026, 11, 10, 6, 15) };

const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: 'x',
  title: 'x',
  category: 'sightseeing',
  ...over,
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(items: ItineraryItem[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(TripAgenda, {
        variant: 'travel',
        items,
        date: DAY,
        dayNumber: 2,
        city: 'Kathmandu',
        onToggle: () => {},
        ctx: CTX,
      }),
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('TravelAgenda — unplanned gap rules', () => {
  it('draws one rule for a two-hour hole and none for the walk between two things', () => {
    const c = render([
      item({ id: 'a', title: 'Boudhanath walk', startMinutes: 540, durationMinutes: 60 }), // 09–10
      item({ id: 'b', title: 'Thamel lunch', startMinutes: 720, durationMinutes: 60 }), // 12–13, +2h
      item({ id: 'c', title: 'Souvenir hunt', startMinutes: 800 }), // 13:20, +20m
    ]);

    expect(c.querySelectorAll('[data-testid^="travel-agenda-gap-"]')).toHaveLength(1);
    expect(c.querySelector('[data-testid="travel-agenda-gap-b"]')?.textContent).toBe('2h unplanned');
    expect(c.querySelector('[data-testid="travel-agenda-gap-c"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="travel-agenda-item"]')).toHaveLength(3);
  });

  it('draws nothing when the earlier row has no end', () => {
    const c = render([
      item({ id: 'a', title: 'Open morning', startMinutes: 540 }),
      item({ id: 'b', title: 'Thamel lunch', startMinutes: 900 }),
    ]);
    expect(c.querySelectorAll('[data-testid^="travel-agenda-gap-"]')).toHaveLength(0);
  });

  it('marks the row phases and the empty day without inventing rows', () => {
    const c = render([
      item({ id: 'a', title: 'Boudhanath walk', startMinutes: 540, durationMinutes: 60 }),
    ]);
    expect(c.querySelector('[data-testid="travel-done-toggle-a"]')?.getAttribute('data-row-phase')).toBe('past');

    act(() => root!.render(
      createElement(TripAgenda, {
        variant: 'travel',
        items: [],
        date: DAY,
        dayNumber: 2,
        city: 'Kathmandu',
        onToggle: () => {},
        ctx: CTX,
      }),
    ));
    expect(c.querySelector('[data-testid="travel-agenda-empty"]')).not.toBeNull();
    expect(c.querySelectorAll('[data-testid="travel-agenda-item"]')).toHaveLength(0);
  });
});
