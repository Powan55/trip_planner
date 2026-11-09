// @vitest-environment jsdom
//
// The Today panel and the Travel-Mode agenda render each day CHRONOLOGICALLY (owner-instructed).
// Both used to hand `TripAgenda` the STORED order, so a 3pm plan entered before a 10am one led
// the list — the same defect the planner's day list had. `TripAgenda` itself is order-agnostic
// (it renders what it is given), so the contract lives at these two call sites and this is where
// it has to be pinned.
//
// Both fixtures seed the day deliberately out of order and assert the RENDERED row order, not a
// helper's return value — a re-sort dropped from either caller has to fail here.

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryItem } from '@/lib/trip-data';

// A real Nepal trip day, and an instant inside it so the "now"-relative row phases resolve to
// something stable rather than tripping over the machine clock.
const DAY = '2026-12-15';
const NOW_UTC_MS = Date.UTC(2026, 11, 15, 3, 0); // 08:45 NPT

const item = (id: string, startMinutes?: number): ItineraryItem => ({
  id,
  title: id,
  category: 'sightseeing',
  ...(startMinutes === undefined ? {} : { startMinutes }),
});

// Stored order is deliberately backwards: 3pm first, then 10am, then an untimed idea wedged
// between them. Chronological order is therefore morning -> afternoon -> the untimed trailing run.
const STORED_OUT_OF_ORDER = [
  item('afternoon-plan', 15 * 60),
  item('untimed-idea'),
  item('morning-plan', 10 * 60),
];

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: Record<string, unknown>) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, onExitComplete, ...rest } = p;
    return rest;
  };
  return {
    m: {
      div: (props: Record<string, unknown>) => React.createElement('div', strip(props)),
      section: (props: Record<string, unknown>) => React.createElement('section', strip(props)),
    },
    AnimatePresence: ({ children }: { children: unknown }) => children,
    useReducedMotion: () => true,
  };
});

vi.mock('@/lib/trip-now', () => ({
  getTodayInTrip: () => ({ date: DAY, country: 'nepal', dayNumber: 7 }),
  getNowUtcMsForPlace: () => NOW_UTC_MS,
}));

vi.mock('@/lib/travel-tick', () => ({ useTravelTick: () => 0 }));

// The weather card fetches; the agenda order does not depend on it, so keep it inert.
vi.mock('@/lib/weather', () => ({ fetchWeather: () => new Promise(() => {}) }));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    hydrated: true,
    getDayPlan: () => ({ date: DAY, city: 'Kathmandu', country: 'nepal', items: STORED_OUT_OF_ORDER }),
    updateItem: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    restoreItem: vi.fn(),
    moveItem: vi.fn(),
  }),
}));

// Imported after the mocks for readability only — `vi.mock` is hoisted above every import.
import TravelAgendaCard from '@/components/travel-agenda-card';
import TodayPanel from '@/components/today-panel';

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

/** The rendered agenda rows' item ids, in DOM order. */
function renderedRowIds(prefix: string): string[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-done-toggle-"]`),
  ).map((el) => el.getAttribute('data-testid')!.replace(`${prefix}-done-toggle-`, ''));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Travel-Mode agenda — chronological order', () => {
  it('renders a day stored out of order by time, with the untimed plan trailing', () => {
    // `date` forces the day rather than tracking the live clock, so the fixture day is what
    // renders regardless of when the suite runs.
    render(<TravelAgendaCard date={DAY} />);
    expect(renderedRowIds('travel')).toEqual(['morning-plan', 'afternoon-plan', 'untimed-idea']);
  });
});

describe('Today panel — chronological order', () => {
  it('renders a day stored out of order by time, with the untimed plan trailing', () => {
    render(<TodayPanel />);
    expect(renderedRowIds('today')).toEqual(['morning-plan', 'afternoon-plan', 'untimed-idea']);
  });
});
