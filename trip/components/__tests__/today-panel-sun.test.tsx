// @vitest-environment jsdom
//
// Travel Mode today panel: offline sunrise/sunset for the day's leg, and a text flag on
// remaining outdoor items that run past sunset.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryItem } from '@/lib/trip-data';

const DAY = '2026-12-15';
const NOW_UTC_MS = Date.UTC(2026, 11, 15, 3, 0);

const item = (o: Partial<ItineraryItem>): ItineraryItem =>
  ({ id: 'x', title: 'x', category: 'sightseeing', time: '16:30', duration: '2h', ...o }) as ItineraryItem;

const ITEMS = [
  item({ id: 'late-view', title: 'Late view' }),
  item({ id: 'late-done', title: 'Late done', done: true }),
  item({ id: 'late-dinner', title: 'Late dinner', category: 'food' }),
  item({ id: 'early-walk', title: 'Early walk', time: '09:00', duration: '1h' }),
];

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: Record<string, unknown>) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, onExitComplete, ...rest } = p;
    return rest;
  };
  return {
    m: { div: (props: Record<string, unknown>) => React.createElement('div', strip(props)) },
    AnimatePresence: ({ children }: { children: unknown }) => children,
    useReducedMotion: () => true,
    useDragControls: () => ({ start: () => {} }),
  };
});

vi.mock('@/lib/trip-now', () => ({
  getTodayInTrip: () => ({ date: DAY, country: 'nepal', city: 'Kathmandu', dayNumber: 7 }),
  getNowUtcMsForPlace: () => NOW_UTC_MS,
}));
vi.mock('@/lib/travel-tick', () => ({ useTravelTick: () => 0 }));
vi.mock('@/lib/weather', () => ({ fetchWeather: () => new Promise(() => {}) }));
vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    hydrated: true,
    getDayPlan: () => ({ date: DAY, city: 'Kathmandu', country: 'nepal', items: ITEMS }),
    updateItem: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    restoreItem: vi.fn(),
    moveItem: vi.fn(),
  }),
}));

import TodayPanel from '@/components/today-panel';

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Today panel — sun', () => {
  it('shows sunrise/sunset and flags only remaining outdoor items ending after dark', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<TodayPanel />));

    const sun = document.querySelector('[data-testid="today-sun"]')!;
    expect(sun.textContent).toMatch(/Sunrise \d{1,2}:\d{2}\s?AM/);
    expect(sun.textContent).toMatch(/Sunset 5:\d{2}\s?PM/);
    const flagged = Array.from(document.querySelectorAll('[data-testid="today-after-dark"] li')).map((li) => li.textContent);
    expect(flagged).toEqual(['Late view ends after sunset']);
  });
});
